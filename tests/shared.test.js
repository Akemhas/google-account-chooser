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

test("rulesAreEquivalent treats missing optional fields as empty", () => {
    const stored = {targetDomain: "drive.google.com", authuser: "1"};
    const candidate = {targetDomain: "drive.google.com", targetPathPrefix: "", sourceDomain: "", authuser: "1"};
    assert.equal(ctx.rulesAreEquivalent(stored, candidate), true);

    const different = {...candidate, authuser: "2"};
    assert.equal(ctx.rulesAreEquivalent(stored, different), false);
});
