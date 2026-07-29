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
    const versionLabel = document.getElementById("versionLabel");
    const openOptionsBtn = document.getElementById("openOptionsBtn");

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
            contextHostname.textContent = "No page context";
            contextStatus.textContent = "Open a website to see its status";
            contextStatus.className = "chip";
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

    const renderSuggestedRuleHint = () => {
        if (!suggestedRuleCandidate) {
            suggestedRuleHint.textContent = "No recent chooser-based suggestion for this tab yet.";
            useSuggestedRuleBtn.disabled = true;
            return;
        }

        const alreadySaved = settings.preferredAccountRules.some((rule) =>
            rulesAreEquivalent(rule, suggestedRuleCandidate));

        const sourceLabel = suggestedRuleCandidate.sourceDomain
            ? ` from ${suggestedRuleCandidate.sourceDomain}`
            : "";
        const summary = `${suggestedRuleCandidate.targetDomain}${suggestedRuleCandidate.targetPathPrefix ?? ""}${sourceLabel} with ${formatAuthuserLabel(suggestedRuleCandidate.authuser, settings.accountLabels)}`;

        suggestedRuleHint.textContent = alreadySaved ? `Already saved: ${summary}` : `Suggested: ${summary}`;
        useSuggestedRuleBtn.disabled = alreadySaved;
    };

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
            targetDomain: suggestedRuleCandidate.targetDomain,
            targetPathPrefix: suggestedRuleCandidate.targetPathPrefix === "/" ? "" : (suggestedRuleCandidate.targetPathPrefix ?? ""),
            sourceDomain: suggestedRuleCandidate.sourceDomain ?? "",
            authuser: suggestedRuleCandidate.authuser,
        };

        if (settings.preferredAccountRules.some((rule) => rulesAreEquivalent(rule, newRule))) {
            renderSuggestedRuleHint();
            return;
        }

        settings.preferredAccountRules = [...settings.preferredAccountRules, newRule];

        try {
            await persistSettings();
            renderSuggestedRuleHint();
            showToast("Rule saved");

            if (typeof activeTabId === "number") {
                chrome.runtime.sendMessage({type: "consumeSuggestedRule", tabId: activeTabId}).catch(() => {});
            }
        } catch (error) {
            settings.preferredAccountRules = settings.preferredAccountRules.filter((rule) => rule.id !== newRule.id);
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

    [skipIfAccountSpecified, interceptExternalClicks, interceptDirectNavigation, interceptGoogleNavigation]
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
    versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

    updateEnabledState();
    await refreshActiveTabContext();
});
