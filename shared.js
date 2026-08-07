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

// Theme override for extension pages. "system" clears the override so the
// prefers-color-scheme media query in tokens.css takes effect.
globalThis.THEME_STORAGE_KEY = globalThis.THEME_STORAGE_KEY || "theme";

globalThis.applyTheme = globalThis.applyTheme || ((theme) => {
    if (theme === "light" || theme === "dark") {
        document.documentElement.dataset.theme = theme;
    } else {
        delete document.documentElement.dataset.theme;
    }
});

globalThis.initTheme = globalThis.initTheme || (async () => {
    try {
        const data = await chrome.storage.local.get(THEME_STORAGE_KEY);
        const theme = data[THEME_STORAGE_KEY];
        applyTheme(theme);
        return theme === "light" || theme === "dark" ? theme : "system";
    } catch {
        return "system";
    }
});

globalThis.setTheme = globalThis.setTheme || (async (theme) => {
    applyTheme(theme);

    try {
        if (theme === "light" || theme === "dark") {
            await chrome.storage.local.set({[THEME_STORAGE_KEY]: theme});
        } else {
            await chrome.storage.local.remove(THEME_STORAGE_KEY);
        }
    } catch (error) {
        console.error("Failed to persist theme:", error);
    }
});

globalThis.formatAuthuserLabel = globalThis.formatAuthuserLabel || ((authuser, accountLabels) => {
    const label = accountLabels?.[authuser];
    return label ? `authuser=${authuser} · ${label}` : `authuser=${authuser}`;
});

globalThis.RULES_QUOTA_WARNING_BYTES = globalThis.RULES_QUOTA_WARNING_BYTES || 7500;

globalThis.buildSettingsExport = globalThis.buildSettingsExport || ((settings, appVersion) => ({
    format: "gacr-settings",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    settings: {
        enabled: settings.enabled,
        targetSites: settings.targetSites,
        excludedSourceSites: settings.excludedSourceSites,
        skipIfAccountSpecified: settings.skipIfAccountSpecified,
        interceptExternalClicks: settings.interceptExternalClicks,
        interceptDirectNavigation: settings.interceptDirectNavigation,
        interceptGoogleNavigation: settings.interceptGoogleNavigation,
        preferredAccountRules: settings.preferredAccountRules,
        accountLabels: settings.accountLabels,
        mutedSuggestions: settings.mutedSuggestions,
    },
}));

// Validates an import payload. Throws on structural problems (wrong format /
// newer schema); soft-drops invalid entries and reports them.
globalThis.validateImport = globalThis.validateImport || ((payload) => {
    if (!payload || typeof payload !== "object") {
        throw new Error("Not a settings export file");
    }

    if (payload.format !== "gacr-settings") {
        throw new Error("Not a settings export file");
    }

    if (typeof payload.schemaVersion !== "number" || payload.schemaVersion > 1) {
        throw new Error("This backup was made by a newer version of the extension");
    }

    const raw = payload.settings;
    if (!raw || typeof raw !== "object") {
        throw new Error("The backup contains no settings");
    }

    const report = {imported: 0, skipped: 0, reasons: []};
    const settings = {};

    for (const key of ["enabled", "skipIfAccountSpecified", "interceptExternalClicks", "interceptDirectNavigation", "interceptGoogleNavigation"]) {
        if (typeof raw[key] === "boolean") {
            settings[key] = raw[key];
        } else if (key in raw) {
            report.skipped += 1;
            report.reasons.push(`${key}: not a boolean`);
        }
    }

    for (const key of ["targetSites", "excludedSourceSites"]) {
        if (!(key in raw)) continue;
        if (!Array.isArray(raw[key])) {
            report.skipped += 1;
            report.reasons.push(`${key}: not a list`);
            continue;
        }

        const domains = [];
        for (const entry of raw[key]) {
            const domain = typeof entry === "string" ? sanitizeDomainInput(entry) : "";
            if (domain && isValidDomain(domain) && !domains.includes(domain)) {
                domains.push(domain);
            } else {
                report.skipped += 1;
                report.reasons.push(`${key}: dropped "${String(entry).slice(0, 60)}"`);
            }
        }
        settings[key] = domains;
        report.imported += domains.length;
    }

    if ("preferredAccountRules" in raw) {
        const rules = [];
        const seenIds = new Set();

        for (const entry of Array.isArray(raw.preferredAccountRules) ? raw.preferredAccountRules : []) {
            const targetDomain = typeof entry?.targetDomain === "string" ? sanitizeDomainInput(entry.targetDomain) : "";
            const authuser = typeof entry?.authuser === "string" ? entry.authuser.trim() : "";

            if (!targetDomain || !isValidDomain(targetDomain) || !authuser) {
                report.skipped += 1;
                report.reasons.push(`rule dropped: ${JSON.stringify(entry).slice(0, 80)}`);
                continue;
            }

            const sourceDomain = typeof entry.sourceDomain === "string" && entry.sourceDomain.trim()
                ? sanitizeDomainInput(entry.sourceDomain)
                : "";
            if (sourceDomain && !isValidDomain(sourceDomain)) {
                report.skipped += 1;
                report.reasons.push(`rule dropped (bad source): ${targetDomain}`);
                continue;
            }

            const rule = {
                id: typeof entry.id === "string" && entry.id && !seenIds.has(entry.id) ? entry.id : createRuleId(),
                targetDomain,
                targetPathPrefix: typeof entry.targetPathPrefix === "string" ? sanitizePathPrefixInput(entry.targetPathPrefix) : "",
                sourceDomain,
                authuser,
            };
            if (entry.enabled === false) rule.enabled = false;

            seenIds.add(rule.id);
            rules.push(rule);
            report.imported += 1;
        }

        settings.preferredAccountRules = rules;
    }

    if ("mutedSuggestions" in raw) {
        const muted = [];

        for (const entry of Array.isArray(raw.mutedSuggestions) ? raw.mutedSuggestions : []) {
            const targetDomain = typeof entry?.targetDomain === "string" ? sanitizeDomainInput(entry.targetDomain) : "";

            if (!targetDomain || !isValidDomain(targetDomain) || typeof entry.targetPathPrefix !== "string") {
                report.skipped += 1;
                report.reasons.push(`muted entry dropped: ${JSON.stringify(entry).slice(0, 80)}`);
                continue;
            }

            muted.push({targetDomain, targetPathPrefix: sanitizePathPrefixInput(entry.targetPathPrefix)});
            report.imported += 1;
        }

        settings.mutedSuggestions = muted;
    }

    if ("accountLabels" in raw) {
        const labels = {};
        if (raw.accountLabels && typeof raw.accountLabels === "object" && !Array.isArray(raw.accountLabels)) {
            for (const [authuser, label] of Object.entries(raw.accountLabels)) {
                if (authuser.trim() && typeof label === "string" && label.trim()) {
                    labels[authuser.trim()] = label.trim().slice(0, 32);
                } else {
                    report.skipped += 1;
                    report.reasons.push(`label dropped for "${authuser}"`);
                }
            }
        } else {
            report.skipped += 1;
            report.reasons.push("accountLabels: not an object");
        }
        settings.accountLabels = labels;
    }

    return {settings, report};
});

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

// Inline SVG icons (24×24 viewBox, stroke-based, currentColor) so every page
// draws from one set without shipping icon files or inline <svg> in markup.
globalThis.ICON_SHAPES = globalThis.ICON_SHAPES || {
    copy: [
        ["rect", {x: "9", y: "9", width: "11", height: "11", rx: "2"}],
        ["path", {d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"}],
    ],
    check: [["polyline", {points: "20 6 9 17 4 12"}]],
    edit: [
        ["path", {d: "M12 20h9"}],
        ["path", {d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"}],
    ],
    trash: [
        ["path", {d: "M3 6h18"}],
        ["path", {d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],
        ["path", {d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}],
    ],
    sun: [
        ["circle", {cx: "12", cy: "12", r: "4"}],
        ["path", {d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"}],
    ],
    moon: [["path", {d: "M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"}]],
    monitor: [
        ["rect", {x: "2", y: "3", width: "20", height: "14", rx: "2"}],
        ["path", {d: "M8 21h8M12 17v4"}],
    ],
};

globalThis.createIcon = globalThis.createIcon || ((name, size = 16) => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");

    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    for (const [tag, attrs] of ICON_SHAPES[name] ?? []) {
        const shape = document.createElementNS(ns, tag);
        for (const [attr, value] of Object.entries(attrs)) shape.setAttribute(attr, value);
        svg.appendChild(shape);
    }

    return svg;
});

// Friendly name for a known Google service host ("Docs" for docs.google.com).
globalThis.serviceLabelForDomain = globalThis.serviceLabelForDomain || ((domain) =>
    SERVICE_PRESETS.find((preset) => preset.domain === domain)?.label ?? null);

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
