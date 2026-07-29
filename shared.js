// Helpers shared by the popup and options pages. Loaded after config.js;
// attaches to globalThis and touches no DOM at load time so it stays vm-testable.

globalThis.SERVICE_PRESETS = globalThis.SERVICE_PRESETS || [
    {label: "Drive", domain: "drive.google.com"},
    {label: "Docs", domain: "docs.google.com"},
    {label: "Gmail", domain: "mail.google.com"},
    {label: "Calendar", domain: "calendar.google.com"},
    {label: "Photos", domain: "photos.google.com"},
    {label: "Meet", domain: "meet.google.com"},
    {label: "Chat", domain: "chat.google.com"},
    {label: "Forms", domain: "forms.google.com"},
];

globalThis.isValidDomain = globalThis.isValidDomain || ((domain) => {
    if (!domain || domain.trim() === "") return false;

    const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

    if (!domainRegex.test(domain)) return false;
    if (domain.length > 253) return false;
    if (domain.startsWith(".") || domain.endsWith(".")) return false;
    if (domain.includes("..")) return false;
    if (domain.split(".").some((part) => part.length > 63)) return false;
    if (/[^a-z0-9.-]/i.test(domain)) return false;

    return true;
});

globalThis.sanitizeDomainInput = globalThis.sanitizeDomainInput || ((input) => {
    let domain = input.trim();

    try {
        const url = new URL(domain.startsWith("http") ? domain : `http://${domain}`);
        domain = url.hostname;
    } catch {
        domain = domain.replace(/^https?:\/\//, "");
        domain = domain.replace(/\/.*$/, "");
        domain = domain.replace(/:\d+$/, "");
    }

    return domain.toLowerCase();
});

globalThis.sanitizeAuthuserInput = globalThis.sanitizeAuthuserInput || ((input) => input.trim());

globalThis.isValidAuthuser = globalThis.isValidAuthuser || ((value) => /^\S+$/.test(value));

globalThis.sanitizePathPrefixInput = globalThis.sanitizePathPrefixInput || ((input) => {
    const trimmed = input.trim();
    if (!trimmed) return "";

    let normalized;
    try {
        const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://example.com${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`);
        normalized = normalizeRulePathname(parsed.pathname);
    } catch {
        normalized = normalizeRulePathname(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
    }

    // A bare "/" behaves service-wide, so store it as an empty prefix.
    return normalized === "/" ? "" : normalized;
});

globalThis.domainMatchesList = globalThis.domainMatchesList || ((hostname, domains) =>
    domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)));

globalThis.rulesAreEquivalent = globalThis.rulesAreEquivalent || ((a, b) =>
    a.targetDomain === b.targetDomain &&
    (a.targetPathPrefix ?? "") === (b.targetPathPrefix ?? "") &&
    (a.sourceDomain ?? "") === (b.sourceDomain ?? "") &&
    a.authuser === b.authuser);

globalThis.createRuleId = globalThis.createRuleId || (() =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

globalThis.loadSettings = globalThis.loadSettings || (async () => {
    try {
        return {settings: normalizeSettings(await chrome.storage.sync.get(SETTINGS_KEYS)), error: null};
    } catch (error) {
        console.error("Failed to load settings:", error);
        return {settings: normalizeSettings({}), error};
    }
});

globalThis.saveSettings = globalThis.saveSettings || (async (partial) => {
    try {
        await chrome.storage.sync.set(partial);
    } catch (error) {
        console.error("Failed to save settings:", error);
        const message = /quota/i.test(String(error?.message))
            ? "Sync storage is full. Export a backup, then remove unused rules."
            : "Failed to save settings";
        throw new Error(message, {cause: error});
    }
});

globalThis.showToast = globalThis.showToast || ((message, {variant = "success"} = {}) => {
    let region = document.getElementById("toast-region");
    if (!region) {
        region = document.createElement("div");
        region.id = "toast-region";
        document.body.appendChild(region);
    }

    while (region.children.length >= 2) {
        region.firstElementChild.remove();
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${variant}`;
    toast.setAttribute("role", variant === "error" ? "alert" : "status");
    toast.textContent = message;
    region.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
        toast.classList.remove("is-visible");
        setTimeout(() => toast.remove(), 250);
    }, 2500);
});

globalThis.createSiteListItem = globalThis.createSiteListItem || ((site) => {
    const container = document.createElement("div");
    container.className = "list-item";
    container.setAttribute("role", "listitem");
    container.dataset.site = site;

    const inner = document.createElement("div");
    inner.className = "list-item-inner";

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = site;

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-danger-ghost remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove ${site}`);
    removeBtn.dataset.site = site;

    inner.appendChild(name);
    inner.appendChild(removeBtn);
    container.appendChild(inner);

    return container;
});

globalThis.createEmptyState = globalThis.createEmptyState || ((text) => {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.setAttribute("role", "listitem");
    empty.textContent = text;
    return empty;
});

globalThis.animateListItemIn = globalThis.animateListItemIn || ((element) => {
    element.classList.add("is-adding");
    requestAnimationFrame(() => {
        void element.offsetHeight;
        element.classList.remove("is-adding");
    });
});

globalThis.animateListItemOut = globalThis.animateListItemOut || ((element) => new Promise((resolve) => {
    element.classList.add("is-removing");
    setTimeout(resolve, 220);
}));
