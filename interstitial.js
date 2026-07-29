// DNR forwards the intercepted URL unencoded after "?target=", so the target's
// own query and fragment survive only if we slice the raw href — never use
// URLSearchParams here.
const TARGET_MARKER = "?target=";
// Keep in sync with ALLOW_RULE_ID_BASE in background.js.
const ALLOW_RULE_ID_BASE = 500000;

const statusText = document.getElementById("statusText");
const backBtn = document.getElementById("backBtn");

const markerIndex = location.href.indexOf(TARGET_MARKER);
const target = markerIndex === -1 ? "" : location.href.slice(markerIndex + TARGET_MARKER.length);

backBtn.addEventListener("click", () => history.back());

const fail = (message) => {
    statusText.textContent = message;
    backBtn.hidden = false;
};

// If the service worker can't answer, let the navigation through rather than
// trapping the user: add this tab's allow rule ourselves, then go.
const failOpen = async () => {
    try {
        const tab = await chrome.tabs.getCurrent();
        if (typeof tab?.id === "number") {
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ALLOW_RULE_ID_BASE + tab.id],
                addRules: [{
                    id: ALLOW_RULE_ID_BASE + tab.id,
                    priority: 2,
                    action: {type: "allow"},
                    condition: {tabIds: [tab.id], resourceTypes: ["main_frame"]},
                }],
            });
        }
    } catch (error) {
        console.error("Interstitial fail-open could not add an allow rule:", error);
    }

    location.replace(target);
};

if (!/^https?:\/\//.test(target)) {
    fail("This page was opened without a valid destination.");
} else {
    const fallbackTimer = setTimeout(failOpen, 2000);

    chrome.runtime.sendMessage({type: "interstitialDecision", url: target})
        .then((response) => {
            clearTimeout(fallbackTimer);
            location.replace(response?.finalUrl || target);
        })
        .catch(() => {
            clearTimeout(fallbackTimer);
            failOpen();
        });
}
