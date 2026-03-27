const createListItem = (site) => {
    const container = document.createElement('div');
    container.className = 'list-item is-adding';
    container.setAttribute('role', 'listitem');
    container.dataset.site = site;

    const content = document.createElement('div');
    content.className = 'list-item-content';

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = site;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${site}`);
    removeBtn.dataset.site = site;

    content.appendChild(name);
    container.appendChild(content);
    container.appendChild(removeBtn);

    return container;
};

const showError = (message) => {
    const toast = document.createElement('div');
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.style.cssText = 'position:fixed;top:10px;right:10px;background:#d32f2f;color:white;padding:12px 16px;border-radius:4px;font-size:13px;z-index:1000;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

const isValidDomain = (domain) => {
    if (!domain || domain.trim() === '') return false;

    const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

    if (!domainRegex.test(domain)) return false;
    if (domain.length > 253) return false;
    if (domain.startsWith('.') || domain.endsWith('.')) return false;
    if (domain.includes('..')) return false;
    if (domain.split('.').some(part => part.length > 63)) return false;
    if (/[^a-z0-9.-]/i.test(domain)) return false;

    return true;
};

const sanitizeDomainInput = (input) => {
    let domain = input.trim();

    try {
        const url = new URL(domain.startsWith('http') ? domain : 'http://' + domain);
        domain = url.hostname;
    } catch {
        domain = domain.replace(/^https?:\/\//, '');
        domain = domain.replace(/\/.*$/, '');
        domain = domain.replace(/:\d+$/, '');
    }

    return domain.toLowerCase();
};

const sanitizeAuthuserInput = (input) => input.trim();
const normalizeRulePathname = globalThis.normalizeRulePathname || ((pathname) => {
    if (typeof pathname !== "string" || !pathname) return "";

    const normalized = pathname
        .replace(/\/u\/[^/]+/g, "")
        .replace(/\/{2,}/g, "/")
        .replace(/\/$/, "");

    return normalized || "/";
});

const sanitizePathPrefixInput = (input) => {
    const trimmed = input.trim();
    if (!trimmed) return "";

    try {
        const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://example.com${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`);
        return normalizeRulePathname(parsed.pathname);
    } catch {
        return normalizeRulePathname(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
    }
};

const SERVICE_PRESETS = [
    {label: "Drive", domain: "drive.google.com"},
    {label: "Docs", domain: "docs.google.com"},
    {label: "Gmail", domain: "mail.google.com"},
    {label: "Calendar", domain: "calendar.google.com"},
    {label: "Photos", domain: "photos.google.com"},
    {label: "Meet", domain: "meet.google.com"},
    {label: "Chat", domain: "chat.google.com"},
    {label: "Forms", domain: "forms.google.com"},
];
const POPUP_ACTIVE_TAB_KEY = "popupActiveTab";

const createPreferredRuleItem = (rule) => {
    const container = document.createElement('div');
    container.className = 'list-item rule-list-item';
    container.setAttribute('role', 'listitem');

    const content = document.createElement('div');
    content.className = 'list-item-content rule-list-content';

    const textBlock = document.createElement('div');
    textBlock.className = 'rule-text-block';

    const name = document.createElement('span');
    name.className = 'item-name rule-primary-line';
    name.textContent = `${rule.targetDomain}${rule.targetPathPrefix ?? ""}`;

    const meta = document.createElement('span');
    meta.className = 'rule-meta-line';
    meta.textContent = rule.sourceDomain
        ? `Source: ${rule.sourceDomain}`
        : 'Source: any site';

    textBlock.appendChild(name);
    textBlock.appendChild(meta);

    const badge = document.createElement('span');
    badge.className = 'rule-authuser-badge';
    badge.textContent = `authuser=${rule.authuser}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove preferred account rule for ${rule.targetDomain}`);
    removeBtn.dataset.ruleId = rule.id;

    content.appendChild(textBlock);
    content.appendChild(badge);
    container.appendChild(content);
    container.appendChild(removeBtn);

    return container;
};

const createPresetChip = (preset, datasetKey) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-chip";
    button.textContent = preset.label;
    button.dataset[datasetKey] = preset.domain;
    return button;
};

const isValidAuthuser = (value) => {
    if (!value) return false;
    return /^\S+$/.test(value);
};

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.querySelector(".container");
    const enabled = document.getElementById("enabled");
    const tabs = document.querySelectorAll(".tab");
    const panels = document.querySelectorAll(".tab-panel");
    const skipIfAccountSpecified = document.getElementById("skipIfAccountSpecified");
    const interceptExternalClicks = document.getElementById("interceptExternalClicks");
    const interceptDirectNavigation = document.getElementById("interceptDirectNavigation");
    const interceptGoogleNavigation = document.getElementById("interceptGoogleNavigation");
    const usePreferredAccountRules = document.getElementById("usePreferredAccountRules");

    const targetsList = document.getElementById("targetsList");
    const excludedList = document.getElementById("excludedList");
    const preferredRulesList = document.getElementById("preferredRulesList");
    const savedDocumentRulesList = document.getElementById("savedDocumentRulesList");
    const targetPresetGrid = document.getElementById("targetPresetGrid");
    const rulePresetGrid = document.getElementById("rulePresetGrid");
    const targetInput = document.getElementById("targetInput");
    const excludedInput = document.getElementById("excludedInput");
    const preferredTargetInput = document.getElementById("preferredTargetInput");
    const preferredTargetPathInput = document.getElementById("preferredTargetPathInput");
    const preferredSourceInput = document.getElementById("preferredSourceInput");
    const preferredAuthuserInput = document.getElementById("preferredAuthuserInput");
    const suggestedRuleHint = document.getElementById("suggestedRuleHint");
    const useSuggestedRuleBtn = document.getElementById("useSuggestedRuleBtn");
    const addTargetBtn = document.getElementById("addTargetBtn");
    const addExcludedBtn = document.getElementById("addExcludedBtn");
    const addPreferredRuleBtn = document.getElementById("addPreferredRuleBtn");
    const targetSearch = document.getElementById("targetSearch");
    const excludedSearch = document.getElementById("excludedSearch");

    let targetSites = [];
    let excludedSourceSites = [];
    let preferredAccountRules = [];
    let suggestedRuleCandidate = null;
    let activeTabId = null;
    let activePopupTab = "preferences";

    const updateEnabledState = () => {
        container.classList.toggle("is-disabled", !enabled.checked);
    };

    const setActiveTab = (tabName) => {
        const nextTab = document.querySelector(`.tab[data-tab="${tabName}"]`) ? tabName : "preferences";
        activePopupTab = nextTab;

        tabs.forEach((tab) => {
            const isActive = tab.dataset.tab === nextTab;
            tab.classList.toggle("active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        panels.forEach((panel) => {
            panel.classList.toggle("active", panel.id === `${nextTab}-panel`);
        });
    };

    const persistActiveTab = async () => {
        try {
            await chrome.storage.sync.set({
                [POPUP_ACTIVE_TAB_KEY]: activePopupTab,
            });
        } catch (error) {
            console.error("Failed to persist popup tab:", error);
        }
    };

    try {
        const data = await chrome.storage.sync.get([
            "enabled",
            "targetSites",
            "excludedSourceSites",
            "skipIfAccountSpecified",
            "skipRedirectIfDone",
            "interceptExternalClicks",
            "interceptDirectNavigation",
            "interceptGoogleNavigation",
            "usePreferredAccountRules",
            "preferredAccountRules",
            POPUP_ACTIVE_TAB_KEY,
        ]);

        enabled.checked = data.enabled ?? true;
        skipIfAccountSpecified.checked = data.skipIfAccountSpecified ?? data.skipRedirectIfDone ?? true;
        interceptExternalClicks.checked = data.interceptExternalClicks ?? true;
        interceptDirectNavigation.checked = data.interceptDirectNavigation ?? false;
        interceptGoogleNavigation.checked = data.interceptGoogleNavigation ?? false;
        usePreferredAccountRules.checked = data.usePreferredAccountRules ?? false;
        targetSites = data.targetSites && data.targetSites.length > 0 ? data.targetSites : [...DEFAULT_GOOGLE_DOMAINS];
        targetSites.sort();
        excludedSourceSites = data.excludedSourceSites ?? [];
        preferredAccountRules = Array.isArray(data.preferredAccountRules) ? data.preferredAccountRules : [];
        activePopupTab = typeof data[POPUP_ACTIVE_TAB_KEY] === "string" ? data[POPUP_ACTIVE_TAB_KEY] : "preferences";
        updateEnabledState();
    } catch (error) {
        console.error("Failed to load settings:", error);
        showError("Failed to load settings");
        return;
    }

    const saveSettings = async () => {
        try {
            await chrome.storage.sync.set({
                enabled: enabled.checked,
                targetSites,
                excludedSourceSites,
                skipIfAccountSpecified: skipIfAccountSpecified.checked,
                skipRedirectIfDone: skipIfAccountSpecified.checked,
                interceptExternalClicks: interceptExternalClicks.checked,
                interceptDirectNavigation: interceptDirectNavigation.checked,
                interceptGoogleNavigation: interceptGoogleNavigation.checked,
                usePreferredAccountRules: usePreferredAccountRules.checked,
                preferredAccountRules,
            });
        } catch (error) {
            console.error("Failed to save settings:", error);
            showError("Failed to save settings");
            throw error;
        }
    };

    const renderPresetChips = () => {
        targetPresetGrid.innerHTML = "";
        rulePresetGrid.innerHTML = "";

        SERVICE_PRESETS.forEach((preset) => {
            targetPresetGrid.appendChild(createPresetChip(preset, "targetPreset"));
            rulePresetGrid.appendChild(createPresetChip(preset, "rulePreset"));
        });
    };

    const renderSuggestedRuleHint = () => {
        if (!suggestedRuleCandidate) {
            suggestedRuleHint.textContent = "No recent chooser-based suggestion for this tab yet.";
            useSuggestedRuleBtn.disabled = true;
            return;
        }

        const alreadySaved = preferredAccountRules.some((rule) =>
            rule.targetDomain === suggestedRuleCandidate.targetDomain &&
            (rule.targetPathPrefix ?? "") === (suggestedRuleCandidate.targetPathPrefix ?? "") &&
            (rule.sourceDomain ?? "") === (suggestedRuleCandidate.sourceDomain ?? "") &&
            rule.authuser === suggestedRuleCandidate.authuser
        );

        const sourceLabel = suggestedRuleCandidate.sourceDomain
            ? ` from ${suggestedRuleCandidate.sourceDomain}`
            : "";

        suggestedRuleHint.textContent = alreadySaved
            ? `Already saved: ${suggestedRuleCandidate.targetDomain}${suggestedRuleCandidate.targetPathPrefix}${sourceLabel} with authuser=${suggestedRuleCandidate.authuser}`
            : `Suggested from recent chooser: ${suggestedRuleCandidate.targetDomain}${suggestedRuleCandidate.targetPathPrefix}${sourceLabel} with authuser=${suggestedRuleCandidate.authuser}`;
        useSuggestedRuleBtn.disabled = alreadySaved;
    };

    const handleAddSite = async (inputElement, listArray, listElement) => {
        const rawInput = inputElement.value;
        const site = sanitizeDomainInput(rawInput);

        if (!site) {
            showError("Please enter a domain");
            return;
        }

        if (!isValidDomain(site)) {
            showError("Invalid domain format. Use: example.com or sub.example.com");
            return;
        }

        if (listArray.includes(site)) {
            showError("Site already exists");
            return;
        }

        try {
            listArray.push(site);
            inputElement.value = "";
            await saveSettings();

            const newElement = createListItem(site);
            listElement.prepend(newElement);
            void newElement.offsetHeight;
            newElement.classList.remove('is-adding');
        } catch (error) {
            const index = listArray.indexOf(site);
            if (index > -1) listArray.splice(index, 1);
        }
    };

    targetInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") addTargetBtn.click();
    });

    excludedInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") addExcludedBtn.click();
    });

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            setActiveTab(tab.dataset.tab);
            void persistActiveTab();
        });

        tab.addEventListener("keydown", (e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const currentIndex = Array.from(tabs).indexOf(tab);
                const nextIndex = e.key === "ArrowRight"
                    ? (currentIndex + 1) % tabs.length
                    : (currentIndex - 1 + tabs.length) % tabs.length;
                tabs[nextIndex].click();
                tabs[nextIndex].focus();
            }
        });
    });

    const renderTargetsInitial = () => {
        targetsList.innerHTML = "";
        targetSites.forEach(site => {
            const element = createListItem(site);
            element.classList.remove('is-adding');
            targetsList.appendChild(element);
        });
    };

    const renderExcludedInitial = () => {
        excludedList.innerHTML = "";
        excludedSourceSites.forEach(site => {
            const element = createListItem(site);
            element.classList.remove('is-adding');
            excludedList.appendChild(element);
        });
    };

    const renderPreferredRules = () => {
        preferredRulesList.innerHTML = "";

        preferredAccountRules
            .slice()
            .filter((rule) => !rule.targetPathPrefix)
            .sort((a, b) => {
                const byTarget = a.targetDomain.localeCompare(b.targetDomain);
                if (byTarget !== 0) return byTarget;

                const byPath = (a.targetPathPrefix ?? "").localeCompare(b.targetPathPrefix ?? "");
                if (byPath !== 0) return byPath;

                const bySource = (a.sourceDomain ?? "").localeCompare(b.sourceDomain ?? "");
                if (bySource !== 0) return bySource;

                return a.authuser.localeCompare(b.authuser);
            })
            .forEach((rule) => {
                preferredRulesList.appendChild(createPreferredRuleItem(rule));
            });

        if (!preferredRulesList.children.length) {
            const emptyState = document.createElement("div");
            emptyState.className = "rule-card-copy empty-rule-state";
            emptyState.textContent = "No service-wide rules saved yet.";
            preferredRulesList.appendChild(emptyState);
        }
    };

    const renderSavedDocumentRules = () => {
        savedDocumentRulesList.innerHTML = "";

        const documentSpecificRules = preferredAccountRules
            .filter((rule) => Boolean(rule.targetPathPrefix))
            .slice()
            .sort((a, b) => {
                const byTarget = a.targetDomain.localeCompare(b.targetDomain);
                if (byTarget !== 0) return byTarget;
                return (a.targetPathPrefix ?? "").localeCompare(b.targetPathPrefix ?? "");
            });

        if (documentSpecificRules.length === 0) {
            const emptyState = document.createElement("div");
            emptyState.className = "rule-card-copy empty-rule-state";
            emptyState.textContent = "No document-specific rules saved yet.";
            savedDocumentRulesList.appendChild(emptyState);
            return;
        }

        documentSpecificRules.forEach((rule) => {
            const item = document.createElement("div");
            item.className = "list-item document-rule-item";
            item.setAttribute("role", "listitem");

            const content = document.createElement("div");
            content.className = "list-item-content rule-list-content";

            const textBlock = document.createElement("div");
            textBlock.className = "rule-text-block";

            const name = document.createElement("span");
            name.className = "item-name rule-primary-line";
            name.textContent = `${rule.targetDomain}${rule.targetPathPrefix}`;

            const meta = document.createElement("span");
            meta.className = "rule-meta-line";
            meta.textContent = rule.sourceDomain
                ? `Suggested from ${rule.sourceDomain}`
                : "Suggested without a source filter";

            const badge = document.createElement("span");
            badge.className = "rule-authuser-badge";
            badge.textContent = `authuser=${rule.authuser}`;

            const removeBtn = document.createElement("button");
            removeBtn.className = "remove-btn";
            removeBtn.textContent = "Remove";
            removeBtn.setAttribute("aria-label", `Remove saved document rule for ${rule.targetDomain}${rule.targetPathPrefix}`);
            removeBtn.dataset.ruleId = rule.id;

            textBlock.appendChild(name);
            textBlock.appendChild(meta);
            content.appendChild(textBlock);
            content.appendChild(badge);
            item.appendChild(content);
            item.appendChild(removeBtn);
            savedDocumentRulesList.appendChild(item);
        });
    };

    const refreshSuggestedRuleCandidate = async () => {
        try {
            const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
            activeTabId = activeTab?.id ?? null;
        } catch (error) {
            console.error("Failed to inspect active tab:", error);
            activeTabId = null;
        }

        if (typeof activeTabId !== "number") {
            suggestedRuleCandidate = null;
            renderSuggestedRuleHint();
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: "getSuggestedRule",
                tabId: activeTabId,
            });
            suggestedRuleCandidate = response?.suggestedRule ?? null;
        } catch (error) {
            console.error("Failed to load suggested rule:", error);
            suggestedRuleCandidate = null;
        }

        renderSuggestedRuleHint();
    };

    const filterList = (searchTerm, listElement) => {
        const term = searchTerm.toLowerCase().trim();
        const listItems = listElement.querySelectorAll('.list-item');

        listItems.forEach((item) => {
            const siteName = item.dataset.site ?? "";

            if (siteName.toLowerCase().includes(term)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    };

    targetSearch.addEventListener("input", (e) => {
        filterList(e.target.value, targetsList);
    });

    excludedSearch.addEventListener("input", (e) => {
        filterList(e.target.value, excludedList);
    });

    const removeTarget = async (site, element) => {
        element.classList.add('is-removing');
        await new Promise(resolve => setTimeout(resolve, 300));

        try {
            targetSites = targetSites.filter(s => s !== site);
            await saveSettings();
            element.remove();
        } catch (error) {
            element.classList.remove('is-removing');
            targetSites.push(site);
        }
    };

    const removeExcluded = async (site, element) => {
        element.classList.add('is-removing');
        await new Promise(resolve => setTimeout(resolve, 300));

        try {
            excludedSourceSites = excludedSourceSites.filter(s => s !== site);
            await saveSettings();
            element.remove();
        } catch (error) {
            element.classList.remove('is-removing');
            excludedSourceSites.push(site);
        }
    };

    targetsList.addEventListener("click", (e) => {
        if (e.target.classList.contains("remove-btn")) {
            const site = e.target.dataset.site;
            const listItem = e.target.closest('.list-item');
            if (site && listItem) {
                removeTarget(site, listItem);
            }
        }
    });

    excludedList.addEventListener("click", (e) => {
        if (e.target.classList.contains("remove-btn")) {
            const site = e.target.dataset.site;
            const listItem = e.target.closest('.list-item');
            if (site && listItem) {
                removeExcluded(site, listItem);
            }
        }
    });

    addTargetBtn.addEventListener("click", async () => {
        await handleAddSite(targetInput, targetSites, targetsList);
    });

    addExcludedBtn.addEventListener("click", async () => {
        await handleAddSite(excludedInput, excludedSourceSites, excludedList);
    });

    targetPresetGrid.addEventListener("click", async (e) => {
        const button = e.target.closest(".preset-chip");
        const domain = button?.dataset.targetPreset;
        if (!domain) return;

        targetInput.value = domain;
        await handleAddSite(targetInput, targetSites, targetsList);
    });

    rulePresetGrid.addEventListener("click", (e) => {
        const button = e.target.closest(".preset-chip");
        const domain = button?.dataset.rulePreset;
        if (!domain) return;

        preferredTargetInput.value = domain;
        if (!preferredAuthuserInput.value.trim()) {
            preferredAuthuserInput.focus();
        }
    });

    const addPreferredRule = async () => {
        const targetDomain = sanitizeDomainInput(preferredTargetInput.value);
        const targetPathPrefix = sanitizePathPrefixInput(preferredTargetPathInput.value);
        const sourceDomain = preferredSourceInput.value.trim()
            ? sanitizeDomainInput(preferredSourceInput.value)
            : "";
        const authuser = sanitizeAuthuserInput(preferredAuthuserInput.value);
        const newRule = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            targetDomain,
            targetPathPrefix,
            sourceDomain,
            authuser,
        };

        if (!targetDomain || !isValidDomain(targetDomain)) {
            showError("Preferred account rules need a valid target domain");
            return;
        }

        if (sourceDomain && !isValidDomain(sourceDomain)) {
            showError("Source domain must be empty or a valid domain");
            return;
        }

        if (!isValidAuthuser(authuser)) {
            showError("Account hint must be a non-empty authuser value");
            return;
        }

        const duplicate = preferredAccountRules.some((rule) =>
            rule.targetDomain === targetDomain &&
            (rule.targetPathPrefix ?? "") === targetPathPrefix &&
            (rule.sourceDomain ?? "") === sourceDomain &&
            rule.authuser === authuser
        );

        if (duplicate) {
            showError("That preferred account rule already exists");
            return;
        }

        preferredAccountRules.push(newRule);

        try {
            await saveSettings();
            preferredTargetInput.value = "";
            preferredTargetPathInput.value = "";
            preferredSourceInput.value = "";
            preferredAuthuserInput.value = "";
            renderPreferredRules();
            renderSavedDocumentRules();
        } catch (error) {
            preferredAccountRules = preferredAccountRules.filter((rule) => rule.id !== newRule.id);
        }
    };

    preferredRulesList.addEventListener("click", async (e) => {
        if (!e.target.classList.contains("remove-btn")) return;

        const ruleId = e.target.dataset.ruleId;
        if (!ruleId) return;

        const previousRules = [...preferredAccountRules];
        preferredAccountRules = preferredAccountRules.filter((rule) => rule.id !== ruleId);

        try {
            await saveSettings();
            renderPreferredRules();
            renderSavedDocumentRules();
        } catch (error) {
            preferredAccountRules = previousRules;
        }
    });

    savedDocumentRulesList.addEventListener("click", async (e) => {
        if (!e.target.classList.contains("remove-btn")) return;

        const ruleId = e.target.dataset.ruleId;
        if (!ruleId) return;

        const previousRules = [...preferredAccountRules];
        preferredAccountRules = preferredAccountRules.filter((rule) => rule.id !== ruleId);

        try {
            await saveSettings();
            renderPreferredRules();
            renderSavedDocumentRules();
            renderSuggestedRuleHint();
        } catch (error) {
            preferredAccountRules = previousRules;
        }
    });

    addPreferredRuleBtn.addEventListener("click", addPreferredRule);
    useSuggestedRuleBtn.addEventListener("click", () => {
        if (!suggestedRuleCandidate) return;

        preferredTargetInput.value = suggestedRuleCandidate.targetDomain;
        preferredTargetPathInput.value = suggestedRuleCandidate.targetPathPrefix ?? "";
        preferredSourceInput.value = suggestedRuleCandidate.sourceDomain ?? "";
        preferredAuthuserInput.value = suggestedRuleCandidate.authuser;
        preferredAuthuserInput.focus();
    });
    preferredAuthuserInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            void addPreferredRule();
        }
    });

    enabled.addEventListener("change", async () => {
        try {
            await saveSettings();
            updateEnabledState();
        } catch (error) {
            enabled.checked = !enabled.checked;
            updateEnabledState();
        }
    });

    [skipIfAccountSpecified, interceptExternalClicks, interceptDirectNavigation, interceptGoogleNavigation, usePreferredAccountRules]
        .forEach((input) => {
            input.addEventListener("change", async () => {
                try {
                    await saveSettings();
                } catch (error) {
                    input.checked = !input.checked;
                }
            });
        });

    renderTargetsInitial();
    renderExcludedInitial();
    renderPreferredRules();
    renderSavedDocumentRules();
    renderPresetChips();
    setActiveTab(activePopupTab);
    await refreshSuggestedRuleCandidate();
});
