async function registerContentScript() {
    await chrome.scripting.unregisterContentScripts()

    const {enabled = true, excludedSources = []} = await chrome.storage.sync.get([
        "enabled",
        "excludedSources",
    ])

    if (!enabled) return

    // Build exclude patterns for excluded sources
    const excludeMatches = excludedSources.map(site => `*://${site}/*`)

    await chrome.scripting.registerContentScripts([
        {
            id: "redirector_script",
            js: ["redirector.js"],
            matches: ["*://*/*"],
            excludeMatches: excludeMatches,
            runAt: "document_start",
            allFrames: false,
        },
    ])
}

registerContentScript()

let timeout
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
        clearTimeout(timeout)
        timeout = setTimeout(registerContentScript, 500)
    }
})