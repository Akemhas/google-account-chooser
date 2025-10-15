async function registerContentScript() {
    await chrome.scripting.unregisterContentScripts()

    const {enabled = true, mode = "exclude", sites = []} = await chrome.storage.sync.get([
        "enabled",
        "mode",
        "sites",
    ])

    if (!enabled) return

    let matches = []

    if (sites.length > 0) {
        if (mode === "include") {
            matches = sites.map(site => `*://*.${site}/*`)
            matches = matches.concat(sites.map(site => `*://${site}/*`))
        } else {
            matches = ["*://*/*"]
        }
    } else if (mode === "exclude") {
        matches = ["*://*/*"]
    } else {
        return
    }

    await chrome.scripting.registerContentScripts([
        {
            id: "redirector_script",
            js: ["redirector.js"],
            matches: matches,
            runAt: "document_start",
            allFrames: false,
        },
    ])
}

registerContentScript()

let timeout;
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
        clearTimeout(timeout);
        timeout = setTimeout(registerContentScript, 500);
    }
});