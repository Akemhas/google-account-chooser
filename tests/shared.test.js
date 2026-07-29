const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");

function createPageContext() {
    const context = {URL, console, Date, Math, globalThis: null};
    context.globalThis = context;
    vm.createContext(context);

    for (const file of ["config.js", "shared.js"]) {
        const filePath = path.join(repoRoot, file);
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {filename: filePath});
    }

    return context;
}

const ctx = createPageContext();

test("isValidDomain accepts real domains and rejects malformed input", () => {
    assert.equal(ctx.isValidDomain("docs.google.com"), true);
    assert.equal(ctx.isValidDomain("sub.example.co.uk"), true);
    assert.equal(ctx.isValidDomain(""), false);
    assert.equal(ctx.isValidDomain("nodots"), false);
    assert.equal(ctx.isValidDomain("bad..dots.com"), false);
    assert.equal(ctx.isValidDomain(".leading.com"), false);
    assert.equal(ctx.isValidDomain("has space.com"), false);
    assert.equal(ctx.isValidDomain(`${"a".repeat(64)}.com`), false);
});

test("sanitizeDomainInput strips scheme, path, port, and case", () => {
    assert.equal(ctx.sanitizeDomainInput("https://Docs.Google.com/document/d/abc"), "docs.google.com");
    assert.equal(ctx.sanitizeDomainInput("example.com:8080/x"), "example.com");
    assert.equal(ctx.sanitizeDomainInput("  EXAMPLE.com  "), "example.com");
});

test("sanitizePathPrefixInput normalizes /u/N segments, roots, and full URLs", () => {
    assert.equal(ctx.sanitizePathPrefixInput("/document/u/2/d/abc/edit"), "/document/d/abc/edit");
    assert.equal(ctx.sanitizePathPrefixInput("https://docs.google.com/document/d/abc/"), "/document/d/abc");
    assert.equal(ctx.sanitizePathPrefixInput("/"), "");
    assert.equal(ctx.sanitizePathPrefixInput(""), "");
    assert.equal(ctx.sanitizePathPrefixInput("document/d/abc"), "/document/d/abc");
});

test("domainMatchesList matches exact domains and subdomains only", () => {
    const list = ["google.com", "slack.com"];
    assert.equal(ctx.domainMatchesList("google.com", list), true);
    assert.equal(ctx.domainMatchesList("docs.google.com", list), true);
    assert.equal(ctx.domainMatchesList("notgoogle.com", list), false);
    assert.equal(ctx.domainMatchesList("google.com.evil.io", list), false);
});

test("validateImport rejects wrong formats and newer schema versions", () => {
    assert.throws(() => ctx.validateImport(null), /Not a settings export/);
    assert.throws(() => ctx.validateImport({format: "something-else", schemaVersion: 1, settings: {}}), /Not a settings export/);
    assert.throws(() => ctx.validateImport({format: "gacr-settings", schemaVersion: 2, settings: {}}), /newer version/);
    assert.throws(() => ctx.validateImport({format: "gacr-settings", schemaVersion: 1}), /no settings/);
});

test("validateImport drops invalid domains and reports them", () => {
    const {settings, report} = ctx.validateImport({
        format: "gacr-settings",
        schemaVersion: 1,
        settings: {targetSites: ["docs.google.com", "not a domain", 42, "https://drive.google.com/x"]},
    });

    assert.equal(settings.targetSites.length, 2);
    assert.equal(settings.targetSites.includes("docs.google.com"), true);
    assert.equal(settings.targetSites.includes("drive.google.com"), true);
    assert.equal(report.skipped, 2);
});

test("validateImport re-sanitizes rules and regenerates colliding ids", () => {
    const {settings, report} = ctx.validateImport({
        format: "gacr-settings",
        schemaVersion: 1,
        settings: {
            preferredAccountRules: [
                {id: "same", targetDomain: "Docs.Google.com", targetPathPrefix: "/document/u/1/d/abc/edit", authuser: " 1 ", enabled: false},
                {id: "same", targetDomain: "drive.google.com", authuser: "2"},
                {targetDomain: "", authuser: "3"},
                {targetDomain: "drive.google.com", authuser: ""},
            ],
        },
    });

    assert.equal(settings.preferredAccountRules.length, 2);
    const [first, second] = settings.preferredAccountRules;
    assert.equal(first.targetDomain, "docs.google.com");
    assert.equal(first.targetPathPrefix, "/document/d/abc/edit");
    assert.equal(first.authuser, "1");
    assert.equal(first.enabled, false);
    assert.equal(second.targetDomain, "drive.google.com");
    assert.notEqual(second.id, "same");
    assert.equal(report.skipped, 2);
});

test("validateImport type-checks booleans and labels", () => {
    const {settings, report} = ctx.validateImport({
        format: "gacr-settings",
        schemaVersion: 1,
        settings: {
            enabled: "yes",
            interceptExternalClicks: false,
            accountLabels: {"1": "Work", "2": "", "3": `${"x".repeat(50)}`},
        },
    });

    assert.equal("enabled" in settings, false);
    assert.equal(settings.interceptExternalClicks, false);
    assert.equal(settings.accountLabels["1"], "Work");
    assert.equal("2" in settings.accountLabels, false);
    assert.equal(settings.accountLabels["3"].length, 32);
    assert.equal(report.skipped >= 2, true);
});

test("formatAuthuserLabel appends the label when one exists", () => {
    assert.equal(ctx.formatAuthuserLabel("1", {"1": "Work"}), "authuser=1 · Work");
    assert.equal(ctx.formatAuthuserLabel("2", {"1": "Work"}), "authuser=2");
    assert.equal(ctx.formatAuthuserLabel("0", undefined), "authuser=0");
});

test("rulesAreEquivalent treats missing optional fields as empty", () => {
    const stored = {targetDomain: "drive.google.com", authuser: "1"};
    const candidate = {targetDomain: "drive.google.com", targetPathPrefix: "", sourceDomain: "", authuser: "1"};
    assert.equal(ctx.rulesAreEquivalent(stored, candidate), true);

    const different = {...candidate, authuser: "2"};
    assert.equal(ctx.rulesAreEquivalent(stored, different), false);
});
