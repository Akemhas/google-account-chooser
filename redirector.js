(async () => {
    const {enabled = true, mode = "exclude", sites = []} = await chrome.storage.sync.get([
        "enabled",
        "mode",
        "sites",
    ])

    if (!enabled) return

    const currentSite = location.hostname

    const shouldRun =
        (mode === "include" && sites.includes(currentSite)) ||
        (mode === "exclude" && !sites.includes(currentSite))

    if (!shouldRun) return

    const googleDomains = [
        "https://docs.google.com/",
        "https://drive.google.com/",
        "https://forms.google.com/",
        "https://console.firebase.google.com/",
        "https://photos.google.com/",
        "https://mail.google.com/",
        "https://calendar.google.com/",
        "https://contacts.google.com/",
        "https://maps.google.com/",
        "https://news.google.com/",
        "https://keep.google.com/",
        "https://chat.google.com/",
        "https://meet.google.com/",
        "https://classroom.google.com/",
        "https://analytics.google.com/",
        "https://ads.google.com/",
        "https://cloud.google.com/",
        "https://console.cloud.google.com/",
        "https://play.google.com/",
        "https://developers.google.com/",
        "https://translate.google.com/",
        "https://scholar.google.com/",
        "https://sites.google.com/",
        "https://finance.google.com/",
        "https://earth.google.com/",
        "https://books.google.com/",
        "https://blogger.google.com/",
        "https://takeout.google.com/",
    ];

    const isGoogleLink = (url) => {
        try {
            const {hostname} = new URL(url);
            return googleDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        } catch {
            return false; // Invalid URL (e.g. javascript:void(0))
        }
    };

    const redirect = (url, isLoad = false) => {
        if (!isGoogleLink(url)) return false;


        const isAlreadyChoosy =
            url.includes("AccountChooser") ||
            url.includes("authuser=") ||
            url.includes("gacrdone=1");

        if (isAlreadyChoosy) return false;

        if (isGoogleLink && !isAlreadyChoosy) {

            const continueUrl = url + (url.includes('?') ? '&' : '?') + 'gacrdone=1'


            const chooserUrl =
                "https://accounts.google.com/AccountChooser?continue=" +
                encodeURIComponent(continueUrl)

            if (isLoad) {
                location.replace(chooserUrl)
            } else {
                window.open(chooserUrl, "_blank")
            }

            return true
        }
        return false
    }

    const currentUrl = window.location.href
    if (redirect(currentUrl, true)) {
        return
    }

    document.addEventListener("click", (event) => {
        const link = event.target.closest("a")
        if (!link) return

        const url = link.href
        if (!url) return

        redirect(url, false)
    })
})()