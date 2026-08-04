importScripts("config.js");

let timeout = null;
let isRegistering = false;

const REDIRECT_TTL_MS = 5 * 60 * 1000;
const COMPLETED_REDIRECT_TTL_MS = 15 * 1000;
const SUGGESTION_TTL_MS = 10 * 60 * 1000;
const CONTENT_SCRIPT_REGISTRATION_KEYS = ["enabled", "excludedSourceSites", "excludedSources"];
const DNR_SYNC_KEYS = ["enabled", "targetSites", "interceptDirectNavigation", "dnrInterception"];
const DNR_RULE_ID_BASE = 1000;
const ALLOW_RULE_ID_BASE = 500000;
const ALLOW_RULE_TTL_MS = 10 * 1000;
const NAVIGATION_CONTEXT_TTL_MS = 30 * 1000;
const lastNavigationContextByTab = new Map();
const allowRuleTimersByTab = new Map();
const pendingRedirectsByTab = new Map();
const completedRedirectsByTab = new Map();
const suggestedRulesByTab = new Map();
const SESSION_STATE_MAPS = [
    ["pendingRedirectsByTab", pendingRedirectsByTab],
    ["completedRedirectsByTab", completedRedirectsByTab],
    ["suggestedRulesByTab", suggestedRulesByTab],
];
let sessionStateReady = null;

function ensureSessionStateLoaded() {
    if (!sessionStateReady) {
        sessionStateReady = (async () => {
            try {
                const stored = await chrome.storage.session.get(SESSION_STATE_MAPS.map(([key]) => key));

                for (const [key, map] of SESSION_STATE_MAPS) {
                    for (const [tabId, value] of Object.entries(stored[key] ?? {})) {
                        map.set(Number(tabId), value);
                    }
                }
            } catch (error) {
                console.error("Failed to load session state:", error);
            }
        })();
    }

    return sessionStateReady;
}

function persistSessionState() {
    const snapshot = {};

    for (const [key, map] of SESSION_STATE_MAPS) {
        snapshot[key] = Object.fromEntries(
            Array.from(map.entries(), ([tabId, value]) => [String(tabId), value])
        );
    }

    chrome.storage.session.set(snapshot).catch((error) => {
        console.error("Failed to persist session state:", error);
    });
}

function isSubdomainOrMatch(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function updateSuggestionBadge(tabId) {
    if (typeof tabId !== "number" || tabId < 0) return;

    const text = suggestedRulesByTab.has(tabId) ? "1" : "";
    chrome.action.setBadgeText({tabId, text}).catch(() => {});

    if (text) {
        chrome.action.setBadgeBackgroundColor({tabId, color: "#3555d8"}).catch(() => {});
        chrome.action.setBadgeTextColor?.({tabId, color: "#FFFFFF"})?.catch(() => {});
    }
}

function updateGlobalBadge(enabled) {
    chrome.action.setBadgeText({text: enabled ? "" : "OFF"}).catch(() => {});

    if (!enabled) {
        chrome.action.setBadgeBackgroundColor({color: "#6b7280"}).catch(() => {});
        chrome.action.setBadgeTextColor?.({color: "#FFFFFF"})?.catch(() => {});
    }
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
    return url.searchParams.has("authuser") || /\/u\/\d+(\/|$)/.test(url.pathname);
}

// URL shapes that point at an account-scoped resource. These always route
// through the chooser (bypassing the navigation-type toggles) when they name
// no account and match no rule — the extension cannot guess the account.
function isAccountScopedResourceUrl(url) {
    if (/\/d\/[^/]+/.test(url.pathname)) return true;
    if (/\/folders\/[^/]+/.test(url.pathname)) return true;
    if ((url.pathname === "/open" || url.pathname === "/uc") && url.searchParams.has("id")) return true;

    if (isSubdomainOrMatch(url.hostname, "mail.google.com")) {
        return (
            url.pathname.startsWith("/mail") &&
            /^#(?:inbox|all|imp|starred|snoozed|sent|drafts|spam|trash|label\/[^/]+|search\/[^/]+)\/[^/]+$/.test(url.hash)
        );
    }

    if (isSubdomainOrMatch(url.hostname, "calendar.google.com")) {
        return url.searchParams.has("eid") || /\/eventedit(\/|$)/.test(url.pathname);
    }

    if (isSubdomainOrMatch(url.hostname, "photos.google.com")) {
        return /^\/(?:album|photo|share)\//.test(url.pathname);
    }

    if (isSubdomainOrMatch(url.hostname, "meet.google.com")) {
        return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname) || url.pathname.startsWith("/lookup/");
    }

    if (isSubdomainOrMatch(url.hostname, "chat.google.com")) {
        return /^\/(?:room|dm)\//.test(url.pathname);
    }

    if (isSubdomainOrMatch(url.hostname, "classroom.google.com")) {
        return /^\/c\//.test(url.pathname);
    }

    if (isSubdomainOrMatch(url.hostname, "keep.google.com")) {
        return /^#(?:NOTE|LIST)\//i.test(url.hash);
    }

    if (isSubdomainOrMatch(url.hostname, "console.firebase.google.com")) {
        return /^\/project\//.test(url.pathname);
    }

    if (url.hostname === "console.cloud.google.com") {
        return url.searchParams.has("project");
    }

    return false;
}

function cleanupExpiredEntries(map, ttlMs) {
    const now = Date.now();
    let removed = false;

    for (const [tabId, entry] of map.entries()) {
        if (now - entry.createdAt > ttlMs) {
            map.delete(tabId);
            removed = true;
        }
    }

    return removed;
}

function cleanupPendingRedirects() {
    return cleanupExpiredEntries(pendingRedirectsByTab, REDIRECT_TTL_MS);
}

function cleanupCompletedRedirects() {
    return cleanupExpiredEntries(completedRedirectsByTab, COMPLETED_REDIRECT_TTL_MS);
}

function cleanupSuggestedRules() {
    return cleanupExpiredEntries(suggestedRulesByTab, SUGGESTION_TTL_MS);
}

function cleanupAllExpiredState() {
    const removed = [
        cleanupPendingRedirects(),
        cleanupCompletedRedirects(),
        cleanupSuggestedRules(),
    ].some(Boolean);

    if (removed) persistSessionState();
}

async function resetRuntimeState() {
    pendingRedirectsByTab.clear();
    completedRedirectsByTab.clear();
    suggestedRulesByTab.clear();
    await chrome.storage.session.remove(SESSION_STATE_MAPS.map(([key]) => key));
}

function setPendingRedirect(tabId, destinationUrl, sourceHostname, navigationType) {
    if (typeof tabId !== "number" || tabId < 0) return;

    pendingRedirectsByTab.set(tabId, {
        destinationUrl,
        sourceHostname,
        navigationType,
        createdAt: Date.now(),
    });
    persistSessionState();
}

function getValidPendingRedirectUrls(tabId, rawUrl) {
    const pending = pendingRedirectsByTab.get(tabId);
    if (!pending) return null;

    if (Date.now() - pending.createdAt > REDIRECT_TTL_MS) {
        pendingRedirectsByTab.delete(tabId);
        persistSessionState();
        return null;
    }

    const pendingUrl = parseUrl(pending.destinationUrl);
    const currentUrl = parseUrl(rawUrl);

    if (!pendingUrl || !currentUrl) {
        pendingRedirectsByTab.delete(tabId);
        persistSessionState();
        return null;
    }

    return {pendingUrl, currentUrl};
}

function isPendingRedirectMatch(tabId, rawUrl) {
    const urls = getValidPendingRedirectUrls(tabId, rawUrl);
    if (!urls) return false;

    return (
        urls.pendingUrl.hostname === urls.currentUrl.hostname &&
        urls.pendingUrl.pathname === urls.currentUrl.pathname
    );
}

function isPendingRedirectReturn(tabId, rawUrl) {
    const urls = getValidPendingRedirectUrls(tabId, rawUrl);
    if (!urls) return false;

    return urls.pendingUrl.hostname === urls.currentUrl.hostname;
}

function setCompletedRedirect(tabId, rawUrl) {
    if (typeof tabId !== "number" || tabId < 0) return;

    const parsedUrl = parseUrl(rawUrl);
    if (!parsedUrl) return;

    completedRedirectsByTab.set(tabId, {
        hostname: parsedUrl.hostname,
        createdAt: Date.now(),
    });
    persistSessionState();
}

function isCompletedRedirectReturn(tabId, rawUrl) {
    const completed = completedRedirectsByTab.get(tabId);
    if (!completed) return false;

    if (Date.now() - completed.createdAt > COMPLETED_REDIRECT_TTL_MS) {
        completedRedirectsByTab.delete(tabId);
        persistSessionState();
        return false;
    }

    const parsedUrl = parseUrl(rawUrl);
    if (!parsedUrl) {
        completedRedirectsByTab.delete(tabId);
        persistSessionState();
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
        if (rule?.enabled === false) continue;

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

    const authuser =
        parsedUrl.searchParams.get("authuser")?.trim() ||
        parsedUrl.pathname.match(/\/u\/(\d+)(?:\/|$)/)?.[1];
    if (!authuser) return null;

    // Drop trailing action segments so the rule matches /edit, /view, etc. alike,
    // and treat a bare root path as service-wide.
    let targetPathPrefix = normalizeRulePathname(parsedUrl.pathname)
        .replace(/^(.*\/d\/[^/]+)\/(?:edit|view|preview|copy)$/, "$1");
    if (targetPathPrefix === "/") targetPathPrefix = "";

    return {
        targetDomain: parsedUrl.hostname.toLowerCase(),
        targetPathPrefix,
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
                navigationType: "reload",
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
    await ensureSessionStateLoaded();
    cleanupAllExpiredState();

    const parsedUrl = parseUrl(url);
    if (!parsedUrl) return {redirectUrl: null};

    const settings = await getSettings();
    if (!settings.enabled) return {redirectUrl: null};
    if (navigationType === "reload") return {redirectUrl: null};
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

    const preferredRule = findPreferredAccountRule({
        targetUrl: parsedUrl,
        sourceHostname,
        preferredAccountRules: settings.preferredAccountRules,
    });

    if (preferredRule) {
        const rewrittenUrl = applyPreferredAccount(url, preferredRule.authuser);
        if (!rewrittenUrl || rewrittenUrl === parsedUrl.toString()) return {redirectUrl: null};
        return {redirectUrl: rewrittenUrl};
    }

    if (!isAccountScopedResourceUrl(parsedUrl)) {
        if (navigationType === "external-click" && !settings.interceptExternalClicks) {
            return {redirectUrl: null};
        }

        if (navigationType === "google-navigation" && !settings.interceptGoogleNavigation) {
            return {redirectUrl: null};
        }

        if (navigationType === "direct-navigation" && !settings.interceptDirectNavigation) {
            return {redirectUrl: null};
        }
    }

    const redirectUrl = buildChooserUrl(url);
    setPendingRedirect(tabId, url, sourceHostname, navigationType);

    return {redirectUrl};
}

async function maybeInterceptTopLevelNavigation(details) {
    if (details.frameId !== 0 || details.tabId < 0) return;

    const parsedUrl = parseUrl(details.url);
    if (!parsedUrl || isAccountChooserUrl(parsedUrl)) return;

    const settings = await getSettings();
    if (!settings.enabled) return;
    if (!isTargetUrl(parsedUrl, settings.targetSites)) return;

    if (isDnrActive(settings)) {
        // DNR redirects this request to the interstitial; record the navigation
        // context (the tab still shows the source page here) for its decision.
        cleanupNavigationContexts();
        const context = await getBestEffortNavigationContext(details.tabId, details.url);
        lastNavigationContextByTab.set(details.tabId, {...context, createdAt: Date.now()});
        return;
    }

    await ensureSessionStateLoaded();
    if (cleanupCompletedRedirects()) persistSessionState();

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

function isDnrAvailable() {
    return Boolean(chrome.declarativeNetRequest?.updateSessionRules);
}

function isDnrActive(settings) {
    return settings.enabled && settings.interceptDirectNavigation && settings.dnrInterception && isDnrAvailable();
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDnrRedirectRule(domain, index) {
    return {
        id: DNR_RULE_ID_BASE + index,
        priority: 1,
        action: {
            type: "redirect",
            redirect: {
                // \0 is the full regex match; the pattern must consume the entire
                // URL (trailing .*) or the forwarded target truncates.
                regexSubstitution: `chrome-extension://${chrome.runtime.id}/interstitial.html?target=\\0`,
            },
        },
        condition: {
            regexFilter: `^https?://([^/]+\\.)?${escapeRegex(domain)}/.*`,
            resourceTypes: ["main_frame"],
            excludedInitiatorDomains: ["accounts.google.com"],
        },
    };
}

let dnrSyncQueue = Promise.resolve();

// Serialized: concurrent calls (init + storage.onChanged) would otherwise both
// read the same rule set and register duplicates.
function syncDnrRules() {
    dnrSyncQueue = dnrSyncQueue.then(() => performDnrRuleSync());
    return dnrSyncQueue;
}

async function performDnrRuleSync() {
    if (!isDnrAvailable()) return;

    try {
        const settings = await getSettings();
        const existingRules = await chrome.declarativeNetRequest.getSessionRules();
        const removeRuleIds = existingRules
            .map((rule) => rule.id)
            .filter((id) => id >= DNR_RULE_ID_BASE && id < ALLOW_RULE_ID_BASE);

        if (!isDnrActive(settings)) {
            if (removeRuleIds.length) {
                await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds});
            }
            return;
        }

        const addRules = [];
        for (const [index, domain] of settings.targetSites.entries()) {
            if (isSubdomainOrMatch(domain, "accounts.google.com") || isSubdomainOrMatch("accounts.google.com", domain)) {
                continue;
            }

            const rule = buildDnrRedirectRule(domain, index);
            const {isSupported} = await chrome.declarativeNetRequest.isRegexSupported({
                regex: rule.condition.regexFilter,
            });
            if (!isSupported) {
                console.warn("Skipping unsupported DNR pattern for domain:", domain);
                continue;
            }

            addRules.push(rule);
        }

        await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds, addRules});
    } catch (error) {
        console.error("Failed to sync DNR rules:", error);
    }
}

async function addTabAllowRule(tabId) {
    if (!isDnrAvailable() || typeof tabId !== "number" || tabId < 0) return;

    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ALLOW_RULE_ID_BASE + tabId],
        addRules: [{
            id: ALLOW_RULE_ID_BASE + tabId,
            priority: 2,
            action: {type: "allow"},
            condition: {tabIds: [tabId], resourceTypes: ["main_frame"]},
        }],
    });

    clearTimeout(allowRuleTimersByTab.get(tabId));
    allowRuleTimersByTab.set(tabId, setTimeout(() => {
        removeTabAllowRule(tabId).catch(() => {});
    }, ALLOW_RULE_TTL_MS));
}

async function removeTabAllowRule(tabId) {
    if (!isDnrAvailable() || typeof tabId !== "number" || tabId < 0) return;

    const timer = allowRuleTimersByTab.get(tabId);
    if (timer !== undefined) {
        clearTimeout(timer);
        allowRuleTimersByTab.delete(tabId);
    }

    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ALLOW_RULE_ID_BASE + tabId],
    });
}

async function sweepOrphanAllowRules() {
    if (!isDnrAvailable()) return;

    try {
        const rules = await chrome.declarativeNetRequest.getSessionRules();
        const removeRuleIds = rules.map((rule) => rule.id).filter((id) => id >= ALLOW_RULE_ID_BASE);
        if (removeRuleIds.length) {
            await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds});
        }
    } catch (error) {
        console.error("Failed to sweep orphaned allow rules:", error);
    }
}

function cleanupNavigationContexts() {
    const now = Date.now();

    for (const [tabId, context] of lastNavigationContextByTab.entries()) {
        if (now - context.createdAt > NAVIGATION_CONTEXT_TTL_MS) {
            lastNavigationContextByTab.delete(tabId);
        }
    }
}

async function handleInterstitialDecision(url, tabId) {
    await ensureSessionStateLoaded();
    cleanupNavigationContexts();

    const context = lastNavigationContextByTab.get(tabId) ?? {
        navigationType: "direct-navigation",
        sourceHostname: null,
    };
    lastNavigationContextByTab.delete(tabId);

    const {redirectUrl} = await getRedirectDecision({
        url,
        navigationType: context.navigationType,
        sourceHostname: context.sourceHostname,
        tabId,
    });

    const finalUrl = redirectUrl ?? url;

    const parsedFinal = parseUrl(finalUrl);
    if (parsedFinal) {
        const settings = await getSettings();
        if (isDnrActive(settings) && isTargetUrl(parsedFinal, settings.targetSites)) {
            await addTabAllowRule(tabId);
        }
    }

    return {finalUrl};
}

async function classifyNewTabSource(sourceTabId, settings) {
    try {
        const sourceTab = await chrome.tabs.get(sourceTabId);
        const sourceUrl = parseUrl(sourceTab?.url);

        if (sourceUrl) {
            if (isTargetUrl(sourceUrl, settings.targetSites)) {
                return {navigationType: "google-navigation", sourceHostname: sourceUrl.hostname};
            }

            if (sourceUrl.protocol === "http:" || sourceUrl.protocol === "https:") {
                return {navigationType: "external-click", sourceHostname: sourceUrl.hostname};
            }
        }
    } catch (error) {
        console.debug("Failed to inspect source tab for new-tab navigation:", error);
    }

    return {navigationType: "direct-navigation", sourceHostname: null};
}

async function handleCreatedNavigationTarget(details) {
    const parsedUrl = parseUrl(details.url);
    if (!parsedUrl || isAccountChooserUrl(parsedUrl)) return;

    const settings = await getSettings();
    if (!settings.enabled) return;
    if (!isTargetUrl(parsedUrl, settings.targetSites)) return;

    const {navigationType, sourceHostname} = await classifyNewTabSource(details.sourceTabId, settings);

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
syncDnrRules();
sweepOrphanAllowRules();
getSettings()
    .then((settings) => updateGlobalBadge(settings.enabled))
    .catch(() => {});
// The popup no longer stores a tab preference; clear the legacy key.
chrome.storage.local.remove("popupActiveTab").catch(() => {});

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
        ensureSessionStateLoaded()
            .then(() => {
                if (cleanupSuggestedRules()) persistSessionState();
                sendResponse({
                    suggestedRule: suggestedRulesByTab.get(message.tabId) ?? null,
                });
            })
            .catch((error) => {
                console.error("Failed to load suggested rule:", error);
                sendResponse({suggestedRule: null});
            });

        return true;
    }

    if (message?.type === "interstitialDecision") {
        const tabId = sender.tab?.id ?? -1;

        handleInterstitialDecision(message.url, tabId)
            .then(sendResponse)
            .catch((error) => {
                console.error("Failed to decide interstitial navigation:", error);
                // Fail open, but add the allow rule first so the passthrough can't loop.
                addTabAllowRule(tabId)
                    .catch(() => {})
                    .then(() => sendResponse({finalUrl: message.url}));
            });

        return true;
    }

    if (message?.type === "getFreshSuggestion") {
        const tabId = sender.tab?.id ?? -1;

        ensureSessionStateLoaded()
            .then(async () => {
                if (cleanupSuggestedRules()) persistSessionState();

                const settings = await getSettings();
                const suggestion = suggestedRulesByTab.get(tabId);
                const isFresh = suggestion && Date.now() - suggestion.createdAt < 30 * 1000;

                if (!suggestion || !isFresh || suggestion.offered || settings.autoSaveSuggestedRules) {
                    sendResponse({suggestedRule: null});
                    return;
                }

                suggestion.offered = true;
                persistSessionState();
                sendResponse({suggestedRule: suggestion});
            })
            .catch((error) => {
                console.error("Failed to fetch fresh suggestion:", error);
                sendResponse({suggestedRule: null});
            });

        return true;
    }

    if (message?.type === "savePageSuggestedRule") {
        const tabId = sender.tab?.id ?? -1;

        ensureSessionStateLoaded()
            .then(async () => {
                const suggestion = suggestedRulesByTab.get(tabId);
                if (!suggestion) {
                    sendResponse({ok: false});
                    return;
                }

                await savePreferredRule(suggestion);
                if (suggestedRulesByTab.delete(tabId)) persistSessionState();
                updateSuggestionBadge(tabId);
                sendResponse({ok: true});
            })
            .catch((error) => {
                console.error("Failed to save suggested rule from page:", error);
                sendResponse({ok: false});
            });

        return true;
    }

    if (message?.type === "consumeSuggestedRule") {
        ensureSessionStateLoaded()
            .then(() => {
                if (suggestedRulesByTab.delete(message.tabId)) persistSessionState();
                updateSuggestionBadge(message.tabId);
                sendResponse({ok: true});
            })
            .catch((error) => {
                console.error("Failed to consume suggested rule:", error);
                sendResponse({ok: false});
            });

        return true;
    }

    return false;
});

chrome.webNavigation.onBeforeNavigate.addListener((details) =>
    maybeInterceptTopLevelNavigation(details).catch((error) => {
        console.error("Failed to intercept top-level navigation:", error);
    })
);

async function savePreferredRule(rule) {
    const settings = await getSettings();

    if (settings.preferredAccountRules.some((existing) => rulesAreEquivalent(existing, rule))) {
        return false;
    }

    await chrome.storage.sync.set({
        preferredAccountRules: [...settings.preferredAccountRules, {
            id: createRuleId(),
            targetDomain: rule.targetDomain,
            targetPathPrefix: rule.targetPathPrefix ?? "",
            sourceDomain: rule.sourceDomain ?? "",
            authuser: rule.authuser,
        }],
    });

    return true;
}

async function handleCommittedNavigation(details) {
    if (details.frameId !== 0 || details.tabId < 0) return;

    // A real page committed — retire the tab's DNR allow rule and stale context.
    // Skip our own interstitial's commit: its allow rule is added after this event.
    if (!details.url.startsWith(chrome.runtime.getURL(""))) {
        lastNavigationContextByTab.delete(details.tabId);
        removeTabAllowRule(details.tabId).catch(() => {});
    }

    await ensureSessionStateLoaded();
    cleanupAllExpiredState();

    const pendingRedirect = pendingRedirectsByTab.get(details.tabId);

    if (pendingRedirect && !pendingRedirect.chooserVisited && parseUrl(details.url)?.hostname === "accounts.google.com") {
        pendingRedirect.chooserVisited = true;
        persistSessionState();
    }

    if (pendingRedirect && isPendingRedirectReturn(details.tabId, details.url)) {
        const suggestedRule = createSuggestedRuleFromUrl(details.url, pendingRedirect.sourceHostname);

        // A markerless commit on the destination before the tab has been to the
        // chooser is the original navigation winning the race against our own
        // tabs.update redirect — keep the pending entry for the real return.
        if (suggestedRule || pendingRedirect.chooserVisited) {
            if (suggestedRule) {
                const settings = await getSettings();

                // Auto mode saves document-specific rules outright; service-wide
                // suggestions are too broad to save unasked and stay suggestions.
                if (settings.autoSaveSuggestedRules && suggestedRule.targetPathPrefix) {
                    try {
                        await savePreferredRule(suggestedRule);
                    } catch (error) {
                        console.error("Failed to auto-save suggested rule:", error);
                        suggestedRulesByTab.set(details.tabId, suggestedRule);
                    }
                } else {
                    suggestedRulesByTab.set(details.tabId, suggestedRule);
                }
            }

            setCompletedRedirect(details.tabId, details.url);
            pendingRedirectsByTab.delete(details.tabId);
            persistSessionState();
        }
    }

    updateSuggestionBadge(details.tabId);
}

async function handleTabRemoved(tabId) {
    lastNavigationContextByTab.delete(tabId);
    removeTabAllowRule(tabId).catch(() => {});

    await ensureSessionStateLoaded();

    const removed = [
        pendingRedirectsByTab.delete(tabId),
        completedRedirectsByTab.delete(tabId),
        suggestedRulesByTab.delete(tabId),
    ].some(Boolean);

    if (removed) persistSessionState();
}

chrome.webNavigation.onCommitted.addListener((details) =>
    handleCommittedNavigation(details).catch((error) => {
        console.error("Failed to handle committed navigation:", error);
    })
);

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) =>
    handleCreatedNavigationTarget(details).catch((error) => {
        console.error("Failed to handle created navigation target:", error);
    })
);

chrome.commands?.onCommand.addListener((command) => {
    if (command !== "toggle-enabled") return;

    chrome.storage.sync.get("enabled")
        .then(({enabled = true}) => chrome.storage.sync.set({enabled: !enabled}))
        .catch((error) => console.error("Failed to toggle enabled state:", error));
});

chrome.tabs.onRemoved.addListener((tabId) =>
    handleTabRemoved(tabId).catch((error) => {
        console.error("Failed to clean up removed tab:", error);
    })
);

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    if ("enabled" in changes) {
        updateGlobalBadge(changes.enabled.newValue ?? true);
    }

    if (DNR_SYNC_KEYS.some((key) => key in changes)) {
        syncDnrRules();
    }

    if (!CONTENT_SCRIPT_REGISTRATION_KEYS.some((key) => key in changes)) return;

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

if (globalThis.__GACR_ENABLE_TEST_HOOKS__) {
    globalThis.__GACR_TEST_HOOKS__ = {
        buildChooserUrl,
        createSuggestedRuleFromUrl,
        ensureSessionStateLoaded,
        getBestEffortNavigationContext,
        getRedirectDecision,
        handleCommittedNavigation,
        handleCreatedNavigationTarget,
        handleInterstitialDecision,
        handleTabRemoved,
        hasExplicitAccount,
        isAccountScopedResourceUrl,
        sweepOrphanAllowRules,
        syncDnrRules,
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
