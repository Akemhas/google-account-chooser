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
    const dnrSessionRules = overrides.dnrSessionRules ?? [];
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
            declarativeNetRequest: {
                async getSessionRules() {
                    return structuredClone(dnrSessionRules);
                },
                async updateSessionRules({removeRuleIds = [], addRules = []} = {}) {
                    for (const id of removeRuleIds) {
                        const index = dnrSessionRules.findIndex((rule) => rule.id === id);
                        if (index !== -1) dnrSessionRules.splice(index, 1);
                    }
                    dnrSessionRules.push(...structuredClone(addRules));
                },
                async isRegexSupported() {
                    return {isSupported: true};
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
                id: "test-extension-id",
                getURL(resourcePath = "") {
                    return `chrome-extension://test-extension-id/${resourcePath}`;
                },
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
        dnrSessionRules,
        hooks: context.__GACR_TEST_HOOKS__,
        listeners,
        sessionStore,
        settings,
        tabs,
    };
}

function sendMessage(harness, message, sender = {}) {
    const onMessage = harness.listeners.onMessage.at(0);
    return new Promise((resolve) => {
        const isAsync = onMessage(message, sender, resolve);
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
        "https://docs.google.com/document/u/1/d/abc123/edit?authuser=1"
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
    // Suggestions are source-agnostic: a saved document rule applies from anywhere.
    assert.equal(response.suggestedRule.sourceDomain, "");
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
    assert.equal(response.suggestedRule.sourceDomain, "");
});

test("isAccountScopedResourceUrl recognizes account-scoped shapes across services", () => {
    const {hooks} = createHarness();

    const scoped = [
        "https://docs.google.com/document/d/abc123/edit",
        "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0",
        "https://drive.google.com/file/d/abc123/view",
        "https://drive.google.com/drive/folders/14Qj219lJGsuRxkh3oH_2?usp=drive_link",
        "https://drive.google.com/open?id=abc123",
        "https://drive.google.com/uc?export=download&id=abc123",
        "https://mail.google.com/mail/#inbox/FMfcgzGtwqYbpFyGnDCLZzdVLBrbLDlq",
        "https://mail.google.com/mail/#search/report/QgrcJHsbjzj",
        "https://calendar.google.com/calendar/event?action=VIEW&eid=bXYzdGFza3M",
        "https://calendar.google.com/calendar/r/eventedit/bXYzdGFza3M",
        "https://photos.google.com/album/AF1QipMDa",
        "https://photos.google.com/share/AF1QipMDa",
        "https://meet.google.com/abc-defg-hij",
        "https://meet.google.com/lookup/abcdefg",
        "https://chat.google.com/room/AAAAtBz",
        "https://classroom.google.com/c/NDU2Nzg5",
        "https://keep.google.com/#NOTE/1abc",
        "https://console.firebase.google.com/project/my-app/overview",
        "https://console.cloud.google.com/run?project=my-app",
    ];

    const unscoped = [
        "https://drive.google.com/drive/my-drive",
        "https://mail.google.com/mail/#inbox",
        "https://calendar.google.com/calendar/r",
        "https://photos.google.com/",
        "https://meet.google.com/",
        "https://chat.google.com/",
        "https://classroom.google.com/h",
        "https://keep.google.com/",
        "https://console.cloud.google.com/run",
    ];

    for (const url of scoped) {
        assert.equal(hooks.isAccountScopedResourceUrl(new URL(url)), true, url);
    }
    for (const url of unscoped) {
        assert.equal(hooks.isAccountScopedResourceUrl(new URL(url)), false, url);
    }
});

test("document and folder deep-links bypass the navigation-type toggles", async () => {
    const {hooks} = createHarness({
        settings: {
            targetSites: ["drive.google.com", "docs.google.com", "mail.google.com", "calendar.google.com"],
            interceptExternalClicks: false,
            interceptDirectNavigation: false,
            interceptGoogleNavigation: false,
        },
    });

    const documentDecision = await hooks.getRedirectDecision({
        url: "https://docs.google.com/document/d/abc123/edit",
        navigationType: "google-navigation",
        sourceHostname: "docs.google.com",
        tabId: 1,
    });
    assert.match(documentDecision.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);

    const folderDecision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/folders/14Qj219lJGsuRxkh3oH_2?usp=drive_link",
        navigationType: "google-navigation",
        sourceHostname: "mail.google.com",
        tabId: 4,
    });
    assert.match(folderDecision.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);

    const openDecision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/open?id=14Qj219lJGsuRxkh3oH_2",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 5,
    });
    assert.match(openDecision.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);

    const markedFolderDecision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/u/1/folders/14Qj219lJGsuRxkh3oH_2",
        navigationType: "google-navigation",
        sourceHostname: "mail.google.com",
        tabId: 6,
    });
    assert.equal(markedFolderDecision.redirectUrl, null);

    const threadDecision = await hooks.getRedirectDecision({
        url: "https://mail.google.com/mail/#inbox/FMfcgzGtwqYbpFyGnDCLZzdVLBrbLDlq",
        navigationType: "google-navigation",
        sourceHostname: "docs.google.com",
        tabId: 7,
    });
    assert.match(threadDecision.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);

    const eventDecision = await hooks.getRedirectDecision({
        url: "https://calendar.google.com/calendar/event?action=VIEW&eid=bXYzdGFza3M",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 8,
    });
    assert.match(eventDecision.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);

    const markedThreadDecision = await hooks.getRedirectDecision({
        url: "https://mail.google.com/mail/u/0/#inbox/FMfcgzGtwqYbpFyGnDCLZzdVLBrbLDlq",
        navigationType: "google-navigation",
        sourceHostname: "docs.google.com",
        tabId: 9,
    });
    assert.equal(markedThreadDecision.redirectUrl, null);

    // Service-level URLs are still gated by the toggles.
    const serviceDecision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive",
        navigationType: "google-navigation",
        sourceHostname: "docs.google.com",
        tabId: 2,
    });
    assert.equal(serviceDecision.redirectUrl, null);

    // A document that already names an account keeps skipping the chooser.
    const markedDecision = await hooks.getRedirectDecision({
        url: "https://docs.google.com/document/u/1/d/abc123/edit",
        navigationType: "google-navigation",
        sourceHostname: "docs.google.com",
        tabId: 3,
    });
    assert.equal(markedDecision.redirectUrl, null);
});

test("an early commit of the original navigation does not consume the pending redirect", async () => {
    const harness = createHarness();
    const {hooks, listeners} = harness;
    const onCommitted = listeners.onCommitted.at(0);
    const destination = "https://docs.google.com/document/d/abc123/edit";

    hooks.setPendingRedirect(7, destination, "slack.com", "external-click");

    // The original navigation commits before tabs.update lands on the chooser.
    await onCommitted({frameId: 0, tabId: 7, url: destination});

    // The pending entry survives, so the real chooser round-trip still captures.
    await onCommitted({
        frameId: 0,
        tabId: 7,
        url: `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(destination)}`,
    });
    await onCommitted({frameId: 0, tabId: 7, url: "https://docs.google.com/document/u/1/d/abc123/edit"});

    const fresh = await sendMessage(harness, {type: "getFreshSuggestion"}, {tab: {id: 7}});
    assert.equal(fresh.suggestedRule.authuser, "1");
    assert.equal(fresh.suggestedRule.targetPathPrefix, "/document/d/abc123");
});

test("a markerless return after visiting the chooser still completes the redirect", async () => {
    const harness = createHarness();
    const {hooks, listeners} = harness;
    const onCommitted = listeners.onCommitted.at(0);
    const destination = "https://drive.google.com/drive/my-drive";

    hooks.setPendingRedirect(8, destination, null, "direct-navigation");
    await onCommitted({
        frameId: 0,
        tabId: 8,
        url: `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(destination)}`,
    });
    await onCommitted({frameId: 0, tabId: 8, url: destination});

    assert.equal(hooks.isPendingRedirectReturn(8, destination), false);
    assert.equal(hooks.isCompletedRedirectReturn(8, destination), true);
});

test("with account trust off, marked links still ask unless a rule covers them", async () => {
    const {hooks} = createHarness({
        settings: {skipIfAccountSpecified: false},
    });

    const unsaved = await hooks.getRedirectDecision({
        url: "https://docs.google.com/document/u/0/d/abc123/edit",
        navigationType: "external-click",
        sourceHostname: "slack.com",
        tabId: 1,
    });
    assert.match(unsaved.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);
});

test("a rule matching the link's own account is a no-op instead of a redirect hop", async () => {
    const {hooks} = createHarness({
        settings: {
            skipIfAccountSpecified: false,
            preferredAccountRules: [
                {targetDomain: "docs.google.com", targetPathPrefix: "/document/d/abc123", sourceDomain: "", authuser: "1"},
            ],
        },
    });

    const sameAccount = await hooks.getRedirectDecision({
        url: "https://docs.google.com/document/u/1/d/abc123/edit",
        navigationType: "external-click",
        sourceHostname: "slack.com",
        tabId: 1,
    });
    assert.equal(sameAccount.redirectUrl, null);

    // A conflicting /u/N segment is rewritten, not just supplemented.
    const otherAccount = await hooks.getRedirectDecision({
        url: "https://docs.google.com/document/u/0/d/abc123/edit",
        navigationType: "external-click",
        sourceHostname: "slack.com",
        tabId: 2,
    });
    assert.equal(otherAccount.redirectUrl, "https://docs.google.com/document/u/1/d/abc123/edit?authuser=1");
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

test("disabled rules are skipped and fall through to the chooser", async () => {
    const {hooks} = createHarness({
        settings: {
            preferredAccountRules: [
                {targetDomain: "drive.google.com", sourceDomain: "", authuser: "1", enabled: false},
            ],
        },
    });

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 1,
    });

    assert.match(decision.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);
});

test("rules without an enabled field are treated as active", async () => {
    const {hooks} = createHarness({
        settings: {
            preferredAccountRules: [
                {targetDomain: "drive.google.com", sourceDomain: "", authuser: "1"},
            ],
        },
    });

    const decision = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/my-drive",
        navigationType: "direct-navigation",
        sourceHostname: null,
        tabId: 1,
    });

    assert.equal(decision.redirectUrl, "https://drive.google.com/drive/my-drive?authuser=1");
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

    assert.equal(Object.keys(defaults.accountLabels).length, 0);
    assert.equal(defaults.autoSaveSuggestedRules, false);

    const legacy = hooks.normalizeSettings({excludedSources: ["a.com"], skipRedirectIfDone: false});
    assert.equal(legacy.excludedSourceSites.length, 1);
    assert.equal(legacy.excludedSourceSites[0], "a.com");
    assert.equal(legacy.skipIfAccountSpecified, false);

    assert.equal(Object.keys(hooks.normalizeSettings({accountLabels: ["not", "a", "map"]}).accountLabels).length, 0);
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

test("DNR rules are not registered while the feature is off (default)", async () => {
    const {hooks, dnrSessionRules} = createHarness({
        settings: {interceptDirectNavigation: true},
    });

    await hooks.syncDnrRules();

    assert.equal(dnrSessionRules.length, 0);
});

test("DNR rules cover each target domain and never accounts.google.com", async () => {
    const {hooks, dnrSessionRules} = createHarness({
        settings: {
            targetSites: ["drive.google.com", "accounts.google.com", "docs.google.com"],
            interceptDirectNavigation: true,
            dnrInterception: true,
        },
    });

    await hooks.syncDnrRules();

    assert.equal(dnrSessionRules.length, 2);
    for (const rule of dnrSessionRules) {
        assert.match(rule.condition.regexFilter, /^\^https\?:\/\//);
        assert.match(rule.condition.regexFilter, /\/\.\*$/);
        assert.equal(rule.condition.regexFilter.includes("accounts"), false);
        assert.equal(rule.condition.excludedInitiatorDomains[0], "accounts.google.com");
        assert.equal(
            rule.action.redirect.regexSubstitution,
            "chrome-extension://test-extension-id/interstitial.html?target=\\0"
        );
    }
});

test("turning the DNR setting off removes registered rules", async () => {
    const harness = createHarness({
        settings: {interceptDirectNavigation: true, dnrInterception: true},
    });

    await harness.hooks.syncDnrRules();
    assert.equal(harness.dnrSessionRules.length, 2);

    harness.settings.dnrInterception = false;
    await harness.hooks.syncDnrRules();
    assert.equal(harness.dnrSessionRules.length, 0);
});

test("interstitial decisions produce a chooser URL without an allow rule", async () => {
    const harness = createHarness({
        settings: {interceptDirectNavigation: true, dnrInterception: true},
    });

    const response = await sendMessage(
        harness,
        {type: "interstitialDecision", url: "https://drive.google.com/drive/my-drive"},
        {tab: {id: 5}}
    );

    assert.equal(
        response.finalUrl,
        "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fdrive.google.com%2Fdrive%2Fmy-drive"
    );
    assert.equal(harness.dnrSessionRules.some((rule) => rule.id >= 500000), false);
});

test("interstitial passthrough adds a tab allow rule that commit removes", async () => {
    const harness = createHarness({
        settings: {interceptDirectNavigation: true, dnrInterception: true},
    });
    await harness.hooks.syncDnrRules();

    const targetUrl = "https://drive.google.com/drive/my-drive?authuser=1";
    const response = await sendMessage(
        harness,
        {type: "interstitialDecision", url: targetUrl},
        {tab: {id: 5}}
    );

    assert.equal(response.finalUrl, targetUrl);
    const allowRule = harness.dnrSessionRules.find((rule) => rule.id === 500005);
    assert.equal(allowRule.action.type, "allow");
    assert.equal(allowRule.condition.tabIds[0], 5);

    await harness.listeners.onCommitted.at(0)({frameId: 0, tabId: 5, url: targetUrl});
    assert.equal(harness.dnrSessionRules.some((rule) => rule.id === 500005), false);
});

test("interstitial decisions consume the recorded navigation context once", async () => {
    const harness = createHarness({
        settings: {
            targetSites: ["mail.google.com", "drive.google.com"],
            interceptDirectNavigation: true,
            interceptGoogleNavigation: false,
            dnrInterception: true,
        },
        tabs: {3: {id: 3, url: "https://mail.google.com/mail/"}},
    });

    const targetUrl = "https://drive.google.com/drive/my-drive";
    await harness.listeners.onBeforeNavigate.at(0)({frameId: 0, tabId: 3, url: targetUrl});

    // The recorded google-navigation context is gated off, so the first
    // decision passes through instead of using direct-navigation.
    const first = await sendMessage(
        harness,
        {type: "interstitialDecision", url: targetUrl},
        {tab: {id: 3}}
    );
    assert.equal(first.finalUrl, targetUrl);

    await harness.listeners.onCommitted.at(0)({frameId: 0, tabId: 3, url: targetUrl});

    // Context was consumed, so a second decision falls back to
    // direct-navigation and routes through the chooser.
    const second = await sendMessage(
        harness,
        {type: "interstitialDecision", url: targetUrl},
        {tab: {id: 3}}
    );
    assert.match(second.finalUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);
});

test("onBeforeNavigate records context instead of redirecting while DNR is active", async () => {
    const harness = createHarness({
        settings: {interceptDirectNavigation: true, dnrInterception: true},
    });

    await harness.listeners.onBeforeNavigate.at(0)({
        frameId: 0,
        tabId: 6,
        url: "https://drive.google.com/drive/my-drive",
    });

    assert.equal(harness.tabs.has(6), false);
});

test("orphaned allow rules are swept, foreign rules are left alone", async () => {
    const harness = createHarness({
        dnrSessionRules: [
            {id: 42, action: {type: "block"}, condition: {}},
            {id: 500007, action: {type: "allow"}, condition: {tabIds: [7]}},
        ],
    });

    await harness.hooks.sweepOrphanAllowRules();

    assert.equal(harness.dnrSessionRules.some((rule) => rule.id === 500007), false);
    assert.equal(harness.dnrSessionRules.some((rule) => rule.id === 42), true);
});

test("auto mode saves document rules directly instead of suggesting", async () => {
    const harness = createHarness({
        settings: {autoSaveSuggestedRules: true},
    });
    const {hooks, listeners, settings, badgeTextByTab} = harness;

    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", "slack.com", "external-click");
    await listeners.onCommitted.at(0)({
        frameId: 0,
        tabId: 9,
        url: "https://docs.google.com/document/u/1/d/abc/edit",
    });

    assert.equal(settings.preferredAccountRules.length, 1);
    const rule = settings.preferredAccountRules[0];
    assert.equal(rule.targetDomain, "docs.google.com");
    assert.equal(rule.targetPathPrefix, "/document/d/abc");
    assert.equal(rule.sourceDomain, "");
    assert.equal(rule.authuser, "1");
    assert.equal(typeof rule.id, "string");

    const suggestion = await sendMessage(harness, {type: "getSuggestedRule", tabId: 9});
    assert.equal(suggestion.suggestedRule, null);
    assert.equal(badgeTextByTab.get(9), "");
});

test("a fresh suggestion is offered to the page exactly once", async () => {
    const harness = createHarness();
    const {hooks, listeners} = harness;

    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", "slack.com", "external-click");
    await listeners.onCommitted.at(0)({
        frameId: 0,
        tabId: 9,
        url: "https://docs.google.com/document/u/2/d/abc/edit",
    });

    const first = await sendMessage(harness, {type: "getFreshSuggestion"}, {tab: {id: 9}});
    assert.equal(first.suggestedRule.authuser, "2");

    const second = await sendMessage(harness, {type: "getFreshSuggestion"}, {tab: {id: 9}});
    assert.equal(second.suggestedRule, null);

    // The popup path is unaffected by the offered flag.
    const popupView = await sendMessage(harness, {type: "getSuggestedRule", tabId: 9});
    assert.equal(popupView.suggestedRule.authuser, "2");
});

test("the page prompt is suppressed entirely in auto mode", async () => {
    const harness = createHarness({
        settings: {autoSaveSuggestedRules: true},
    });
    const {hooks, listeners} = harness;

    // A service-wide return (no /d/<id> path) is not auto-saved and stays a suggestion.
    hooks.setPendingRedirect(4, "https://drive.google.com/", "slack.com", "external-click");
    await listeners.onCommitted.at(0)({
        frameId: 0,
        tabId: 4,
        url: "https://drive.google.com/?authuser=1",
    });

    const popupView = await sendMessage(harness, {type: "getSuggestedRule", tabId: 4});
    assert.equal(popupView.suggestedRule.authuser, "1");

    const pageOffer = await sendMessage(harness, {type: "getFreshSuggestion"}, {tab: {id: 4}});
    assert.equal(pageOffer.suggestedRule, null);
});

test("savePageSuggestedRule saves, consumes, and clears the badge", async () => {
    const harness = createHarness();
    const {hooks, listeners, settings, badgeTextByTab} = harness;

    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", "slack.com", "external-click");
    await listeners.onCommitted.at(0)({
        frameId: 0,
        tabId: 9,
        url: "https://docs.google.com/document/u/1/d/abc/edit",
    });
    assert.equal(badgeTextByTab.get(9), "1");

    const response = await sendMessage(harness, {type: "savePageSuggestedRule"}, {tab: {id: 9}});

    assert.equal(response.ok, true);
    assert.equal(settings.preferredAccountRules.length, 1);
    assert.equal(settings.preferredAccountRules[0].targetPathPrefix, "/document/d/abc");
    assert.equal(badgeTextByTab.get(9), "");

    const popupView = await sendMessage(harness, {type: "getSuggestedRule", tabId: 9});
    assert.equal(popupView.suggestedRule, null);
});

test("a new tab's content script inherits the recorded navigation context", async () => {
    const harness = createHarness({
        settings: {interceptDirectNavigation: true},
        tabs: {1: {id: 1, url: "https://drive.google.com/drive/u/0/home"}},
    });

    await harness.listeners.onCreatedNavigationTarget.at(0)({
        sourceTabId: 1,
        tabId: 2,
        url: "https://drive.google.com/drive/shared-with-me",
    });
    assert.equal(harness.tabs.has(2), false);

    // The content script's direct-navigation guess must not bypass the
    // google-navigation gate the background already applied to this tab.
    const decision = await sendMessage(harness, {
        type: "getRedirectUrl",
        url: "https://drive.google.com/drive/shared-with-me",
        navigationType: "direct-navigation",
        sourceHostname: null,
    }, {tab: {id: 2}});
    assert.equal(decision.redirectUrl, null);

    // A tab without a recorded context still intercepts as direct navigation.
    const unrelated = await sendMessage(harness, {
        type: "getRedirectUrl",
        url: "https://drive.google.com/drive/shared-with-me",
        navigationType: "direct-navigation",
        sourceHostname: null,
    }, {tab: {id: 9}});
    assert.match(unrelated.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);
});

test("same-service navigation that names an account never asks", async () => {
    const {hooks} = createHarness({
        settings: {skipIfAccountSpecified: false, interceptGoogleNavigation: true},
    });

    // The avatar account switcher: Drive linking to itself with /u/1/.
    const accountSwitch = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/u/1/home",
        navigationType: "google-navigation",
        sourceHostname: "drive.google.com",
        tabId: 1,
    });
    assert.equal(accountSwitch.redirectUrl, null);

    // A marked link arriving from a different service still asks in strict mode.
    const crossService = await hooks.getRedirectDecision({
        url: "https://drive.google.com/drive/u/1/home",
        navigationType: "google-navigation",
        sourceHostname: "docs.google.com",
        tabId: 2,
    });
    assert.match(crossService.redirectUrl, /^https:\/\/accounts\.google\.com\/AccountChooser/);
});

test("savePreferredRule upserts by key instead of stacking conflicting rules", async () => {
    const harness = createHarness({
        settings: {autoSaveSuggestedRules: true},
    });
    const {hooks, listeners, settings} = harness;
    const onCommitted = listeners.onCommitted.at(0);

    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", "slack.com", "external-click");
    await onCommitted({frameId: 0, tabId: 9, url: "https://docs.google.com/document/u/1/d/abc/edit"});
    assert.equal(settings.preferredAccountRules.length, 1);
    assert.equal(settings.preferredAccountRules[0].authuser, "1");
    const originalId = settings.preferredAccountRules[0].id;

    // Same document, different account: the value is replaced, not duplicated.
    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", "slack.com", "external-click");
    await onCommitted({frameId: 0, tabId: 9, url: "https://docs.google.com/document/u/2/d/abc/edit"});
    assert.equal(settings.preferredAccountRules.length, 1);
    assert.equal(settings.preferredAccountRules[0].authuser, "2");
    assert.equal(settings.preferredAccountRules[0].id, originalId);
});

test("a suggestion already covered by an identical rule is not offered again", async () => {
    const harness = createHarness({
        settings: {
            preferredAccountRules: [
                {id: "r1", targetDomain: "docs.google.com", targetPathPrefix: "/document/d/abc", sourceDomain: "", authuser: "1"},
            ],
        },
    });
    const {hooks, listeners, badgeTextByTab} = harness;

    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", null, "external-click");
    await listeners.onCommitted.at(0)({frameId: 0, tabId: 9, url: "https://docs.google.com/document/u/1/d/abc/edit"});

    const popupView = await sendMessage(harness, {type: "getSuggestedRule", tabId: 9});
    assert.equal(popupView.suggestedRule, null);
    assert.equal(badgeTextByTab.get(9), "");
});

test("a fresh suggestion reports the conflicting saved account", async () => {
    const harness = createHarness({
        settings: {
            preferredAccountRules: [
                {id: "r1", targetDomain: "docs.google.com", targetPathPrefix: "/document/d/abc", sourceDomain: "", authuser: "0"},
            ],
        },
    });
    const {hooks, listeners} = harness;

    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", null, "external-click");
    await listeners.onCommitted.at(0)({frameId: 0, tabId: 9, url: "https://docs.google.com/document/u/1/d/abc/edit"});

    const fresh = await sendMessage(harness, {type: "getFreshSuggestion"}, {tab: {id: 9}});
    assert.equal(fresh.suggestedRule.authuser, "1");
    assert.equal(fresh.existingAuthuser, "0");
});

test("muteSuggestedRule stores the target and suppresses future suggestions", async () => {
    const harness = createHarness();
    const {hooks, listeners, settings, badgeTextByTab} = harness;
    const onCommitted = listeners.onCommitted.at(0);

    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", null, "external-click");
    await onCommitted({frameId: 0, tabId: 9, url: "https://docs.google.com/document/u/1/d/abc/edit"});

    const response = await sendMessage(harness, {type: "muteSuggestedRule"}, {tab: {id: 9}});
    assert.equal(response.ok, true);
    assert.deepEqual(settings.mutedSuggestions, [
        {targetDomain: "docs.google.com", targetPathPrefix: "/document/d/abc"},
    ]);
    assert.equal(badgeTextByTab.get(9), "");

    // The next chooser round-trip for the muted target stays silent.
    hooks.setPendingRedirect(9, "https://docs.google.com/document/d/abc/edit", null, "external-click");
    await onCommitted({frameId: 0, tabId: 9, url: "https://docs.google.com/document/u/2/d/abc/edit"});

    const popupView = await sendMessage(harness, {type: "getSuggestedRule", tabId: 9});
    assert.equal(popupView.suggestedRule, null);
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
