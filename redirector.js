(async () => {
    // Get configuration settings from storage
    const {
        enabled = true, targetSites = DEFAULT_GOOGLE_DOMAINS, excludedSourceSites = [], skipRedirectIfDone = true
    } = await chrome.storage.sync.get(["enabled", "targetSites", "excludedSourceSites", "skipRedirectIfDone"]);

    if (!enabled) return;

    const currentSiteHostname = location.hostname;
    const currentUrl = window.location.href;

    // Skip if current source site is in excluded list
    if (excludedSourceSites.some(site => currentSiteHostname === site || currentSiteHostname.endsWith(`.${site}`))) {
        return;
    }

    // Determine if the current page is already 'done' with redirection
    const isSourceAlreadyDone = currentUrl.includes("gacrdone=1");

    const targets = targetSites;

    const isTargetLink = (url) => {
        try {
            const {hostname} = new URL(url);
            // Check if the hostname matches any target domain or is a subdomain of a target domain
            return targets.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        } catch {
            return false;
        }
    };

    const redirect = (url) => {
        if (!isTargetLink(url)) return false; // Not a target link, do nothing.

        const isAlreadyChoosy = url.includes("AccountChooser") || url.includes("authuser=") || url.includes("gacrdone=1");

        if (isAlreadyChoosy) {
            return false;
        }

        if (skipRedirectIfDone && isSourceAlreadyDone) {
            // Return the new URL instead of redirecting directly.
            return url + (url.includes('?') ? '&' : '?') + 'gacrdone=1';
        }

        const continueUrl = url + (url.includes('?') ? '&' : '?') + 'gacrdone=1';
        return "https://accounts.google.com/AccountChooser?continue=" + encodeURIComponent(continueUrl);
    };

    // --- Check current URL on load ---

// Check current URL on load: Only perform a full redirect if NO redirect flags are present.
    const isInitialRedirectRequired = isTargetLink(currentUrl) &&
        !currentUrl.includes("AccountChooser") &&
        !currentUrl.includes("authuser=") &&
        !currentUrl.includes("gacrdone=1");

    if (isInitialRedirectRequired) {
        const continueUrl = currentUrl + (currentUrl.includes('?') ? '&' : '?') + 'gacrdone=1';
        const chooserUrl = "https://accounts.google.com/AccountChooser?continue=" + encodeURIComponent(continueUrl);
        location.replace(chooserUrl);
        return;
    }


    document.addEventListener("click", (event) => {
        const link = event.target.closest("a");
        if (link?.href) {
            const resultUrl = redirect(link.href);

            if (resultUrl) {
                event.preventDefault();
                location.href = resultUrl;
            }
        }
    });
})();