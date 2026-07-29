globalThis.DEFAULT_GOOGLE_DOMAINS = globalThis.DEFAULT_GOOGLE_DOMAINS || [
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

globalThis.normalizeRulePathname = globalThis.normalizeRulePathname || ((pathname) => {
    if (typeof pathname !== "string" || !pathname) return "";

    const normalized = pathname
        .replace(/\/u\/[^/]+/g, "")
        .replace(/\/{2,}/g, "/")
        .replace(/\/$/, "");

    return normalized || "/";
});

globalThis.SETTINGS_KEYS = globalThis.SETTINGS_KEYS || [
    "enabled",
    "targetSites",
    "excludedSourceSites",
    "excludedSources",
    "skipIfAccountSpecified",
    "skipRedirectIfDone",
    "interceptExternalClicks",
    "interceptDirectNavigation",
    "interceptGoogleNavigation",
    "dnrInterception",
    "preferredAccountRules",
    "accountLabels",
];

globalThis.normalizeSettings = globalThis.normalizeSettings || ((data) => ({
    enabled: data.enabled ?? true,
    targetSites: data.targetSites?.length ? data.targetSites : DEFAULT_GOOGLE_DOMAINS,
    excludedSourceSites: data.excludedSourceSites ?? data.excludedSources ?? [],
    skipIfAccountSpecified: data.skipIfAccountSpecified ?? data.skipRedirectIfDone ?? true,
    interceptExternalClicks: data.interceptExternalClicks ?? true,
    interceptDirectNavigation: data.interceptDirectNavigation ?? false,
    interceptGoogleNavigation: data.interceptGoogleNavigation ?? false,
    dnrInterception: data.dnrInterception ?? false,
    preferredAccountRules: Array.isArray(data.preferredAccountRules) ? data.preferredAccountRules : [],
    accountLabels: data.accountLabels && typeof data.accountLabels === "object" && !Array.isArray(data.accountLabels)
        ? data.accountLabels
        : {},
}));
