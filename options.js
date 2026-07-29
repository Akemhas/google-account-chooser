document.addEventListener("DOMContentLoaded", async () => {
    const tabs = Array.from(document.querySelectorAll(".nav-tab"));
    const panels = new Map(
        Array.from(document.querySelectorAll(".options-panel")).map((panel) => [panel.id, panel])
    );

    const ruleSearch = document.getElementById("ruleSearch");
    const savedDocumentRulesList = document.getElementById("savedDocumentRulesList");
    const preferredRulesList = document.getElementById("preferredRulesList");
    const rulePresetGrid = document.getElementById("rulePresetGrid");
    const preferredTargetInput = document.getElementById("preferredTargetInput");
    const preferredTargetPathInput = document.getElementById("preferredTargetPathInput");
    const preferredAuthuserInput = document.getElementById("preferredAuthuserInput");
    const preferredSourceInput = document.getElementById("preferredSourceInput");
    const addPreferredRuleBtn = document.getElementById("addPreferredRuleBtn");

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

    let settings;

    const {settings: loaded, error: loadError} = await loadSettings();
    settings = loaded;
    if (loadError) showToast("Failed to load settings", {variant: "error"});

    const persistSettings = async () => {
        await saveSettings({
            targetSites: settings.targetSites,
            excludedSourceSites: settings.excludedSourceSites,
            preferredAccountRules: settings.preferredAccountRules,
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
        container.setAttribute("role", "listitem");
        container.dataset.search = `${rule.targetDomain}${rule.targetPathPrefix ?? ""} ${rule.sourceDomain ?? ""} ${rule.authuser}`.toLowerCase();

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
        badge.textContent = `authuser=${rule.authuser}`;

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-danger-ghost remove-btn";
        removeBtn.textContent = "Remove";
        removeBtn.setAttribute("aria-label", `Remove rule for ${rule.targetDomain}${rule.targetPathPrefix ?? ""}`);
        removeBtn.dataset.ruleId = rule.id;

        const side = document.createElement("div");
        side.className = "rule-side";
        side.appendChild(badge);
        side.appendChild(removeBtn);

        textBlock.appendChild(name);
        textBlock.appendChild(meta);
        inner.appendChild(textBlock);
        inner.appendChild(side);
        container.appendChild(inner);

        return container;
    };

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

        if (!savedDocumentRulesList.children.length) {
            savedDocumentRulesList.appendChild(createEmptyState("No document-specific rules saved yet."));
        }
        if (!preferredRulesList.children.length) {
            preferredRulesList.appendChild(createEmptyState("No service-wide rules saved yet."));
        }

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

    for (const list of [savedDocumentRulesList, preferredRulesList]) {
        list.addEventListener("click", (e) => {
            const ruleId = e.target.dataset?.ruleId;
            if (ruleId && e.target.classList.contains("remove-btn")) {
                removeRule(ruleId);
            }
        });
    }

    const addPreferredRule = async () => {
        const targetDomain = sanitizeDomainInput(preferredTargetInput.value);
        const targetPathPrefix = sanitizePathPrefixInput(preferredTargetPathInput.value);
        const sourceDomain = preferredSourceInput.value.trim()
            ? sanitizeDomainInput(preferredSourceInput.value)
            : "";
        const authuser = sanitizeAuthuserInput(preferredAuthuserInput.value);

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

        const newRule = {id: createRuleId(), targetDomain, targetPathPrefix, sourceDomain, authuser};

        if (settings.preferredAccountRules.some((rule) => rulesAreEquivalent(rule, newRule))) {
            showToast("That rule already exists", {variant: "error"});
            return;
        }

        settings.preferredAccountRules = [...settings.preferredAccountRules, newRule];

        try {
            await persistSettings();
            preferredTargetInput.value = "";
            preferredTargetPathInput.value = "";
            preferredSourceInput.value = "";
            preferredAuthuserInput.value = "";
            renderRules();
            showToast("Rule saved");
        } catch (error) {
            settings.preferredAccountRules = settings.preferredAccountRules.filter((rule) => rule.id !== newRule.id);
            showToast(error.message, {variant: "error"});
        }
    };

    addPreferredRuleBtn.addEventListener("click", addPreferredRule);
    preferredAuthuserInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void addPreferredRule();
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
});
