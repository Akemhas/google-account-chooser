const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backgroundPath = path.resolve(__dirname, "..", "background.js");
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
    const tabs = new Map(Object.entries(overrides.tabs ?? {}).map(([key, value]) => [Number(key), value]));
    const listeners = {
        onMessage: [],
        onBeforeNavigate: [],
        onCommitted: [],
        onRemoved: [],
        onChanged: [],
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
        chrome: {
            storage: {
                sync: {
                    async get() {
                        return structuredClone(settings);
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
            },
            tabs: {
                async get(tabId) {
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
