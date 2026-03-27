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
        usePreferredAccountRules: false,
        preferredAccountRules: [],
        ...overrides.settings,
    };

    const tabs = new Map(Object.entries(overrides.tabs ?? {}).map(([key, value]) => [Number(key), value]));
    const listeners = {
        onMessage: [],
        onBeforeNavigate: [],
        onCommitted: [],
        onRemoved: [],
        onChanged: [],
        unload: [],
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
        self: {
            addEventListener(type, listener) {
                if (type === "unload") {
                    listeners.unload.push(listener);
                }
            },
        },
    };

    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(backgroundSource, context, {filename: backgroundPath});

    return {
        hooks: context.__GACR_TEST_HOOKS__,
        listeners,
        settings,
        tabs,
    };
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
            usePreferredAccountRules: true,
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

test("path-specific preferred rules only match the captured document path", async () => {
    const {hooks} = createHarness({
        settings: {
            usePreferredAccountRules: true,
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

test("chooser return with authuser becomes a suggested rule on commit", () => {
    const {hooks, listeners} = createHarness();

    hooks.setPendingRedirect(9, "https://drive.google.com/drive/my-drive", "slack.com", "external-click");
    const onCommitted = listeners.onCommitted.at(0);

    onCommitted({
        frameId: 0,
        tabId: 9,
        url: "https://drive.google.com/drive/u/1/my-drive?authuser=1",
    });

    const suggestionResponse = {};
    const onMessage = listeners.onMessage.at(0);
    onMessage({type: "getSuggestedRule", tabId: 9}, {}, (response) => {
        suggestionResponse.value = response;
    });

    assert.equal(suggestionResponse.value.suggestedRule.targetDomain, "drive.google.com");
    assert.equal(suggestionResponse.value.suggestedRule.targetPathPrefix, "/drive/my-drive");
    assert.equal(suggestionResponse.value.suggestedRule.sourceDomain, "slack.com");
    assert.equal(suggestionResponse.value.suggestedRule.authuser, "1");
    assert.equal(typeof suggestionResponse.value.suggestedRule.createdAt, "number");
});
