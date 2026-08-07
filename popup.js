document.addEventListener("DOMContentLoaded", async () => {
    const enabled = document.getElementById("enabled");
    const gatedContent = document.getElementById("gated-content");
    const contextHostname = document.getElementById("contextHostname");
    const contextStatus = document.getElementById("contextStatus");
    const contextExcludeBtn = document.getElementById("contextExcludeBtn");
    const suggestedRuleHint = document.getElementById("suggestedRuleHint");
    const useSuggestedRuleBtn = document.getElementById("useSuggestedRuleBtn");
    const skipIfAccountSpecified = document.getElementById("skipIfAccountSpecified");
    const interceptExternalClicks = document.getElementById("interceptExternalClicks");
    const interceptDirectNavigation = document.getElementById("interceptDirectNavigation");
    const interceptGoogleNavigation = document.getElementById("interceptGoogleNavigation");
    const dnrInterception = document.getElementById("dnrInterception");
    const autoSaveSuggestedRules = document.getElementById("autoSaveSuggestedRules");
    const historyList = document.getElementById("historyList");
    const historyTabCount = document.getElementById("historyTabCount");
    const clearHistoryBtn = document.getElementById("clearHistoryBtn");
    const versionLabel = document.getElementById("versionLabel");
    const themeToggleBtn = document.getElementById("themeToggleBtn");
    const openOptionsBtn = document.getElementById("openOptionsBtn");

    // --- Tabs (roving tabindex) ---

    const popupTabs = Array.from(document.querySelectorAll(".popup-tab"));
    const popupPanels = new Map(
        Array.from(document.querySelectorAll(".popup-panel")).map((panel) => [panel.id, panel])
    );

    const activatePopupTab = (tab) => {
        popupTabs.forEach((other) => {
            const isActive = other === tab;
            other.setAttribute("aria-selected", isActive ? "true" : "false");
            other.tabIndex = isActive ? 0 : -1;
        });

        for (const [id, panel] of popupPanels) {
            panel.hidden = id !== `panel-${tab.dataset.panel}`;
        }
    };

    popupTabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activatePopupTab(tab));
        tab.addEventListener("keydown", (e) => {
            let nextIndex = null;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIndex = (index + 1) % popupTabs.length;
            else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIndex = (index - 1 + popupTabs.length) % popupTabs.length;

            if (nextIndex !== null) {
                e.preventDefault();
                activatePopupTab(popupTabs[nextIndex]);
                popupTabs[nextIndex].focus();
            }
        });
    });

    let currentTheme = await initTheme();

    const THEME_LABELS = {system: "System", light: "Light", dark: "Dark"};
    const THEME_CYCLE = {system: "light", light: "dark", dark: "system"};
    const THEME_ICONS = {system: "monitor", light: "sun", dark: "moon"};

    const renderThemeButton = () => {
        const label = `Theme: ${THEME_LABELS[currentTheme]} — switch to ${THEME_LABELS[THEME_CYCLE[currentTheme]]}`;
        themeToggleBtn.replaceChildren(createIcon(THEME_ICONS[currentTheme]));
        themeToggleBtn.setAttribute("aria-label", label);
        themeToggleBtn.title = label;
    };

    themeToggleBtn.addEventListener("click", async () => {
        currentTheme = THEME_CYCLE[currentTheme];
        renderThemeButton();
        await setTheme(currentTheme);
    });

    renderThemeButton();

    let settings;
    let activeTabId = null;
    let activeTabHostname = null;
    let suggestedRuleCandidate = null;

    const {settings: loaded, error: loadError} = await loadSettings();
    settings = loaded;
    if (loadError) showToast("Failed to load settings", {variant: "error"});

    const persistSettings = async () => {
        await saveSettings({
            enabled: enabled.checked,
            targetSites: settings.targetSites,
            excludedSourceSites: settings.excludedSourceSites,
            skipIfAccountSpecified: skipIfAccountSpecified.checked,
            skipRedirectIfDone: skipIfAccountSpecified.checked,
            interceptExternalClicks: interceptExternalClicks.checked,
            interceptDirectNavigation: interceptDirectNavigation.checked,
            interceptGoogleNavigation: interceptGoogleNavigation.checked,
            dnrInterception: dnrInterception.checked,
            autoSaveSuggestedRules: autoSaveSuggestedRules.checked,
            preferredAccountRules: settings.preferredAccountRules,
        });
    };

    const updateEnabledState = () => {
        const isDisabled = !enabled.checked;
        gatedContent.classList.toggle("is-disabled", isDisabled);
        gatedContent.inert = isDisabled;
        gatedContent.setAttribute("aria-hidden", isDisabled ? "true" : "false");
    };

    const renderContextCard = () => {
        if (!activeTabHostname) {
            contextHostname.textContent = "No active website";
            contextStatus.textContent = "Open a website to see its status here.";
            contextStatus.className = "context-note";
            contextExcludeBtn.hidden = true;
            return;
        }

        contextHostname.textContent = activeTabHostname;

        const isExcluded = domainMatchesList(activeTabHostname, settings.excludedSourceSites);
        const isTarget = domainMatchesList(activeTabHostname, settings.targetSites);

        if (isExcluded) {
            contextStatus.textContent = "Excluded source";
            contextStatus.className = "chip";
            contextExcludeBtn.textContent = "Stop excluding";
        } else if (isTarget) {
            contextStatus.textContent = "Target Google site";
            contextStatus.className = "chip chip-accent";
            contextExcludeBtn.textContent = "Exclude this site";
        } else {
            contextStatus.textContent = "Links here are intercepted";
            contextStatus.className = "chip chip-success";
            contextExcludeBtn.textContent = "Exclude this site";
        }

        // Excluding a Google target itself is meaningless; exclusion applies to source sites.
        contextExcludeBtn.hidden = isTarget && !isExcluded;
    };

    const suggestedRuleAsCandidate = () => ({
        targetDomain: suggestedRuleCandidate.targetDomain,
        targetPathPrefix: suggestedRuleCandidate.targetPathPrefix === "/" ? "" : (suggestedRuleCandidate.targetPathPrefix ?? ""),
        sourceDomain: suggestedRuleCandidate.sourceDomain ?? "",
        authuser: suggestedRuleCandidate.authuser,
    });

    let suggestedRuleArmTimer = null;

    const disarmUseSuggestedRuleBtn = () => {
        clearTimeout(suggestedRuleArmTimer);
        suggestedRuleArmTimer = null;
        if (useSuggestedRuleBtn.dataset.armed) {
            delete useSuggestedRuleBtn.dataset.armed;
            // Arming only happens in the conflict state, so restore that label.
            useSuggestedRuleBtn.textContent = "Replace Saved Rule";
        }
    };

    const renderSuggestedRuleHint = () => {
        disarmUseSuggestedRuleBtn();

        if (!suggestedRuleCandidate) {
            suggestedRuleHint.textContent = "No recent chooser-based suggestion for this tab yet.";
            useSuggestedRuleBtn.disabled = true;
            useSuggestedRuleBtn.textContent = "Save Suggested Rule";
            return;
        }

        const candidate = suggestedRuleAsCandidate();
        const existing = findRuleByKey(settings.preferredAccountRules, candidate);
        const alreadySaved = Boolean(existing) && existing.authuser === candidate.authuser;

        const sourceLabel = suggestedRuleCandidate.sourceDomain
            ? ` from ${suggestedRuleCandidate.sourceDomain}`
            : "";
        const summary = `${suggestedRuleCandidate.targetDomain}${suggestedRuleCandidate.targetPathPrefix ?? ""}${sourceLabel} with ${formatAuthuserLabel(suggestedRuleCandidate.authuser, settings.accountLabels)}`;

        if (alreadySaved) {
            suggestedRuleHint.textContent = `Already saved: ${summary}`;
            useSuggestedRuleBtn.disabled = true;
            useSuggestedRuleBtn.textContent = "Save Suggested Rule";
        } else if (existing) {
            suggestedRuleHint.textContent = `Currently opens with ${formatAuthuserLabel(existing.authuser, settings.accountLabels)} — suggested: ${summary}`;
            useSuggestedRuleBtn.disabled = false;
            useSuggestedRuleBtn.textContent = "Replace Saved Rule";
        } else {
            suggestedRuleHint.textContent = `Suggested: ${summary}`;
            useSuggestedRuleBtn.disabled = false;
            useSuggestedRuleBtn.textContent = "Save Suggested Rule";
        }
    };

    // --- History tab (the saved trusted links) ---

    const findRuleByKey = (rules, candidate) => rules.find((rule) =>
        rule.targetDomain === candidate.targetDomain &&
        (rule.targetPathPrefix ?? "") === (candidate.targetPathPrefix ?? "") &&
        (rule.sourceDomain ?? "") === (candidate.sourceDomain ?? ""));

    const mutateRules = async (nextRules, message) => {
        const previous = settings.preferredAccountRules;
        settings.preferredAccountRules = nextRules;

        try {
            await persistSettings();
            renderHistory();
            renderSuggestedRuleHint();
            if (message) showToast(message);
        } catch (error) {
            settings.preferredAccountRules = previous;
            renderHistory();
            showToast(error.message, {variant: "error"});
        }
    };

    const createHistoryItem = (rule) => {
        const ruleName = `${rule.targetDomain}${rule.targetPathPrefix ?? ""}`;

        const container = document.createElement("div");
        container.className = "list-item";
        container.classList.toggle("is-rule-disabled", rule.enabled === false);
        container.setAttribute("role", "listitem");

        const inner = document.createElement("div");
        inner.className = "list-item-inner history-inner";

        // The domain lives in the group header, so the row only carries the path.
        const path = document.createElement("span");
        path.className = rule.targetPathPrefix ? "history-path" : "history-path history-path-all";
        path.textContent = rule.targetPathPrefix || "Entire service";
        path.title = `https://${ruleName}`;

        const tags = document.createElement("div");
        tags.className = "history-tags";

        const accountChip = document.createElement("span");
        accountChip.className = "chip chip-xs chip-accent";
        accountChip.textContent = formatAuthuserLabel(rule.authuser, settings.accountLabels);
        tags.appendChild(accountChip);

        if (rule.sourceDomain) {
            const sourceChip = document.createElement("span");
            sourceChip.className = "chip chip-xs";
            sourceChip.textContent = `from ${rule.sourceDomain}`;
            tags.appendChild(sourceChip);
        }

        if (rule.enabled === false) {
            const pausedChip = document.createElement("span");
            pausedChip.className = "chip chip-xs";
            pausedChip.textContent = "Paused";
            tags.appendChild(pausedChip);
        }

        const toggle = document.createElement("label");
        toggle.className = "switch history-switch";
        toggle.setAttribute("aria-label", `Enable rule for ${ruleName}`);
        const toggleInput = document.createElement("input");
        toggleInput.type = "checkbox";
        toggleInput.checked = rule.enabled !== false;
        const toggleTrack = document.createElement("span");
        toggleTrack.className = "switch-track";
        toggle.appendChild(toggleInput);
        toggle.appendChild(toggleTrack);
        toggleInput.addEventListener("change", () => {
            void mutateRules(settings.preferredAccountRules.map((existing) => {
                if (existing.id !== rule.id) return existing;
                const updated = {...existing};
                if (toggleInput.checked) delete updated.enabled;
                else updated.enabled = false;
                return updated;
            }));
        });

        const makeIconBtn = (icon, label, className = "icon-btn") => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = className;
            button.appendChild(createIcon(icon));
            button.setAttribute("aria-label", label);
            button.title = label;
            return button;
        };

        const copyBtn = makeIconBtn("copy", `Copy link for ${ruleName}`);
        let copyResetTimer = null;
        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(`https://${ruleName}`);
                // Confirm in place — a toast would cover the list on a small popup.
                clearTimeout(copyResetTimer);
                copyBtn.replaceChildren(createIcon("check"));
                copyBtn.classList.add("is-done");
                copyResetTimer = setTimeout(() => {
                    copyBtn.replaceChildren(createIcon("copy"));
                    copyBtn.classList.remove("is-done");
                }, 1400);
            } catch {
                showToast("Could not copy the link", {variant: "error"});
            }
        });

        const editBtn = makeIconBtn("edit", `Edit rule for ${ruleName}`);
        editBtn.setAttribute("aria-expanded", "false");

        const removeBtn = makeIconBtn("trash", `Remove rule for ${ruleName}`, "icon-btn icon-btn-danger");
        removeBtn.addEventListener("click", () => {
            void mutateRules(
                settings.preferredAccountRules.filter((existing) => existing.id !== rule.id),
                "Rule removed"
            );
        });

        const actionBtns = document.createElement("div");
        actionBtns.className = "history-action-btns";
        actionBtns.appendChild(copyBtn);
        actionBtns.appendChild(editBtn);
        actionBtns.appendChild(removeBtn);

        const editor = document.createElement("div");
        editor.className = "history-editor";
        editor.hidden = true;

        const pathInput = document.createElement("input");
        pathInput.type = "text";
        pathInput.className = "field";
        pathInput.value = rule.targetPathPrefix ?? "";
        pathInput.placeholder = "Path or full link — empty covers the whole service";
        pathInput.setAttribute("aria-label", `Path for ${ruleName}`);

        const accountInput = document.createElement("input");
        accountInput.type = "text";
        accountInput.className = "field";
        accountInput.value = rule.authuser;
        accountInput.placeholder = "Account number or email";
        accountInput.setAttribute("aria-label", `Account for ${ruleName}`);

        const saveEditBtn = document.createElement("button");
        saveEditBtn.className = "btn btn-primary";
        saveEditBtn.textContent = "Save";

        let saveEditArmTimer = null;

        const disarmSaveEditBtn = () => {
            clearTimeout(saveEditArmTimer);
            saveEditArmTimer = null;
            saveEditBtn.textContent = "Save";
            delete saveEditBtn.dataset.armed;
        };

        const commitEdit = () => {
            const account = sanitizeAuthuserInput(accountInput.value);
            if (!isValidAuthuser(account)) {
                showToast("Enter an account number or email", {variant: "error"});
                return;
            }

            const path = sanitizePathPrefixInput(pathInput.value);
            if (account === rule.authuser && path === (rule.targetPathPrefix ?? "")) {
                editor.hidden = true;
                return;
            }

            const collider = findRuleByKey(
                settings.preferredAccountRules.filter((existing) => existing.id !== rule.id),
                {targetDomain: rule.targetDomain, targetPathPrefix: path, sourceDomain: rule.sourceDomain ?? ""}
            );

            if (collider && collider.authuser === account) {
                // The edit would duplicate an existing rule — keep that one, drop this one.
                void mutateRules(
                    settings.preferredAccountRules.filter((existing) => existing.id !== rule.id),
                    "Merged with the existing identical rule"
                );
                return;
            }

            if (collider) {
                // Two-step confirm: native dialogs can dismiss the popup.
                if (!saveEditBtn.dataset.armed) {
                    saveEditBtn.dataset.armed = "true";
                    saveEditBtn.textContent = "Replace existing?";
                    saveEditArmTimer = setTimeout(disarmSaveEditBtn, 4000);
                    return;
                }
                disarmSaveEditBtn();
                void mutateRules(
                    settings.preferredAccountRules
                        .filter((existing) => existing.id !== collider.id)
                        .map((existing) =>
                            existing.id === rule.id ? {...existing, targetPathPrefix: path, authuser: account} : existing),
                    "Rule updated"
                );
                return;
            }

            void mutateRules(
                settings.preferredAccountRules.map((existing) =>
                    existing.id === rule.id ? {...existing, targetPathPrefix: path, authuser: account} : existing),
                "Rule updated"
            );
        };

        saveEditBtn.addEventListener("click", commitEdit);
        for (const input of [pathInput, accountInput]) {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") commitEdit();
            });
            // Changing the inputs invalidates a pending "Replace existing?" confirmation.
            input.addEventListener("input", disarmSaveEditBtn);
        }
        editBtn.addEventListener("click", () => {
            editor.hidden = !editor.hidden;
            editBtn.setAttribute("aria-expanded", editor.hidden ? "false" : "true");
            editBtn.classList.toggle("is-active", !editor.hidden);
            if (!editor.hidden) pathInput.focus();
        });

        const editorRow = document.createElement("div");
        editorRow.className = "history-editor-row";
        editorRow.appendChild(accountInput);
        editorRow.appendChild(saveEditBtn);
        editor.appendChild(pathInput);
        editor.appendChild(editorRow);

        inner.appendChild(path);
        inner.appendChild(toggle);
        inner.appendChild(tags);
        inner.appendChild(actionBtns);
        inner.appendChild(editor);
        container.appendChild(inner);

        return container;
    };

    let clearHistoryArmTimer = null;

    const disarmClearHistoryBtn = () => {
        clearTimeout(clearHistoryArmTimer);
        clearHistoryArmTimer = null;
        clearHistoryBtn.textContent = "Remove all";
        delete clearHistoryBtn.dataset.armed;
    };

    // One card per target service; the domain lives in the header so each row
    // only has to show the part that differs.
    const createHistoryGroup = (domain, rules) => {
        const serviceLabel = serviceLabelForDomain(domain);

        const group = document.createElement("section");
        group.className = "card history-group";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", domain);

        const head = document.createElement("div");
        head.className = "history-group-head";

        const avatar = document.createElement("span");
        avatar.className = "history-avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = (serviceLabel ?? domain).charAt(0);

        const text = document.createElement("div");
        text.className = "history-group-text";

        const name = document.createElement("span");
        name.className = "history-group-name";
        name.textContent = serviceLabel ?? domain;
        text.appendChild(name);

        if (serviceLabel) {
            const host = document.createElement("span");
            host.className = "history-group-domain";
            host.textContent = domain;
            text.appendChild(host);
        }

        const count = document.createElement("span");
        count.className = "chip chip-xs";
        count.textContent = String(rules.length);
        count.title = `${rules.length} saved link${rules.length === 1 ? "" : "s"}`;

        head.appendChild(avatar);
        head.appendChild(text);
        head.appendChild(count);

        const rows = document.createElement("div");
        rows.className = "history-rows";
        rows.setAttribute("role", "list");
        rows.setAttribute("aria-label", `Saved links for ${domain}`);
        for (const rule of rules) rows.appendChild(createHistoryItem(rule));

        group.appendChild(head);
        group.appendChild(rows);

        return group;
    };

    const renderHistory = () => {
        disarmClearHistoryBtn();
        historyList.replaceChildren();

        const rules = settings.preferredAccountRules;
        const groups = new Map();

        for (const rule of rules) {
            if (!groups.has(rule.targetDomain)) groups.set(rule.targetDomain, []);
            groups.get(rule.targetDomain).push(rule);
        }

        for (const domain of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
            // Service-wide rule (empty prefix) first, then paths alphabetically.
            const sorted = groups.get(domain).sort((a, b) =>
                (a.targetPathPrefix ?? "").localeCompare(b.targetPathPrefix ?? ""));
            historyList.appendChild(createHistoryGroup(domain, sorted));
        }

        if (!rules.length) {
            const empty = createEmptyState("Nothing saved yet. Pick an account via the chooser, then accept the save prompt.");
            empty.removeAttribute("role");
            historyList.appendChild(empty);
        }

        clearHistoryBtn.hidden = !rules.length;
        historyTabCount.textContent = String(rules.length);
        historyTabCount.hidden = !rules.length;
    };

    clearHistoryBtn.addEventListener("click", () => {
        // Two-step confirm: native dialogs can dismiss the popup.
        if (!clearHistoryBtn.dataset.armed) {
            clearHistoryBtn.dataset.armed = "true";
            clearHistoryBtn.textContent = "Really remove all?";
            clearHistoryArmTimer = setTimeout(disarmClearHistoryBtn, 4000);
            return;
        }

        disarmClearHistoryBtn();
        void mutateRules([], "All rules removed");
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "sync" || !("preferredAccountRules" in changes)) return;
        const next = changes.preferredAccountRules.newValue;
        settings.preferredAccountRules = Array.isArray(next) ? next : [];
        renderHistory();
        renderSuggestedRuleHint();
    });

    const refreshActiveTabContext = async () => {
        try {
            const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
            activeTabId = activeTab?.id ?? null;

            const url = activeTab?.url ? new URL(activeTab.url) : null;
            activeTabHostname = url && (url.protocol === "http:" || url.protocol === "https:")
                ? url.hostname
                : null;
        } catch (error) {
            console.error("Failed to inspect active tab:", error);
            activeTabId = null;
            activeTabHostname = null;
        }

        renderContextCard();

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

    contextExcludeBtn.addEventListener("click", async () => {
        if (!activeTabHostname) return;

        const isExcluded = domainMatchesList(activeTabHostname, settings.excludedSourceSites);
        const previous = [...settings.excludedSourceSites];

        if (isExcluded) {
            settings.excludedSourceSites = settings.excludedSourceSites.filter(
                (site) => activeTabHostname !== site && !activeTabHostname.endsWith(`.${site}`)
            );
        } else {
            settings.excludedSourceSites = [...settings.excludedSourceSites, activeTabHostname];
        }

        try {
            await persistSettings();
            renderContextCard();
            showToast(isExcluded
                ? `${activeTabHostname} is intercepted again`
                : `${activeTabHostname} excluded`);
        } catch (error) {
            settings.excludedSourceSites = previous;
            showToast(error.message, {variant: "error"});
        }
    });

    useSuggestedRuleBtn.addEventListener("click", async () => {
        if (!suggestedRuleCandidate) return;

        const newRule = {
            id: createRuleId(),
            ...suggestedRuleAsCandidate(),
        };

        const existing = findRuleByKey(settings.preferredAccountRules, newRule);

        if (existing && existing.authuser === newRule.authuser) {
            renderSuggestedRuleHint();
            return;
        }

        if (existing) {
            // Two-step confirm: native dialogs can dismiss the popup.
            if (!useSuggestedRuleBtn.dataset.armed) {
                useSuggestedRuleBtn.dataset.armed = "true";
                useSuggestedRuleBtn.textContent = "Really replace?";
                suggestedRuleArmTimer = setTimeout(disarmUseSuggestedRuleBtn, 4000);
                return;
            }
            disarmUseSuggestedRuleBtn();
        }

        const previousRules = settings.preferredAccountRules;
        settings.preferredAccountRules = existing
            ? settings.preferredAccountRules.map((rule) =>
                rule.id === existing.id ? {...rule, authuser: newRule.authuser} : rule)
            : [...settings.preferredAccountRules, newRule];

        try {
            await persistSettings();
            renderSuggestedRuleHint();
            renderHistory();
            showToast(existing ? "Rule updated" : "Rule saved");

            if (typeof activeTabId === "number") {
                chrome.runtime.sendMessage({type: "consumeSuggestedRule", tabId: activeTabId}).catch(() => {});
            }
        } catch (error) {
            settings.preferredAccountRules = previousRules;
            showToast(error.message, {variant: "error"});
        }
    });

    enabled.addEventListener("change", async () => {
        try {
            await persistSettings();
            updateEnabledState();
        } catch (error) {
            enabled.checked = !enabled.checked;
            updateEnabledState();
            showToast(error.message, {variant: "error"});
        }
    });

    [skipIfAccountSpecified, interceptExternalClicks, interceptDirectNavigation, interceptGoogleNavigation, dnrInterception, autoSaveSuggestedRules]
        .forEach((input) => {
            input.addEventListener("change", async () => {
                try {
                    await persistSettings();
                } catch (error) {
                    input.checked = !input.checked;
                    showToast(error.message, {variant: "error"});
                }
            });
        });

    openOptionsBtn.addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
    });

    enabled.checked = settings.enabled;
    skipIfAccountSpecified.checked = settings.skipIfAccountSpecified;
    interceptExternalClicks.checked = settings.interceptExternalClicks;
    interceptDirectNavigation.checked = settings.interceptDirectNavigation;
    interceptGoogleNavigation.checked = settings.interceptGoogleNavigation;
    dnrInterception.checked = settings.dnrInterception;
    autoSaveSuggestedRules.checked = settings.autoSaveSuggestedRules;
    versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

    updateEnabledState();
    renderHistory();
    await refreshActiveTabContext();
});
