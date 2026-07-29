const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const backgroundPath = path.join(repoRoot, "background.js");
const backgroundSource = fs.readFileSync(backgroundPath, "utf8");

function createHarness(overrides = {}) {
    const settings = {
        enabled: true,
        targetSites: ["drive.google.com", "docs.google.com"],
        excludedSourceSites: [],
        skipIfAccountSpecified: true,
        interceptExternalClicks: true,
        interceptDirectNavigation: true,
        interceptGoogleNavigation: false,
        preferredAccountRules: [],
        ...overrides.settings,
    };

    const sessionStore = overrides.sessionStore ?? {};
    const failTabIds = new Set(overrides.failTabIds ?? []);
    const tabs = new Map(Object.entries(overrides.tabs ?? {}).map(([key, value]) => [Number(key), value]));
    const badgeTextByTab = new Map();
    const badge = {global: null};
    const listeners = {
        onMessage: [],
        onBeforeNavigate: [],
        onCommitted: [],
        onCreatedNavigationTarget: [],
        onRemoved: [],
        onChanged: [],
        onCommand: [],
    };

    const context = {
        URL,
        console,
        Date,
        Math,
        Map,
        Set,
        Promise,
        encodeURIComponent,
        clearTimeout,
        setTimeout,
        globalThis: null,
        __GACR_ENABLE_TEST_HOOKS__: true,
        importScripts(...files) {
            for (const file of files) {
                const filePath = path.join(repoRoot, file);
                vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {filename: filePath});
            }
        },
        chrome: {
            action: {
                async setBadgeText({tabId, text}) {
                    if (typeof tabId === "number") {
                        badgeTextByTab.set(tabId, text);
                    } else {
                        badge.global = text;
                    }
                },
                async setBadgeBackgroundColor() {},
                async setBadgeTextColor() {},
            },
            commands: {
                onCommand: {
                    addListener(listener) {
                        listeners.onCommand.push(listener);
                    },
                },
            },
            storage: {
                local: {
                    async remove() {},
                },
                sync: {
                    async get() {
                        return structuredClone(settings);
                    },
                    async set(items) {
                        const changes = {};
                        for (const [key, value] of Object.entries(items)) {
                            changes[key] = {oldValue: settings[key], newValue: structuredClone(value)};
                            settings[key] = structuredClone(value);
                        }
                        for (const listener of listeners.onChanged) {
                            listener(changes, "sync");
                        }
                    },
                },
                session: {
                    async get(keys) {
                        const requested = [].concat(keys);
                        const result = {};
                        for (const key of requested) {
                            if (key in sessionStore) {
                                result[key] = structuredClone(sessionStore[key]);
                            }
                        }
                        return result;
                    },
                    async set(items) {
                        Object.assign(sessionStore, structuredClone(items));
                    },
                    async remove(keys) {
                        for (const key of [].concat(keys)) {
                            delete sessionStore[key];
                        }
                    },
                },
                onChanged: {
                    addListener(listener) {
                        listeners.onChanged.push(listener);
                    },
                },
            },
            scripting: {
                async unregisterContentScripts() {},
                async registerContentScripts() {},
            },
            runtime: {
                onMessage: {
                    addListener(listener) {
                        listeners.onMessage.push(listener);
                    },
                },
            },
            webNavigation: {
                onBeforeNavigate: {
                    addListener(listener) {
                        listeners.onBeforeNavigate.push(listener);
                    },
                },
                onCommitted: {
                    addListener(listener) {
                        listeners.onCommitted.push(listener);
                    },
                },
                onCreatedNavigationTarget: {
                    addListener(listener) {
                        listeners.onCreatedNavigationTarget.push(listener);
                    },
                },
            },
            tabs: {
                async get(tabId) {
                    if (failTabIds.has(tabId)) {
                        throw new Error(`No tab with id: ${tabId}.`);
                    }
                    return tabs.get(tabId) ?? {id: tabId, url: "about:blank"};
                },
                async update(tabId, updateInfo) {
                    tabs.set(tabId, {id: tabId, url: updateInfo.url});
                },
                onRemoved: {
                    addListener(listener) {
                        listeners.onRemoved.push(listener);
                    },
                },
            },
        },
    };

    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(backgroundSource, context, {filename: backgroundPath});

    return {
        badge,
        badgeTextByTab,
        hooks: context.__GACR_TEST_HOOKS__,
        listeners,
        sessionStore,
        settings,
        tabs,
    };
}

function sendMessage(harness, message) {
    const onMessage = harness.listeners.onMessage.at(0);
    return new Promise((resolve) => {
        const isAsync = onMessage(message, {}, resolve);
        if (!isAsync) resolve(undefined);
    });
}

test("direct navigation builds chooser URL for supported targets", async () => {
    const {hooks} = createHarness();

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 1,
    });

    assert.equal(
        decision.redirectUrl,
        "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fdrive.google.com%2Fdrive%2Fmy-drive"
    );
});

test("reload navigations are never intercepted, even with a matching rule", async () => {
    const {hooks} = createHarness({
        settings: {
            interceptDirectNavigation: true,
            preferredAccountRules: [
                {
                    targetDomain: "drive.google.com",
                    sourceDomain: "",
                    authuser: "1",
                },
            ],
        },
    });

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive",
        navigationType: "reload",
        sourceHostname: null,
        tabId: 1,
    });

    assert.equal(decision.redirectUrl, null);
});

test("navigation context classifies same-page navigation as reload", async () => {
    const {hooks} = createHarness({
        tabs: {
            5: {id: 5, url: "https://docs.google.com/document/d/abc/edit"},
        },
    });

    const reloadContext = await hooks.getBestEffortNavigationContext(
        5,
        "https://docs.google.com/document/d/abc/edit"
    );
    const googleContext = await hooks.getBestEffortNavigationContext(
        5,
        "https://drive.google.com/drive/my-drive"
    );

    assert.equal(reloadContext.navigationType, "reload");
    assert.equal(googleContext.navigationType, "google-navigation");
    assert.equal(googleContext.sourceHostname, "docs.google.com");
});

test("/u/N/ path counts as an explicit account", async () => {
    const {hooks} = createHarness();

    const decision = await hooks.getRedirectDecision({
        url: "https://docs.google.com/document/u/1/d/abc/edit",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 2,
    });

    assert.equal(decision.redirectUrl, null);

    const {hooks: hooksWithoutSkip} = createHarness({
        settings: {skipIfAccountSpecified: false},
    });

    const chooserDecision = await hooksWithoutSkip.getRedirectDecision({
        url: "https://docs.google.com/document/u/1/d/abc/edit",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 2,
    });

    assert.equal(
        chooserDecision.redirectUrl,
        "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fdocs.google.com%2Fdocument%2Fu%2F1%2Fd%2Fabc%2Fedit"
    );
});

test("completed chooser return suppresses another redirect on same host", async () => {
    const {hooks} = createHarness();

    hooks.setCompletedRedirect(7, "https://drive.google.com/drive/u/0/my-drive");

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/home",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 7,
    });

    assert.equal(decision.redirectUrl, null);
});

test("preferred account rules add authuser instead of chooser", async () => {
    const {hooks} = createHarness({
        settings: {
            preferredAccountRules: [
                {
                    targetDomain: "drive.google.com",
                    sourceDomain: "",
                    authuser: "1",
                },
            ],
        },
    });

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 2,
    });

    assert.equal(
        decision.redirectUrl,
        "https://drive.google.com/drive/my-drive?authuser=1"
    );
});

test("preferred account rules bypass the navigation-type toggles", async () => {
    const {hooks} = createHarness({
        settings: {
            interceptExternalClicks: false,
            interceptDirectNavigation: false,
            interceptGoogleNavigation: false,
            preferredAccountRules: [
                {
                    targetDomain: "drive.google.com",
                    sourceDomain: "",
                    authuser: "2",
                },
            ],
        },
    });

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive",
        navigationType: "external-click",
        sourceHostname: "slack.com",
        tabId: 3,
    });

    assert.equal(
        decision.redirectUrl,
        "https://drive.google.com/drive/my-drive?authuser=2"
    );
});

test("excluded sources suppress preferred account rules too", async () => {
    const {hooks} = createHarness({
        settings: {
            excludedSourceSites: ["slack.com"],
            preferredAccountRules: [
                {
                    targetDomain: "drive.google.com",
                    sourceDomain: "",
                    authuser: "1",
                },
            ],
        },
    });

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive",
        navigationType: "external-click",
        sourceHostname: "slack.com",
        tabId: 4,
    });

    assert.equal(decision.redirectUrl, null);
});

test("a rule rewrite identical to the current URL yields no redirect", async () => {
    const {hooks} = createHarness({
        settings: {
            skipIfAccountSpecified: false,
            preferredAccountRules: [
                {
                    targetDomain: "drive.google.com",
                    sourceDomain: "",
                    authuser: "1",
                },
            ],
        },
    });

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive?authuser=1",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 5,
    });

    assert.equal(decision.redirectUrl, null);
});

test("path-specific preferred rules only match the captured document path", async () => {
    const {hooks} = createHarness({
        settings: {
            // /u/0/ now counts as an explicit account, so disable the skip to
            // exercise the path-matching logic against the /u/N/ URL form.
            skipIfAccountSpecified: false,
            preferredAccountRules: [
                {
                    targetDomain: "docs.google.com",
                    targetPathPrefix: "/document/d/abc123/edit",
                    sourceDomain: "",
                    authuser: "1",
                },
            ],
        },
    });

    const matchingDecision = await hooks.getRedirectDecision({
        url: "https://docs.google.com/document/u/0/d/abc123/edit",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 3,
    });
    const nonMatchingDecision = await hooks.getRedirectDecision({
        url: "https://docs.google.com/document/d/xyz999/edit",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 4,
    });

    assert.equal(
        matchingDecision.redirectUrl,
        "https://docs.google.com/document/u/0/d/abc123/edit?authuser=1"
    );
    assert.equal(
        nonMatchingDecision.redirectUrl,
        "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fdocs.google.com%2Fdocument%2Fd%2Fxyz999%2Fedit"
    );
});

test("chooser return with authuser becomes a suggested rule on commit", async () => {
    const harness = createHarness();
    const {hooks, listeners} = harness;

    hooks.setPendingRedirect(9, "https://drive.google.com/drive/my-drive", "slack.com", "external-click");
    const onCommitted = listeners.onCommitted.at(0);

    await onCommitted({
        frameId: 0,
        tabId: 9,
        url: "https://drive.google.com/drive/u/1/my-drive?authuser=1",
    });

    const response = await sendMessage(harness, {type: "getSuggestedRule", tabId: 9});

    assert.equal(response.suggestedRule.targetDomain, "drive.google.com");
    assert.equal(response.suggestedRule.targetPathPrefix, "/drive/my-drive");
    assert.equal(response.suggestedRule.sourceDomain, "slack.com");
    assert.equal(response.suggestedRule.authuser, "1");
    assert.equal(typeof response.suggestedRule.createdAt, "number");
});

test("chooser return with only a /u/N/ path yields a suggestion with a trimmed prefix", async () => {
    const harness = createHarness();
    const {hooks, listeners} = harness;

    hooks.setPendingRedirect(11, "https://docs.google.com/document/d/abc123/edit", "slack.com", "external-click");
    const onCommitted = listeners.onCommitted.at(0);

    await onCommitted({
        frameId: 0,
        tabId: 11,
        url: "https://docs.google.com/document/u/2/d/abc123/edit",
    });

    const response = await sendMessage(harness, {type: "getSuggestedRule", tabId: 11});

    assert.equal(response.suggestedRule.authuser, "2");
    assert.equal(response.suggestedRule.targetPathPrefix, "/document/d/abc123");
    assert.equal(response.suggestedRule.sourceDomain, "slack.com");
});

test("new-tab navigation from an external site routes through the chooser", async () => {
    const {listeners, tabs} = createHarness({
        tabs: {1: {id: 1, url: "https://slack.com/messages"}},
    });

    await listeners.onCreatedNavigationTarget.at(0)({
        sourceTabId: 1,
        tabId: 2,
        url: "https://drive.google.com/drive/my-drive",
    });

    assert.equal(
        tabs.get(2).url,
        "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fdrive.google.com%2Fdrive%2Fmy-drive"
    );
});

test("new-tab interception respects the external-clicks toggle", async () => {
    const {listeners, tabs} = createHarness({
        settings: {interceptExternalClicks: false},
        tabs: {1: {id: 1, url: "https://slack.com/messages"}},
    });

    await listeners.onCreatedNavigationTarget.at(0)({
        sourceTabId: 1,
        tabId: 2,
        url: "https://drive.google.com/drive/my-drive",
    });

    assert.equal(tabs.has(2), false);
});

test("new-tab navigation between Google apps is gated by the google-navigation toggle", async () => {
    const offHarness = createHarness({
        tabs: {1: {id: 1, url: "https://mail.google.com/mail/"}},
        settings: {targetSites: ["mail.google.com", "drive.google.com"]},
    });

    await offHarness.listeners.onCreatedNavigationTarget.at(0)({
        sourceTabId: 1,
        tabId: 2,
        url: "https://drive.google.com/drive/my-drive",
    });

    assert.equal(offHarness.tabs.has(2), false);

    const onHarness = createHarness({
        tabs: {1: {id: 1, url: "https://mail.google.com/mail/"}},
        settings: {targetSites: ["mail.google.com", "drive.google.com"], interceptGoogleNavigation: true},
    });

    await onHarness.listeners.onCreatedNavigationTarget.at(0)({
        sourceTabId: 1,
        tabId: 2,
        url: "https://drive.google.com/drive/my-drive",
    });

    assert.equal(
        onHarness.tabs.get(2).url,
        "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fdrive.google.com%2Fdrive%2Fmy-drive"
    );
});

test("new-tab navigation applies preferred rules even with all toggles off", async () => {
    const {listeners, tabs} = createHarness({
        settings: {
            interceptExternalClicks: false,
            interceptDirectNavigation: false,
            interceptGoogleNavigation: false,
            preferredAccountRules: [
                {targetDomain: "drive.google.com", sourceDomain: "", authuser: "2"},
            ],
        },
        tabs: {1: {id: 1, url: "https://slack.com/messages"}},
    });

    await listeners.onCreatedNavigationTarget.at(0)({
        sourceTabId: 1,
        tabId: 2,
        url: "https://drive.google.com/drive/my-drive",
    });

    assert.equal(tabs.get(2).url, "https://drive.google.com/drive/my-drive?authuser=2");
});

test("new-tab navigation from an excluded source is left alone", async () => {
    const {listeners, tabs} = createHarness({
        settings: {excludedSourceSites: ["slack.com"]},
        tabs: {1: {id: 1, url: "https://slack.com/messages"}},
    });

    await listeners.onCreatedNavigationTarget.at(0)({
        sourceTabId: 1,
        tabId: 2,
        url: "https://drive.google.com/drive/my-drive",
    });

    assert.equal(tabs.has(2), false);
});

test("new-tab navigation with an unreadable source tab falls back to direct-navigation", async () => {
    const {listeners, tabs} = createHarness({
        settings: {interceptDirectNavigation: false},
        failTabIds: [1],
    });

    await listeners.onCreatedNavigationTarget.at(0)({
        sourceTabId: 1,
        tabId: 2,
        url: "https://drive.google.com/drive/my-drive",
    });

    assert.equal(tabs.has(2), false);
});

test("new-tab interception and onBeforeNavigate do not double-redirect", async () => {
    const {listeners, tabs} = createHarness({
        tabs: {1: {id: 1, url: "https://slack.com/messages"}},
    });

    const targetUrl = "https://drive.google.com/drive/my-drive";
    await listeners.onCreatedNavigationTarget.at(0)({sourceTabId: 1, tabId: 2, url: targetUrl});

    const chooserUrl = tabs.get(2).url;
    assert.match(chooserUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);

    await listeners.onBeforeNavigate.at(0)({frameId: 0, tabId: 2, url: targetUrl});

    assert.equal(tabs.get(2).url, chooserUrl);
});

test("suggestion badge is set on capture, cleared on consume, and OFF when disabled", async () => {
    const harness = createHarness();
    const {hooks, listeners, badgeTextByTab, badge} = harness;

    hooks.setPendingRedirect(9, "https://drive.google.com/drive/my-drive", "slack.com", "external-click");
    await listeners.onCommitted.at(0)({
        frameId: 0,
        tabId: 9,
        url: "https://drive.google.com/drive/u/1/my-drive?authuser=1",
    });

    assert.equal(badgeTextByTab.get(9), "1");

    const response = await sendMessage(harness, {type: "consumeSuggestedRule", tabId: 9});
    assert.equal(response.ok, true);
    assert.equal(badgeTextByTab.get(9), "");

    const suggestion = await sendMessage(harness, {type: "getSuggestedRule", tabId: 9});
    assert.equal(suggestion.suggestedRule, null);

    listeners.onChanged.at(0)({enabled: {oldValue: true, newValue: false}}, "sync");
    assert.equal(badge.global, "OFF");
});

test("normalizeSettings defaults are unchanged after the config.js move", () => {
    const {hooks} = createHarness();

    const defaults = hooks.normalizeSettings({});

    assert.equal(defaults.enabled, true);
    assert.equal(defaults.targetSites.length, 28);
    assert.equal(defaults.targetSites.includes("docs.google.com"), true);
    assert.equal(defaults.excludedSourceSites.length, 0);
    assert.equal(defaults.skipIfAccountSpecified, true);
    assert.equal(defaults.interceptExternalClicks, true);
    assert.equal(defaults.interceptDirectNavigation, false);
    assert.equal(defaults.interceptGoogleNavigation, false);
    assert.equal(defaults.preferredAccountRules.length, 0);

    const legacy = hooks.normalizeSettings({excludedSources: ["a.com"], skipRedirectIfDone: false});
    assert.equal(legacy.excludedSourceSites.length, 1);
    assert.equal(legacy.excludedSourceSites[0], "a.com");
    assert.equal(legacy.skipIfAccountSpecified, false);
});

test("the toggle-enabled command inverts the stored enabled state", async () => {
    const {listeners, settings} = createHarness();

    listeners.onCommand.at(0)("toggle-enabled");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(settings.enabled, false);

    listeners.onCommand.at(0)("toggle-enabled");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(settings.enabled, true);
});

test("suggestions and redirect suppression survive a service-worker restart", async () => {
    const first = createHarness();

    first.hooks.setPendingRedirect(9, "https://drive.google.com/drive/my-drive", "slack.com", "external-click");
    await first.listeners.onCommitted.at(0)({
        frameId: 0,
        tabId: 9,
        url: "https://drive.google.com/drive/u/1/my-drive?authuser=1",
    });

    // A fresh vm context with the same session store simulates MV3 eviction + restart.
    const second = createHarness({sessionStore: first.sessionStore});

    const response = await sendMessage(second, {type: "getSuggestedRule", tabId: 9});
    assert.equal(response.suggestedRule?.authuser, "1");
    assert.equal(response.suggestedRule?.targetDomain, "drive.google.com");

    const decision = await second.hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/home",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 9,
    });
    assert.equal(decision.redirectUrl, null);
});
