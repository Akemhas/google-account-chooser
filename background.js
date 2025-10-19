let timeout = null;
let isRegistering = false;

async function registerContentScript() {
    // Prevent concurrent registration attempts
    if (isRegistering) return;

    isRegistering = true;

    try {
        await chrome.scripting.unregisterContentScripts();

        const {enabled = true, excludedSources = []} = await chrome.storage.sync.get([
            "enabled",
            "excludedSources",
        ]);

        if (!enabled) {
            isRegistering = false;
            return;
        }

        const excludeMatches = excludedSources.map(site => `*://${site}/*`);

        await chrome.scripting.registerContentScripts([
            {
                id: "redirector_script",
                js: ["redirector.js"],
                matches: ["*://*/*"],
                excludeMatches: excludeMatches,
                runAt: "document_start",
                allFrames: false,
            },
        ]);
    } catch (error) {
        console.error("Failed to register content script:", error);
    } finally {
        isRegistering = false;
    }
}

registerContentScript();

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
        // Clear existing timeout to prevent race conditions
        if (timeout !== null) {
            clearTimeout(timeout);
            timeout = null;
        }

        timeout = setTimeout(() => {
            registerContentScript().catch(err =>
                console.error("Failed to re-register on storage change:", err)
            );
            timeout = null; // Clean up reference
        }, 500);
    }
});

// Cleanup on extension unload
self.addEventListener('unload', () => {
    if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
    }
});