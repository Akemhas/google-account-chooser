document.addEventListener("DOMContentLoaded", async () => {
    const tabs = Array.from(document.querySelectorAll(".nav-tab"));
    const panels = new Map(
        Array.from(document.querySelectorAll(".options-panel")).map((panel) => [panel.id, panel])
    );

    const ruleSearch = document.getElementById("ruleSearch");
    const quotaWarning = document.getElementById("quotaWarning");
    const savedDocumentRulesList = document.getElementById("savedDocumentRulesList");
    const preferredRulesList = document.getElementById("preferredRulesList");
    const clearDocumentRulesBtn = document.getElementById("clearDocumentRulesBtn");
    const clearServiceRulesBtn = document.getElementById("clearServiceRulesBtn");
    const accountLabelsList = document.getElementById("accountLabelsList");
    const mutedSuggestionsList = document.getElementById("mutedSuggestionsList");
    const clearMutedBtn = document.getElementById("clearMutedBtn");
    const rulePresetGrid = document.getElementById("rulePresetGrid");
    const ruleBuilderTitle = document.getElementById("ruleBuilderTitle");
    const preferredTargetInput = document.getElementById("preferredTargetInput");
    const preferredTargetPathInput = document.getElementById("preferredTargetPathInput");
    const preferredAuthuserInput = document.getElementById("preferredAuthuserInput");
    const preferredSourceInput = document.getElementById("preferredSourceInput");
    const preferredLabelInput = document.getElementById("preferredLabelInput");
    const addPreferredRuleBtn = document.getElementById("addPreferredRuleBtn");
    const cancelEditRuleBtn = document.getElementById("cancelEditRuleBtn");
    const exportBtn = document.getElementById("exportBtn");
    const importBtn = document.getElementById("importBtn");
    const importFileInput = document.getElementById("importFileInput");

    const targetSearch = document.getElementById("targetSearch");
    const targetPresetGrid = document.getElementById("targetPresetGrid");
    const targetsList = document.getElementById("targetsList");
    const targetInput = document.getElementById("targetInput");
    const addTargetBtn = document.getElementById("addTargetBtn");

    const excludedSearch = document.getElementById("excludedSearch");
    const excludedList = document.getElementById("excludedList");
    const excludedInput = document.getElementById("excludedInput");
    const addExcludedBtn = document.getElementById("addExcludedBtn");

    const versionLabel = document.getElementById("versionLabel");
    const shortcutsLink = document.getElementById("shortcutsLink");
    const themeSelect = document.getElementById("themeSelect");

    themeSelect.value = await initTheme();
    themeSelect.addEventListener("change", () => {
        void setTheme(themeSelect.value);
    });

    let settings;

    const {settings: loaded, error: loadError} = await loadSettings();
    settings = loaded;
    if (loadError) showToast("Failed to load settings", {variant: "error"});

    let editingRuleId = null;

    const persistSettings = async () => {
        await saveSettings({
            targetSites: settings.targetSites,
            excludedSourceSites: settings.excludedSourceSites,
            preferredAccountRules: settings.preferredAccountRules,
            accountLabels: settings.accountLabels,
        });
    };

    // --- Tab navigation (roving tabindex, vertical) ---

    const activateTab = (tab) => {
        tabs.forEach((other) => {
            const isActive = other === tab;
            other.setAttribute("aria-selected", isActive ? "true" : "false");
            other.tabIndex = isActive ? 0 : -1;
        });

        for (const [id, panel] of panels) {
            panel.hidden = id !== `panel-${tab.dataset.panel}`;
        }
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activateTab(tab));
        tab.addEventListener("keydown", (e) => {
            let nextIndex = null;
            if (e.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
            else if (e.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
            else if (e.key === "Home") nextIndex = 0;
            else if (e.key === "End") nextIndex = tabs.length - 1;

            if (nextIndex !== null) {
                e.preventDefault();
                activateTab(tabs[nextIndex]);
                tabs[nextIndex].focus();
            }
        });
    });

    // --- Rules ---

    const createRuleItem = (rule) => {
        const container = document.createElement("div");
        container.className = "list-item";
        container.classList.toggle("is-rule-disabled", rule.enabled === false);
        container.setAttribute("role", "listitem");
        container.dataset.search = `${rule.targetDomain}${rule.targetPathPrefix ?? ""} ${rule.sourceDomain ?? ""} ${rule.authuser} ${settings.accountLabels[rule.authuser] ?? ""}`.toLowerCase();

        const inner = document.createElement("div");
        inner.className = "list-item-inner";

        const textBlock = document.createElement("div");
        textBlock.className = "rule-text-block";

        const name = document.createElement("span");
        name.className = "item-name";
        name.textContent = `${rule.targetDomain}${rule.targetPathPrefix ?? ""}`;

        const meta = document.createElement("span");
        meta.className = "rule-meta-line";
        meta.textContent = rule.sourceDomain
            ? `Only from ${rule.sourceDomain}`
            : "From any source";

        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = formatAuthuserLabel(rule.authuser, settings.accountLabels);

        const toggle = document.createElement("label");
        toggle.className = "switch";
        toggle.setAttribute("aria-label", `Enable rule for ${rule.targetDomain}${rule.targetPathPrefix ?? ""}`);
        const toggleInput = document.createElement("input");
        toggleInput.type = "checkbox";
        toggleInput.checked = rule.enabled !== false;
        toggleInput.dataset.ruleId = rule.id;
        toggleInput.className = "rule-toggle";
        const toggleTrack = document.createElement("span");
        toggleTrack.className = "switch-track";
        toggle.appendChild(toggleInput);
        toggle.appendChild(toggleTrack);

        const editBtn = document.createElement("button");
        editBtn.className = "btn btn-ghost edit-btn";
        editBtn.textContent = "Edit";
        editBtn.setAttribute("aria-label", `Edit rule for ${rule.targetDomain}${rule.targetPathPrefix ?? ""}`);
        editBtn.dataset.ruleId = rule.id;

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-danger-ghost remove-btn";
        removeBtn.textContent = "Remove";
        removeBtn.setAttribute("aria-label", `Remove rule for ${rule.targetDomain}${rule.targetPathPrefix ?? ""}`);
        removeBtn.dataset.ruleId = rule.id;

        const side = document.createElement("div");
        side.className = "rule-side";
        side.appendChild(badge);
        side.appendChild(toggle);
        side.appendChild(editBtn);
        side.appendChild(removeBtn);

        textBlock.appendChild(name);
        textBlock.appendChild(meta);
        inner.appendChild(textBlock);
        inner.appendChild(side);
        container.appendChild(inner);

        return container;
    };

    const renderAccountLabels = () => {
        accountLabelsList.innerHTML = "";

        const entries = Object.entries(settings.accountLabels);
        if (!entries.length) {
            accountLabelsList.appendChild(createEmptyState("No labels yet. Add one from the rule builder's label field."));
            return;
        }

        for (const [authuser, label] of entries.sort(([a], [b]) => a.localeCompare(b))) {
            const container = document.createElement("div");
            container.className = "list-item";
            container.setAttribute("role", "listitem");

            const inner = document.createElement("div");
            inner.className = "list-item-inner";

            const name = document.createElement("span");
            name.className = "item-name";
            name.textContent = `authuser=${authuser} · ${label}`;

            const removeBtn = document.createElement("button");
            removeBtn.className = "btn btn-danger-ghost";
            removeBtn.textContent = "Remove";
            removeBtn.setAttribute("aria-label", `Remove label for authuser ${authuser}`);
            removeBtn.addEventListener("click", async () => {
                const previous = {...settings.accountLabels};
                delete settings.accountLabels[authuser];

                try {
                    await persistSettings();
                    renderRules();
                    showToast("Label removed");
                } catch (error) {
                    settings.accountLabels = previous;
                    showToast(error.message, {variant: "error"});
                }
            });

            inner.appendChild(name);
            inner.appendChild(removeBtn);
            container.appendChild(inner);
            accountLabelsList.appendChild(container);
        }
    };

    const renderMutedSuggestions = () => {
        mutedSuggestionsList.innerHTML = "";

        const entries = settings.mutedSuggestions;
        clearMutedBtn.hidden = !entries.length;

        if (!entries.length) {
            mutedSuggestionsList.appendChild(createEmptyState("Nothing here. Choosing \"Never\" on the on-page save prompt adds entries."));
            return;
        }

        for (const entry of [...entries].sort((a, b) =>
            a.targetDomain.localeCompare(b.targetDomain) ||
            (a.targetPathPrefix ?? "").localeCompare(b.targetPathPrefix ?? ""))) {
            const container = document.createElement("div");
            container.className = "list-item";
            container.setAttribute("role", "listitem");

            const inner = document.createElement("div");
            inner.className = "list-item-inner";

            const name = document.createElement("span");
            name.className = "item-name";
            name.textContent = `${entry.targetDomain}${entry.targetPathPrefix ?? ""}`;

            const removeBtn = document.createElement("button");
            removeBtn.className = "btn btn-danger-ghost";
            removeBtn.textContent = "Remove";
            removeBtn.setAttribute("aria-label", `Remove never-ask entry for ${entry.targetDomain}${entry.targetPathPrefix ?? ""}`);
            removeBtn.addEventListener("click", async () => {
                const previous = settings.mutedSuggestions;
                settings.mutedSuggestions = previous.filter((item) => item !== entry);

                try {
                    await saveSettings({mutedSuggestions: settings.mutedSuggestions});
                    renderMutedSuggestions();
                    showToast("Entry removed");
                } catch (error) {
                    settings.mutedSuggestions = previous;
                    showToast(error.message, {variant: "error"});
                }
            });

            inner.appendChild(name);
            inner.appendChild(removeBtn);
            container.appendChild(inner);
            mutedSuggestionsList.appendChild(container);
        }
    };

    clearMutedBtn.addEventListener("click", async () => {
        if (!settings.mutedSuggestions.length) return;
        if (!confirm("Remove all never-ask entries?")) return;

        const previous = settings.mutedSuggestions;
        settings.mutedSuggestions = [];

        try {
            await saveSettings({mutedSuggestions: settings.mutedSuggestions});
            renderMutedSuggestions();
            showToast(`${previous.length} entries removed`);
        } catch (error) {
            settings.mutedSuggestions = previous;
            showToast(error.message, {variant: "error"});
        }
    });

    const renderRules = () => {
        savedDocumentRulesList.innerHTML = "";
        preferredRulesList.innerHTML = "";

        const sorted = [...settings.preferredAccountRules].sort((a, b) =>
            a.targetDomain.localeCompare(b.targetDomain) ||
            (a.targetPathPrefix ?? "").localeCompare(b.targetPathPrefix ?? "") ||
            (a.sourceDomain ?? "").localeCompare(b.sourceDomain ?? "") ||
            a.authuser.localeCompare(b.authuser));

        for (const rule of sorted) {
            const list = rule.targetPathPrefix ? savedDocumentRulesList : preferredRulesList;
            list.appendChild(createRuleItem(rule));
        }

        clearDocumentRulesBtn.hidden = !sorted.some((rule) => rule.targetPathPrefix);
        clearServiceRulesBtn.hidden = !sorted.some((rule) => !rule.targetPathPrefix);

        if (!savedDocumentRulesList.children.length) {
            savedDocumentRulesList.appendChild(createEmptyState("No document-specific rules saved yet."));
        }
        if (!preferredRulesList.children.length) {
            preferredRulesList.appendChild(createEmptyState("No service-wide rules saved yet."));
        }

        quotaWarning.hidden = JSON.stringify(settings.preferredAccountRules).length <= RULES_QUOTA_WARNING_BYTES;
        renderAccountLabels();
        applyRuleSearch();
    };

    const applyRuleSearch = () => {
        const term = ruleSearch.value.toLowerCase().trim();
        for (const list of [savedDocumentRulesList, preferredRulesList]) {
            for (const item of list.querySelectorAll(".list-item")) {
                item.style.display = !term || item.dataset.search.includes(term) ? "" : "none";
            }
        }
    };

    ruleSearch.addEventListener("input", applyRuleSearch);

    const removeRule = async (ruleId) => {
        const previous = settings.preferredAccountRules;
        settings.preferredAccountRules = previous.filter((rule) => rule.id !== ruleId);

        try {
            await persistSettings();
            renderRules();
            showToast("Rule removed");
        } catch (error) {
            settings.preferredAccountRules = previous;
            showToast(error.message, {variant: "error"});
        }
    };

    const clearBuilder = () => {
        preferredTargetInput.value = "";
        preferredTargetPathInput.value = "";
        preferredSourceInput.value = "";
        preferredAuthuserInput.value = "";
        preferredLabelInput.value = "";
    };

    const exitEditMode = () => {
        editingRuleId = null;
        ruleBuilderTitle.textContent = "Create Rule";
        addPreferredRuleBtn.textContent = "Save Rule";
        cancelEditRuleBtn.hidden = true;
        clearBuilder();
    };

    const enterEditMode = (rule) => {
        editingRuleId = rule.id;
        ruleBuilderTitle.textContent = "Edit Rule";
        addPreferredRuleBtn.textContent = "Update Rule";
        cancelEditRuleBtn.hidden = false;
        preferredTargetInput.value = rule.targetDomain;
        preferredTargetPathInput.value = rule.targetPathPrefix ?? "";
        preferredSourceInput.value = rule.sourceDomain ?? "";
        preferredAuthuserInput.value = rule.authuser;
        preferredLabelInput.value = settings.accountLabels[rule.authuser] ?? "";
        preferredTargetInput.focus();
    };

    const clearRules = async (shouldRemove, confirmMessage) => {
        const previous = settings.preferredAccountRules;
        const remaining = previous.filter((rule) => !shouldRemove(rule));
        if (remaining.length === previous.length) return;
        if (!confirm(confirmMessage)) return;

        if (editingRuleId && !remaining.some((rule) => rule.id === editingRuleId)) {
            exitEditMode();
        }
        settings.preferredAccountRules = remaining;

        try {
            await persistSettings();
            renderRules();
            showToast(`${previous.length - remaining.length} rules removed`);
        } catch (error) {
            settings.preferredAccountRules = previous;
            showToast(error.message, {variant: "error"});
        }
    };

    clearDocumentRulesBtn.addEventListener("click", () => clearRules(
        (rule) => Boolean(rule.targetPathPrefix),
        "Remove all saved document rules? This cannot be undone."
    ));
    clearServiceRulesBtn.addEventListener("click", () => clearRules(
        (rule) => !rule.targetPathPrefix,
        "Remove all service-wide rules? This cannot be undone."
    ));

    const toggleRuleEnabled = async (ruleId, isEnabled) => {
        const previous = settings.preferredAccountRules;
        settings.preferredAccountRules = previous.map((rule) => {
            if (rule.id !== ruleId) return rule;
            const updated = {...rule};
            if (isEnabled) delete updated.enabled;
            else updated.enabled = false;
            return updated;
        });

        try {
            await persistSettings();
            renderRules();
        } catch (error) {
            settings.preferredAccountRules = previous;
            renderRules();
            showToast(error.message, {variant: "error"});
        }
    };

    for (const list of [savedDocumentRulesList, preferredRulesList]) {
        list.addEventListener("click", (e) => {
            const ruleId = e.target.dataset?.ruleId;
            if (!ruleId) return;

            if (e.target.classList.contains("remove-btn")) {
                if (ruleId === editingRuleId) exitEditMode();
                removeRule(ruleId);
            } else if (e.target.classList.contains("edit-btn")) {
                const rule = settings.preferredAccountRules.find((r) => r.id === ruleId);
                if (rule) enterEditMode(rule);
            }
        });

        list.addEventListener("change", (e) => {
            const ruleId = e.target.dataset?.ruleId;
            if (ruleId && e.target.classList.contains("rule-toggle")) {
                toggleRuleEnabled(ruleId, e.target.checked);
            }
        });
    }

    const saveRuleFromBuilder = async () => {
        const targetDomain = sanitizeDomainInput(preferredTargetInput.value);
        const targetPathPrefix = sanitizePathPrefixInput(preferredTargetPathInput.value);
        const sourceDomain = preferredSourceInput.value.trim()
            ? sanitizeDomainInput(preferredSourceInput.value)
            : "";
        const authuser = sanitizeAuthuserInput(preferredAuthuserInput.value);
        const label = preferredLabelInput.value.trim().slice(0, 32);

        if (!targetDomain || !isValidDomain(targetDomain)) {
            showToast("Rules need a valid target domain", {variant: "error"});
            return;
        }

        if (sourceDomain && !isValidDomain(sourceDomain)) {
            showToast("Source domain must be empty or a valid domain", {variant: "error"});
            return;
        }

        if (!isValidAuthuser(authuser)) {
            showToast("Account hint must be a non-empty authuser value", {variant: "error"});
            return;
        }

        const existing = editingRuleId
            ? settings.preferredAccountRules.find((rule) => rule.id === editingRuleId)
            : null;
        const candidate = {
            ...(existing ?? {}),
            id: existing?.id ?? createRuleId(),
            targetDomain,
            targetPathPrefix,
            sourceDomain,
            authuser,
        };

        // Rules behave as a dictionary: (targetDomain, targetPathPrefix, sourceDomain) → authuser.
        const collider = settings.preferredAccountRules.find((rule) =>
            rule.id !== candidate.id &&
            rule.targetDomain === targetDomain &&
            (rule.targetPathPrefix ?? "") === targetPathPrefix &&
            (rule.sourceDomain ?? "") === sourceDomain);

        const previousRules = settings.preferredAccountRules;
        const previousLabels = {...settings.accountLabels};
        let nextRules;
        let successMessage;

        if (collider && collider.authuser === authuser) {
            if (!existing) {
                showToast("That rule already exists", {variant: "error"});
                return;
            }
            // Editing turned this rule into a copy of another: apply the edit, drop the copy.
            nextRules = previousRules
                .filter((rule) => rule.id !== collider.id)
                .map((rule) => (rule.id === candidate.id ? candidate : rule));
            successMessage = "Merged with the existing identical rule";
        } else if (collider) {
            const keyDescription = `${targetDomain}${targetPathPrefix}${sourceDomain ? ` (from ${sourceDomain})` : ""}`;
            if (!confirm(`A rule for ${keyDescription} already opens with account ${collider.authuser}. Replace it with account ${authuser}?`)) {
                return;
            }
            nextRules = existing
                ? previousRules
                    .filter((rule) => rule.id !== collider.id)
                    .map((rule) => (rule.id === candidate.id ? candidate : rule))
                : previousRules.map((rule) => (rule.id === collider.id ? {...rule, authuser} : rule));
            successMessage = "Rule updated";
        } else {
            nextRules = existing
                ? previousRules.map((rule) => (rule.id === candidate.id ? candidate : rule))
                : [...previousRules, candidate];
            successMessage = existing ? "Rule updated" : "Rule saved";
        }

        settings.preferredAccountRules = nextRules;
        if (label) {
            settings.accountLabels = {...settings.accountLabels, [authuser]: label};
        }

        try {
            await persistSettings();
            exitEditMode();
            renderRules();
            showToast(successMessage);
        } catch (error) {
            settings.preferredAccountRules = previousRules;
            settings.accountLabels = previousLabels;
            showToast(error.message, {variant: "error"});
        }
    };

    addPreferredRuleBtn.addEventListener("click", saveRuleFromBuilder);
    cancelEditRuleBtn.addEventListener("click", exitEditMode);
    preferredAuthuserInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void saveRuleFromBuilder();
    });

    // --- Site lists (targets + excluded) ---

    const renderSiteList = (listElement, sites, emptyText) => {
        listElement.innerHTML = "";
        for (const site of [...sites].sort()) {
            listElement.appendChild(createSiteListItem(site));
        }
        if (!sites.length) {
            listElement.appendChild(createEmptyState(emptyText));
        }
    };

    const renderTargets = () => renderSiteList(
        targetsList, settings.targetSites,
        "No target sites. Add a Google service domain to start intercepting its links.");
    const renderExcluded = () => renderSiteList(
        excludedList, settings.excludedSourceSites,
        "Nothing excluded. Add a site here (or from the popup) to stop intercepting its links.");

    const addSite = async (inputElement, key, render) => {
        const site = sanitizeDomainInput(inputElement.value);

        if (!site) {
            showToast("Please enter a domain", {variant: "error"});
            return;
        }

        if (!isValidDomain(site)) {
            showToast("Invalid domain format. Use: example.com or sub.example.com", {variant: "error"});
            return;
        }

        if (settings[key].includes(site)) {
            showToast("Site already exists", {variant: "error"});
            return;
        }

        const previous = settings[key];
        settings[key] = [...previous, site];

        try {
            await persistSettings();
            inputElement.value = "";
            render();
            showToast(`${site} added`);
        } catch (error) {
            settings[key] = previous;
            showToast(error.message, {variant: "error"});
        }
    };

    const removeSite = async (site, element, key, render) => {
        const previous = settings[key];
        settings[key] = previous.filter((s) => s !== site);

        try {
            await persistSettings();
            await animateListItemOut(element);
            render();
            showToast(`${site} removed`);
        } catch (error) {
            settings[key] = previous;
            element.classList.remove("is-removing");
            showToast(error.message, {variant: "error"});
        }
    };

    targetsList.addEventListener("click", (e) => {
        const site = e.target.dataset?.site;
        if (site && e.target.classList.contains("remove-btn")) {
            removeSite(site, e.target.closest(".list-item"), "targetSites", renderTargets);
        }
    });

    excludedList.addEventListener("click", (e) => {
        const site = e.target.dataset?.site;
        if (site && e.target.classList.contains("remove-btn")) {
            removeSite(site, e.target.closest(".list-item"), "excludedSourceSites", renderExcluded);
        }
    });

    addTargetBtn.addEventListener("click", () => addSite(targetInput, "targetSites", renderTargets));
    addExcludedBtn.addEventListener("click", () => addSite(excludedInput, "excludedSourceSites", renderExcluded));

    targetInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addTargetBtn.click();
    });
    excludedInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addExcludedBtn.click();
    });

    const filterSiteList = (term, listElement) => {
        const normalized = term.toLowerCase().trim();
        for (const item of listElement.querySelectorAll(".list-item")) {
            item.style.display = !normalized || (item.dataset.site ?? "").includes(normalized) ? "" : "none";
        }
    };

    targetSearch.addEventListener("input", (e) => filterSiteList(e.target.value, targetsList));
    excludedSearch.addEventListener("input", (e) => filterSiteList(e.target.value, excludedList));

    // --- Presets ---

    for (const preset of SERVICE_PRESETS) {
        const targetChip = document.createElement("button");
        targetChip.className = "preset-chip";
        targetChip.textContent = preset.label;
        targetChip.addEventListener("click", () => {
            targetInput.value = preset.domain;
            addSite(targetInput, "targetSites", renderTargets);
        });
        targetPresetGrid.appendChild(targetChip);

        const ruleChip = document.createElement("button");
        ruleChip.className = "preset-chip";
        ruleChip.textContent = preset.label;
        ruleChip.addEventListener("click", () => {
            preferredTargetInput.value = preset.domain;
            if (!preferredAuthuserInput.value.trim()) preferredAuthuserInput.focus();
        });
        rulePresetGrid.appendChild(ruleChip);
    }

    // --- Backup ---

    exportBtn.addEventListener("click", () => {
        const payload = buildSettingsExport(settings, chrome.runtime.getManifest().version);
        const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        anchor.href = url;
        anchor.download = `gacr-settings-${stamp}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("Settings exported");
    });

    importBtn.addEventListener("click", () => importFileInput.click());

    importFileInput.addEventListener("change", async () => {
        const file = importFileInput.files?.[0];
        importFileInput.value = "";
        if (!file) return;

        let validated;
        try {
            validated = validateImport(JSON.parse(await file.text()));
        } catch (error) {
            showToast(error instanceof SyntaxError ? "That file is not valid JSON" : error.message, {variant: "error"});
            return;
        }

        const mode = document.querySelector('input[name="importMode"]:checked')?.value ?? "merge";
        const imported = validated.settings;
        let next;

        if (mode === "replace") {
            next = normalizeSettings(imported);
        } else {
            next = {...settings};
            for (const key of ["enabled", "skipIfAccountSpecified", "interceptExternalClicks", "interceptDirectNavigation", "interceptGoogleNavigation"]) {
                if (key in imported) next[key] = imported[key];
            }
            if (imported.targetSites) {
                next.targetSites = [...new Set([...settings.targetSites, ...imported.targetSites])];
            }
            if (imported.excludedSourceSites) {
                next.excludedSourceSites = [...new Set([...settings.excludedSourceSites, ...imported.excludedSourceSites])];
            }
            if (imported.preferredAccountRules) {
                const merged = [...settings.preferredAccountRules];
                for (const rule of imported.preferredAccountRules) {
                    if (merged.some((existing) => rulesAreEquivalent(existing, rule))) continue;
                    merged.push(merged.some((existing) => existing.id === rule.id) ? {...rule, id: createRuleId()} : rule);
                }
                next.preferredAccountRules = merged;
            }
            if (imported.accountLabels) {
                next.accountLabels = {...settings.accountLabels, ...imported.accountLabels};
            }
            if (imported.mutedSuggestions) {
                const merged = [...settings.mutedSuggestions];
                for (const entry of imported.mutedSuggestions) {
                    if (merged.some((existing) =>
                        existing.targetDomain === entry.targetDomain &&
                        (existing.targetPathPrefix ?? "") === (entry.targetPathPrefix ?? ""))) continue;
                    merged.push(entry);
                }
                next.mutedSuggestions = merged;
            }
        }

        const prior = settings;
        settings = next;

        try {
            await saveSettings({
                enabled: settings.enabled,
                targetSites: settings.targetSites,
                excludedSourceSites: settings.excludedSourceSites,
                skipIfAccountSpecified: settings.skipIfAccountSpecified,
                skipRedirectIfDone: settings.skipIfAccountSpecified,
                interceptExternalClicks: settings.interceptExternalClicks,
                interceptDirectNavigation: settings.interceptDirectNavigation,
                interceptGoogleNavigation: settings.interceptGoogleNavigation,
                preferredAccountRules: settings.preferredAccountRules,
                accountLabels: settings.accountLabels,
                mutedSuggestions: settings.mutedSuggestions,
            });
            exitEditMode();
            renderRules();
            renderTargets();
            renderExcluded();
            renderMutedSuggestions();

            const {report} = validated;
            showToast(report.skipped
                ? `Imported — ${report.skipped} invalid item(s) skipped`
                : "Settings imported");
            if (report.reasons.length) {
                console.warn("Import skipped entries:", report.reasons);
            }
        } catch (error) {
            settings = prior;
            showToast(error.message, {variant: "error"});
        }
    });

    // --- About ---

    versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;
    shortcutsLink.addEventListener("click", (e) => {
        // chrome:// URLs can't be opened from a normal link.
        e.preventDefault();
        chrome.tabs.create({url: "chrome://extensions/shortcuts"});
    });

    renderRules();
    renderTargets();
    renderExcluded();
    renderMutedSuggestions();
});
