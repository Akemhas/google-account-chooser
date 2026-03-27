let timeout = null;
let isRegistering = false;

const DEFAULT_GOOGLE_DOMAINS = [
    "docs.google.com",
    "drive.google.com",
    "forms.google.com",
    "console.firebase.google.com",
    "photos.google.com",
    "mail.google.com",
    "calendar.google.com",
    "contacts.google.com",
    "maps.google.com",
    "news.google.com",
    "keep.google.com",
    "chat.google.com",
    "meet.google.com",
    "classroom.google.com",
    "analytics.google.com",
    "ads.google.com",
    "cloud.google.com",
    "console.cloud.google.com",
    "play.google.com",
    "developers.google.com",
    "translate.google.com",
    "scholar.google.com",
    "sites.google.com",
    "finance.google.com",
    "earth.google.com",
    "books.google.com",
    "blogger.google.com",
    "takeout.google.com",
];
const REDIRECT_TTL_MS = 5 * 60 * 1000;
const COMPLETED_REDIRECT_TTL_MS = 15 * 1000;
const SUGGESTION_TTL_MS = 10 * 60 * 1000;
const SETTINGS_KEYS = [
    "enabled",
    "targetSites",
    "excludedSourceSites",
    "excludedSources",
    "skipIfAccountSpecified",
    "skipRedirectIfDone",
    "interceptExternalClicks",
    "interceptDirectNavigation",
    "interceptGoogleNavigation",
    "usePreferredAccountRules",
    "preferredAccountRules",
];
const pendingRedirectsByTab = new Map();
const completedRedirectsByTab = new Map();
const suggestedRulesByTab = new Map();

function isSubdomainOrMatch(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function normalizeSettings(data) {
    return {
        enabled: data.enabled ?? true,
        targetSites: data.targetSites?.length ? data.targetSites : DEFAULT_GOOGLE_DOMAINS,
        excludedSourceSites: data.excludedSourceSites ?? data.excludedSources ?? [],
        skipIfAccountSpecified: data.skipIfAccountSpecified ?? data.skipRedirectIfDone ?? true,
        interceptExternalClicks: data.interceptExternalClicks ?? true,
        interceptDirectNavigation: data.interceptDirectNavigation ?? false,
        interceptGoogleNavigation: data.interceptGoogleNavigation ?? false,
        usePreferredAccountRules: data.usePreferredAccountRules ?? false,
        preferredAccountRules: Array.isArray(data.preferredAccountRules) ? data.preferredAccountRules : [],
    };
}

async function getSettings() {
    return normalizeSettings(await chrome.storage.sync.get(SETTINGS_KEYS));
}

function parseUrl(rawUrl) {
    try {
        return new URL(rawUrl);
    } catch {
        return null;
    }
}

function isTargetUrl(url, targetSites) {
    return targetSites.some((domain) => isSubdomainOrMatch(url.hostname, domain));
}

function isSourceExcluded(hostname, excludedSourceSites) {
    return excludedSourceSites.some((domain) => isSubdomainOrMatch(hostname, domain));
}

function isAccountChooserUrl(url) {
    return url.hostname === "accounts.google.com" && url.pathname.startsWith("/AccountChooser");
}

function hasExplicitAccount(url) {
    return url.searchParams.has("authuser");
}

function cleanupPendingRedirects() {
    const now = Date.now();

    for (const [tabId, pending] of pendingRedirectsByTab.entries()) {
        if (now - pending.createdAt > REDIRECT_TTL_MS) {
            pendingRedirectsByTab.delete(tabId);
        }
    }
}

function cleanupCompletedRedirects() {
    const now = Date.now();

    for (const [tabId, completed] of completedRedirectsByTab.entries()) {
        if (now - completed.createdAt > COMPLETED_REDIRECT_TTL_MS) {
            completedRedirectsByTab.delete(tabId);
        }
    }
}

function cleanupSuggestedRules() {
    const now = Date.now();

    for (const [tabId, suggestion] of suggestedRulesByTab.entries()) {
        if (now - suggestion.createdAt > SUGGESTION_TTL_MS) {
            suggestedRulesByTab.delete(tabId);
        }
    }
}

function resetRuntimeState() {
    pendingRedirectsByTab.clear();
    completedRedirectsByTab.clear();
    suggestedRulesByTab.clear();
}

function setPendingRedirect(tabId, destinationUrl, sourceHostname, navigationType) {
    if (typeof tabId !== "number" || tabId < 0) return;

    pendingRedirectsByTab.set(tabId, {
        destinationUrl,
        sourceHostname,
        navigationType,
        createdAt: Date.now(),
    });
}

function isPendingRedirectMatch(tabId, rawUrl) {
    const pending = pendingRedirectsByTab.get(tabId);
    if (!pending) return false;

    if (Date.now() - pending.createdAt > REDIRECT_TTL_MS) {
        pendingRedirectsByTab.delete(tabId);
        return false;
    }

    const pendingUrl = parseUrl(pending.destinationUrl);
    const currentUrl = parseUrl(rawUrl);

    if (!pendingUrl || !currentUrl) {
        pendingRedirectsByTab.delete(tabId);
        return false;
    }

    const matches =
        pendingUrl.hostname === currentUrl.hostname &&
        pendingUrl.pathname === currentUrl.pathname;

    return matches;
}

function isPendingRedirectReturn(tabId, rawUrl) {
    const pending = pendingRedirectsByTab.get(tabId);
    if (!pending) return false;

    if (Date.now() - pending.createdAt > REDIRECT_TTL_MS) {
        pendingRedirectsByTab.delete(tabId);
        return false;
    }

    const pendingUrl = parseUrl(pending.destinationUrl);
    const currentUrl = parseUrl(rawUrl);

    if (!pendingUrl || !currentUrl) {
        pendingRedirectsByTab.delete(tabId);
        return false;
    }

    return pendingUrl.hostname === currentUrl.hostname;
}

function setCompletedRedirect(tabId, rawUrl) {
    if (typeof tabId !== "number" || tabId < 0) return;

    const parsedUrl = parseUrl(rawUrl);
    if (!parsedUrl) return;

    completedRedirectsByTab.set(tabId, {
        hostname: parsedUrl.hostname,
        createdAt: Date.now(),
    });
}

function isCompletedRedirectReturn(tabId, rawUrl) {
    const completed = completedRedirectsByTab.get(tabId);
    if (!completed) return false;

    if (Date.now() - completed.createdAt > COMPLETED_REDIRECT_TTL_MS) {
        completedRedirectsByTab.delete(tabId);
        return false;
    }

    const parsedUrl = parseUrl(rawUrl);
    if (!parsedUrl) {
        completedRedirectsByTab.delete(tabId);
        return false;
    }

    return parsedUrl.hostname === completed.hostname;
}

function buildChooserUrl(rawUrl) {
    return `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(rawUrl)}`;
}

function normalizeRuleDomain(domain) {
    return typeof domain === "string" ? domain.trim().toLowerCase() : "";
}

function normalizeRulePathname(pathname) {
    if (typeof pathname !== "string" || !pathname) return "";

    const normalized = pathname
        .replace(/\/u\/[^/]+/g, "")
        .replace(/\/{2,}/g, "/")
        .replace(/\/$/, "");

    return normalized || "/";
}

function getDomainSpecificityScore(hostname, domain) {
    if (!domain) return 1;
    if (hostname === domain) return domain.length + 1000;
    if (hostname.endsWith(`.${domain}`)) return domain.length;
    return -1;
}

function getPathSpecificityScore(pathname, rulePathPrefix) {
    if (!rulePathPrefix) return 1;
    if (pathname === rulePathPrefix) return rulePathPrefix.length + 1000;
    if (pathname.startsWith(rulePathPrefix.endsWith("/") ? rulePathPrefix : `${rulePathPrefix}/`)) {
        return rulePathPrefix.length;
    }
    return -1;
}

function findPreferredAccountRule({targetUrl, sourceHostname, preferredAccountRules}) {
    let bestMatch = null;
    let bestScore = -1;
    const normalizedTargetPath = normalizeRulePathname(targetUrl.pathname);

    for (const rule of preferredAccountRules) {
        const targetDomain = normalizeRuleDomain(rule?.targetDomain);
        const targetPathPrefix = normalizeRulePathname(rule?.targetPathPrefix ?? "");
        const sourceDomain = normalizeRuleDomain(rule?.sourceDomain);
        const authuser = typeof rule?.authuser === "string" ? rule.authuser.trim() : "";

        if (!targetDomain || !authuser) continue;

        const targetScore = getDomainSpecificityScore(targetUrl.hostname, targetDomain);
        if (targetScore < 0) continue;

        const pathScore = getPathSpecificityScore(normalizedTargetPath, targetPathPrefix);
        if (pathScore < 0) continue;

        let sourceScore = 1;
        if (sourceDomain) {
            if (!sourceHostname) continue;
            sourceScore = getDomainSpecificityScore(sourceHostname, sourceDomain);
            if (sourceScore < 0) continue;
        }

        const score = targetScore * 100000000 + pathScore * 10000 + sourceScore;
        if (score > bestScore) {
            bestScore = score;
            bestMatch = {
                targetDomain,
                targetPathPrefix,
                sourceDomain,
                authuser,
            };
        }
    }

    return bestMatch;
}

function applyPreferredAccount(rawUrl, authuser) {
    const parsedUrl = parseUrl(rawUrl);
    if (!parsedUrl) return null;

    parsedUrl.searchParams.set("authuser", authuser);
    return parsedUrl.toString();
}

function createSuggestedRuleFromUrl(rawUrl, sourceHostname) {
    const parsedUrl = parseUrl(rawUrl);
    if (!parsedUrl) return null;

    const authuser = parsedUrl.searchParams.get("authuser")?.trim();
    if (!authuser) return null;

    return {
        targetDomain: parsedUrl.hostname.toLowerCase(),
        targetPathPrefix: normalizeRulePathname(parsedUrl.pathname),
        sourceDomain: sourceHostname ? sourceHostname.toLowerCase() : "",
        authuser,
        createdAt: Date.now(),
    };
}

async function getBestEffortNavigationContext(tabId, targetUrl) {
    if (typeof tabId !== "number" || tabId < 0) {
        return {
            navigationType: "direct-navigation",
            sourceHostname: null,
        };
    }

    try {
        const tab = await chrome.tabs.get(tabId);
        const currentUrl = parseUrl(tab?.url);
        const nextUrl = parseUrl(targetUrl);

        if (!currentUrl || !nextUrl) {
            return {
                navigationType: "direct-navigation",
                sourceHostname: null,
            };
        }

        if (currentUrl.origin === nextUrl.origin && currentUrl.pathname === nextUrl.pathname) {
            return {
                navigationType: "direct-navigation",
                sourceHostname: null,
            };
        }

        const settings = await getSettings();
        if (isTargetUrl(currentUrl, settings.targetSites)) {
            return {
                navigationType: "google-navigation",
                sourceHostname: currentUrl.hostname,
            };
        }
    } catch (error) {
        console.debug("Failed to inspect current tab before navigation:", error);
    }

    return {
        navigationType: "direct-navigation",
        sourceHostname: null,
    };
}

async function getRedirectDecision({url, navigationType, sourceHostname, tabId}) {
    cleanupPendingRedirects();
    cleanupCompletedRedirects();
    cleanupSuggestedRules();

    const parsedUrl = parseUrl(url);
    if (!parsedUrl) return {redirectUrl: null};

    const settings = await getSettings();
    if (!settings.enabled) return {redirectUrl: null};
    if (!isTargetUrl(parsedUrl, settings.targetSites)) return {redirectUrl: null};
    if (isAccountChooserUrl(parsedUrl)) return {redirectUrl: null};
    if (settings.skipIfAccountSpecified && hasExplicitAccount(parsedUrl)) return {redirectUrl: null};
    if (
        typeof tabId === "number" &&
        (
            isPendingRedirectMatch(tabId, url) ||
            isPendingRedirectReturn(tabId, url) ||
            isCompletedRedirectReturn(tabId, url)
        )
    ) {
        return {redirectUrl: null};
    }

    if (sourceHostname && isSourceExcluded(sourceHostname, settings.excludedSourceSites)) {
        return {redirectUrl: null};
    }

    if (navigationType === "external-click" && !settings.interceptExternalClicks) {
        return {redirectUrl: null};
    }

    if (navigationType === "google-navigation" && !settings.interceptGoogleNavigation) {
        return {redirectUrl: null};
    }

    if (navigationType === "direct-navigation" && !settings.interceptDirectNavigation) {
        return {redirectUrl: null};
    }

    if (settings.usePreferredAccountRules) {
        const preferredRule = findPreferredAccountRule({
            targetUrl: parsedUrl,
            sourceHostname,
            preferredAccountRules: settings.preferredAccountRules,
        });

        if (preferredRule) {
            return {
                redirectUrl: applyPreferredAccount(url, preferredRule.authuser),
            };
        }
    }

    const redirectUrl = buildChooserUrl(url);
    setPendingRedirect(tabId, url, sourceHostname, navigationType);

    return {redirectUrl};
}

async function maybeInterceptTopLevelNavigation(details) {
    if (details.frameId !== 0 || details.tabId < 0) return;

    cleanupCompletedRedirects();

    const parsedUrl = parseUrl(details.url);
    if (!parsedUrl || isAccountChooserUrl(parsedUrl)) return;

    const settings = await getSettings();
    if (!settings.enabled || !settings.interceptDirectNavigation) return;
    if (!isTargetUrl(parsedUrl, settings.targetSites)) return;
    if (
        isPendingRedirectReturn(details.tabId, details.url) ||
        isCompletedRedirectReturn(details.tabId, details.url)
    ) {
        return;
    }

    const {navigationType, sourceHostname} = await getBestEffortNavigationContext(
        details.tabId,
        details.url
    );

    const {redirectUrl} = await getRedirectDecision({
        url: details.url,
        navigationType,
        sourceHostname,
        tabId: details.tabId,
    });

    if (!redirectUrl || redirectUrl === details.url) return;

    await chrome.tabs.update(details.tabId, {url: redirectUrl});
}

async function registerContentScript() {
    if (isRegistering) return;

    isRegistering = true;

    try {
        await chrome.scripting.unregisterContentScripts();

        const settings = await getSettings();
        if (!settings.enabled) {
            isRegistering = false;
            return;
        }

        const excludeMatches = settings.excludedSourceSites.map((site) => `*://${site}/*`);

        await chrome.scripting.registerContentScripts([
            {
                id: "redirector_script",
                js: ["config.js", "redirector.js"],
                matches: ["*://*/*"],
                excludeMatches,
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "getRedirectUrl") {
        const tabId = sender.tab?.id ?? message.tabId;

        getRedirectDecision({
            url: message.url,
            navigationType: message.navigationType,
            sourceHostname: message.sourceHostname,
            tabId,
        })
            .then(sendResponse)
            .catch((error) => {
                console.error("Failed to decide redirect:", error);
                sendResponse({redirectUrl: null});
            });

        return true;
    }

    if (message?.type === "getSuggestedRule") {
        cleanupSuggestedRules();
        sendResponse({
            suggestedRule: suggestedRulesByTab.get(message.tabId) ?? null,
        });
        return false;
    }

    return false;
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    maybeInterceptTopLevelNavigation(details).catch((error) => {
        console.error("Failed to intercept top-level navigation:", error);
    });
});

chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0 || details.tabId < 0) return;

    cleanupPendingRedirects();
    cleanupCompletedRedirects();
    cleanupSuggestedRules();

    const pendingRedirect = pendingRedirectsByTab.get(details.tabId);
    if (!pendingRedirect) {
        return;
    }

    if (!isPendingRedirectReturn(details.tabId, details.url)) {
        return;
    }

    const suggestedRule = createSuggestedRuleFromUrl(details.url, pendingRedirect.sourceHostname);
    if (suggestedRule) {
        suggestedRulesByTab.set(details.tabId, suggestedRule);
    }

    setCompletedRedirect(details.tabId, details.url);
    pendingRedirectsByTab.delete(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    pendingRedirectsByTab.delete(tabId);
    completedRedirectsByTab.delete(tabId);
    suggestedRulesByTab.delete(tabId);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
    }

    timeout = setTimeout(() => {
        registerContentScript().catch((err) =>
            console.error("Failed to re-register on storage change:", err)
        );
        timeout = null;
    }, 500);
});

self.addEventListener("unload", () => {
    if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
    }

    resetRuntimeState();
});

if (globalThis.__GACR_ENABLE_TEST_HOOKS__) {
    globalThis.__GACR_TEST_HOOKS__ = {
        buildChooserUrl,
        createSuggestedRuleFromUrl,
        getRedirectDecision,
        isCompletedRedirectReturn,
        isPendingRedirectMatch,
        isPendingRedirectReturn,
        normalizeRulePathname,
        normalizeSettings,
        resetRuntimeState,
        setCompletedRedirect,
        setPendingRedirect,
    };
}
