const createListItem = (site) => {
    const container = document.createElement('div');
    container.className = 'list-item is-adding';
    container.setAttribute('role', 'listitem');

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

const createPreferredRuleItem = (rule) => {
    const container = document.createElement('div');
    container.className = 'list-item';
    container.setAttribute('role', 'listitem');

    const content = document.createElement('div');
    content.className = 'list-item-content';

    const name = document.createElement('span');
    name.className = 'item-name';

    const sourceLabel = rule.sourceDomain ? ` when opened from ${rule.sourceDomain}` : ' from any source';
    name.textContent = `${rule.targetDomain}${sourceLabel} uses authuser=${rule.authuser}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove preferred account rule for ${rule.targetDomain}`);
    removeBtn.dataset.ruleId = rule.id;

    content.appendChild(name);
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
    return /^[^\\s]+$/.test(value);
};

const parseCurrentTabRuleCandidate = (rawUrl) => {
    if (!rawUrl) return null;

    try {
        const url = new URL(rawUrl);
        const authuser = url.searchParams.get("authuser");

        if (!authuser) return null;

        const isGoogleDomain =
            url.hostname === "google.com" ||
            url.hostname.endsWith(".google.com");

        if (!isGoogleDomain) return null;

        return {
            targetDomain: url.hostname.toLowerCase(),
            authuser: authuser.trim(),
        };
    } catch {
        return null;
    }
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
    const targetPresetGrid = document.getElementById("targetPresetGrid");
    const rulePresetGrid = document.getElementById("rulePresetGrid");
    const targetInput = document.getElementById("targetInput");
    const excludedInput = document.getElementById("excludedInput");
    const preferredTargetInput = document.getElementById("preferredTargetInput");
    const preferredSourceInput = document.getElementById("preferredSourceInput");
    const preferredAuthuserInput = document.getElementById("preferredAuthuserInput");
    const currentTabRuleHint = document.getElementById("currentTabRuleHint");
    const useCurrentTabRuleBtn = document.getElementById("useCurrentTabRuleBtn");
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
    let currentTabRuleCandidate = null;
    let suggestedRuleCandidate = null;
    let activeTabId = null;

    const updateEnabledState = () => {
        container.classList.toggle("is-disabled", !enabled.checked);
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

    const renderCurrentTabRuleHint = () => {
        if (!currentTabRuleCandidate) {
            currentTabRuleHint.textContent = "Open a supported Google page with an authuser parameter to capture its account.";
            useCurrentTabRuleBtn.disabled = true;
            return;
        }

        currentTabRuleHint.textContent =
            `Current tab: ${currentTabRuleCandidate.targetDomain} with authuser=${currentTabRuleCandidate.authuser}`;
        useCurrentTabRuleBtn.disabled = false;
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

        const sourceLabel = suggestedRuleCandidate.sourceDomain
            ? ` from ${suggestedRuleCandidate.sourceDomain}`
            : "";

        suggestedRuleHint.textContent =
            `Suggested from recent chooser: ${suggestedRuleCandidate.targetDomain}${sourceLabel} with authuser=${suggestedRuleCandidate.authuser}`;
        useSuggestedRuleBtn.disabled = false;
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
            tabs.forEach(t => {
                t.classList.remove("active");
                t.setAttribute("aria-selected", "false");
            });
            panels.forEach(p => p.classList.remove("active"));

            tab.classList.add("active");
            tab.setAttribute("aria-selected", "true");
            document.getElementById(`${tab.dataset.tab}-panel`).classList.add("active");
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
            .sort((a, b) => {
                const byTarget = a.targetDomain.localeCompare(b.targetDomain);
                if (byTarget !== 0) return byTarget;

                const bySource = (a.sourceDomain ?? "").localeCompare(b.sourceDomain ?? "");
                if (bySource !== 0) return bySource;

                return a.authuser.localeCompare(b.authuser);
            })
            .forEach((rule) => {
                preferredRulesList.appendChild(createPreferredRuleItem(rule));
            });
    };

    const refreshCurrentTabRuleCandidate = async () => {
        try {
            const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
            activeTabId = activeTab?.id ?? null;
            currentTabRuleCandidate = parseCurrentTabRuleCandidate(activeTab?.url);
        } catch (error) {
            console.error("Failed to inspect active tab:", error);
            activeTabId = null;
            currentTabRuleCandidate = null;
        }

        renderCurrentTabRuleHint();
    };

    const refreshSuggestedRuleCandidate = async () => {
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

    const filterList = (searchTerm, listElement, items) => {
        const term = searchTerm.toLowerCase().trim();
        const listItems = listElement.querySelectorAll('.list-item');

        listItems.forEach((item, index) => {
            const siteName = items[index];
            if (!siteName) return;

            if (siteName.toLowerCase().includes(term)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    };

    targetSearch.addEventListener("input", (e) => {
        filterList(e.target.value, targetsList, targetSites);
    });

    excludedSearch.addEventListener("input", (e) => {
        filterList(e.target.value, excludedList, excludedSourceSites);
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
        const sourceDomain = preferredSourceInput.value.trim()
            ? sanitizeDomainInput(preferredSourceInput.value)
            : "";
        const authuser = sanitizeAuthuserInput(preferredAuthuserInput.value);
        const newRule = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            targetDomain,
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
            preferredSourceInput.value = "";
            preferredAuthuserInput.value = "";
            renderPreferredRules();
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
        } catch (error) {
            preferredAccountRules = previousRules;
        }
    });

    addPreferredRuleBtn.addEventListener("click", addPreferredRule);
    useCurrentTabRuleBtn.addEventListener("click", () => {
        if (!currentTabRuleCandidate) return;

        preferredTargetInput.value = currentTabRuleCandidate.targetDomain;
        preferredAuthuserInput.value = currentTabRuleCandidate.authuser;

        if (!preferredSourceInput.value.trim()) {
            preferredSourceInput.focus();
        } else {
            preferredAuthuserInput.focus();
        }
    });
    useSuggestedRuleBtn.addEventListener("click", () => {
        if (!suggestedRuleCandidate) return;

        preferredTargetInput.value = suggestedRuleCandidate.targetDomain;
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
    renderPresetChips();
    await refreshCurrentTabRuleCandidate();
    await refreshSuggestedRuleCandidate();
});
