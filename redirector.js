(async () => {
    const {
        enabled = true, targetSites = DEFAULT_GOOGLE_DOMAINS, excludedSourceSites = []
    } = await chrome.storage.sync.get(["enabled", "targetSites", "excludedSourceSites",])

    if (!enabled) return

    const currentSite = location.hostname

    // Skip if current source site is in excluded list
    if (excludedSourceSites.some(site => currentSite === site || currentSite.endsWith(`.${site}`))) {
        return
    }

    const targets = targetSites

    const isTargetLink = (url) => {
        try {
            const {hostname} = new URL(url)
            return targets.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
        } catch {
            return false
        }
    }

    const redirect = (url) => {
        if (!isTargetLink(url)) return false

        const isAlreadyChoosy = url.includes("AccountChooser") || url.includes("authuser=") || url.includes("gacrdone=1")

        if (isAlreadyChoosy) return false

        const continueUrl = url + (url.includes('?') ? '&' : '?') + 'gacrdone=1'
        const chooserUrl = "https://accounts.google.com/AccountChooser?continue=" + encodeURIComponent(continueUrl)

        location.replace(chooserUrl)
        return true
    }

    // Check current URL on load
    if (redirect(window.location.href)) return

    // Handle link clicks
    document.addEventListener("click", (event) => {
        const link = event.target.closest("a")
        if (link?.href) {
            event.preventDefault()
            redirect(link.href)
        }
    })
})()