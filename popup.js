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

    const renderThemeButton = () => {
        themeToggleBtn.textContent = `Theme: ${THEME_LABELS[currentTheme]}`;
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

        const text = document.createElement("div");
        text.className = "history-text";

        const name = document.createElement("span");
        name.className = "history-name";
        name.textContent = ruleName;

        const meta = document.createElement("span");
        meta.className = "history-meta";
        const scope = rule.targetPathPrefix ? "Document" : "Service";
        const source = rule.sourceDomain ? ` · from ${rule.sourceDomain}` : "";
        meta.textContent = `${scope} · ${formatAuthuserLabel(rule.authuser, settings.accountLabels)}${source}`;

        text.appendChild(name);
        text.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "history-actions";

        const toggle = document.createElement("label");
        toggle.className = "switch";
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

        const copyBtn = document.createElement("button");
        copyBtn.className = "btn btn-ghost";
        copyBtn.textContent = "Copy";
        copyBtn.setAttribute("aria-label", `Copy link for ${ruleName}`);
        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(`https://${ruleName}`);
                showToast("Link copied");
            } catch {
                showToast("Could not copy the link", {variant: "error"});
            }
        });

        const editBtn = document.createElement("button");
        editBtn.className = "btn btn-ghost";
        editBtn.textContent = "Edit";
        editBtn.setAttribute("aria-label", `Edit rule for ${ruleName}`);

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-danger-ghost";
        removeBtn.textContent = "✕";
        removeBtn.setAttribute("aria-label", `Remove rule for ${ruleName}`);
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
        actions.appendChild(toggle);
        actions.appendChild(actionBtns);

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
            if (!editor.hidden) pathInput.focus();
        });

        const editorRow = document.createElement("div");
        editorRow.className = "history-editor-row";
        editorRow.appendChild(accountInput);
        editorRow.appendChild(saveEditBtn);
        editor.appendChild(pathInput);
        editor.appendChild(editorRow);

        inner.appendChild(text);
        inner.appendChild(actions);
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

    const renderHistory = () => {
        disarmClearHistoryBtn();
        historyList.innerHTML = "";

        const sorted = [...settings.preferredAccountRules].sort((a, b) =>
            a.targetDomain.localeCompare(b.targetDomain) ||
            (a.targetPathPrefix ?? "").localeCompare(b.targetPathPrefix ?? ""));

        for (const rule of sorted) {
            historyList.appendChild(createHistoryItem(rule));
        }

        if (!sorted.length) {
            historyList.appendChild(createEmptyState("Nothing saved yet. Pick an account via the chooser, then accept the save prompt."));
        }

        clearHistoryBtn.hidden = !sorted.length;
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
