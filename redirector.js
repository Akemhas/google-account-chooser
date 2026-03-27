(async () => {
    const {
        enabled = true,
        targetSites = DEFAULT_GOOGLE_DOMAINS,
        excludedSourceSites = [],
        excludedSources = [],
    } = await chrome.storage.sync.get([
        "enabled",
        "targetSites",
        "excludedSourceSites",
        "excludedSources",
    ]);

    if (!enabled) return;

    const currentSiteHostname = location.hostname;
    const excludedSites = excludedSourceSites.length > 0 ? excludedSourceSites : excludedSources;

    if (excludedSites.some((site) => currentSiteHostname === site || currentSiteHostname.endsWith(`.${site}`))) {
        return;
    }

    const isTargetLink = (rawUrl) => {
        try {
            const {hostname} = new URL(rawUrl);
            return targetSites.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        } catch {
            return false;
        }
    };

    const currentUrl = window.location.href;
    if (isTargetLink(currentUrl)) {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getRedirectUrl",
                url: currentUrl,
                navigationType: "direct-navigation",
                sourceHostname: null,
            });

            if (response?.redirectUrl) {
                location.replace(response.redirectUrl);
                return;
            }
        } catch (error) {
            console.error("Failed to redirect direct navigation:", error);
        }
    }

    document.addEventListener("click", async (event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const link = event.target.closest("a");
        if (!link?.href || !isTargetLink(link.href)) return;

        if (link.target && link.target !== "_self") return;
        if (link.hasAttribute("download")) return;

        const sourceHostname = currentSiteHostname;
        const navigationType = isTargetLink(window.location.href) ? "google-navigation" : "external-click";

        const response = await chrome.runtime.sendMessage({
            type: "getRedirectUrl",
            url: link.href,
            navigationType,
            sourceHostname,
        });

        if (!response?.redirectUrl) return;

        event.preventDefault();
        location.assign(response.redirectUrl);
    }, true);
})();
