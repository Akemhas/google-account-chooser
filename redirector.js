(async () => {
    const data = await chrome.storage.sync.get([
        "enabled",
        "targetSites",
        "excludedSourceSites",
        "excludedSources",
    ]);

    const enabled = data.enabled ?? true;
    const targetSites = data.targetSites?.length ? data.targetSites : DEFAULT_GOOGLE_DOMAINS;

    if (!enabled) return;

    const currentSiteHostname = location.hostname;
    const excludedSites = data.excludedSourceSites ?? data.excludedSources ?? [];

    if (excludedSites.some((site) => currentSiteHostname === site || currentSiteHostname.endsWith(`.${site}`))) {
        return;
    }

    const isTargetLink = (rawUrl) => {
        try {
            const {hostname} = new URL(rawUrl);
            return targetSites.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        } catch {
            return false;
        }
    };

    // Reloads, back/forward, and prerenders must never re-trigger the chooser.
    const navigationEntryType = performance.getEntriesByType("navigation")[0]?.type ?? "navigate";

    const currentUrl = window.location.href;
    if (navigationEntryType === "navigate" && isTargetLink(currentUrl)) {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getRedirectUrl",
                url: currentUrl,
                navigationType: "direct-navigation",
                sourceHostname: null,
            });

            if (response?.redirectUrl && response.redirectUrl !== location.href) {
                location.replace(response.redirectUrl);
                return;
            }
        } catch (error) {
            console.error("Failed to redirect direct navigation:", error);
        }
    }

    document.addEventListener("click", async (event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const link = event.target.closest("a");
        if (!link?.href || !isTargetLink(link.href)) return;

        if (link.target && link.target !== "_self") return;
        if (link.hasAttribute("download")) return;

        const linkUrl = new URL(link.href);
        if (
            linkUrl.origin === location.origin &&
            linkUrl.pathname === location.pathname &&
            linkUrl.search === location.search
        ) {
            return;
        }

        const sourceHostname = currentSiteHostname;
        const navigationType = isTargetLink(window.location.href) ? "google-navigation" : "external-click";

        const response = await chrome.runtime.sendMessage({
            type: "getRedirectUrl",
            url: link.href,
            navigationType,
            sourceHostname,
        });

        if (!response?.redirectUrl) return;
        if (event.defaultPrevented) return;

        event.preventDefault();
        location.assign(response.redirectUrl);
    }, true);

    // After a chooser-based redirect lands here, offer to remember the chosen
    // account for this document with a small top-right prompt (ask mode only —
    // the background answers null in auto mode or when nothing fresh exists).
    const showSuggestionPrompt = (suggestion, existingAuthuser) => {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const palette = dark
            ? {bg: "#22242b", text: "#e8eaef", muted: "#a4a9b4", border: "#464a55", accent: "#7d95f0", onAccent: "#0f1320", danger: "#f2b8b5"}
            : {bg: "#ffffff", text: "#1a1d23", muted: "#555b66", border: "#c9ccd4", accent: "#3555d8", onAccent: "#ffffff", danger: "#b3261e"};

        const card = document.createElement("div");
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-label", "Remember account for this page");
        Object.assign(card.style, {
            position: "fixed",
            top: "16px",
            right: "16px",
            zIndex: "2147483647",
            maxWidth: "320px",
            padding: "12px 14px",
            borderRadius: "10px",
            border: `1px solid ${palette.border}`,
            background: palette.bg,
            color: palette.text,
            font: "13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
            boxShadow: "0 6px 20px rgb(0 0 0 / 0.18)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
        });

        const scope = suggestion.targetPathPrefix
            ? "this item"
            : suggestion.targetDomain;
        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.textContent = existingAuthuser !== null
            ? `Switch ${scope} from account ${existingAuthuser} to account ${suggestion.authuser}?`
            : `Always open ${scope} with account ${suggestion.authuser}?`;

        const detail = document.createElement("div");
        Object.assign(detail.style, {color: palette.muted, fontSize: "12px", overflowWrap: "anywhere"});
        detail.textContent = `${suggestion.targetDomain}${suggestion.targetPathPrefix ?? ""} — skips the account chooser next time.`;

        const actions = document.createElement("div");
        Object.assign(actions.style, {display: "flex", gap: "8px", justifyContent: "flex-end"});

        const remove = () => {
            clearTimeout(autoDismissTimer);
            card.remove();
        };

        const dismissBtn = document.createElement("button");
        dismissBtn.textContent = "Ask later";
        Object.assign(dismissBtn.style, {
            padding: "5px 10px",
            borderRadius: "8px",
            border: "1px solid transparent",
            background: "transparent",
            color: palette.muted,
            font: "inherit",
            fontWeight: "600",
            cursor: "pointer",
        });
        dismissBtn.addEventListener("click", remove);

        const neverBtn = document.createElement("button");
        neverBtn.textContent = "Never";
        Object.assign(neverBtn.style, {
            padding: "5px 10px",
            borderRadius: "8px",
            border: "1px solid transparent",
            background: "transparent",
            color: palette.danger,
            font: "inherit",
            fontWeight: "600",
            cursor: "pointer",
        });
        neverBtn.addEventListener("click", async () => {
            neverBtn.disabled = true;

            try {
                const response = await chrome.runtime.sendMessage({type: "muteSuggestedRule"});
                title.textContent = response?.ok ? "Won't ask again for this item" : "Could not update";
            } catch {
                title.textContent = "Could not update";
            }

            detail.remove();
            actions.remove();
            setTimeout(remove, 1500);
        });

        const saveBtn = document.createElement("button");
        saveBtn.textContent = existingAuthuser !== null ? "Replace" : "Save";
        Object.assign(saveBtn.style, {
            padding: "5px 12px",
            borderRadius: "8px",
            border: "1px solid transparent",
            background: palette.accent,
            color: palette.onAccent,
            font: "inherit",
            fontWeight: "600",
            cursor: "pointer",
        });
        saveBtn.addEventListener("click", async () => {
            saveBtn.disabled = true;

            try {
                const response = await chrome.runtime.sendMessage({type: "savePageSuggestedRule"});
                title.textContent = response?.ok ? "Saved" : "Could not save the rule";
            } catch {
                title.textContent = "Could not save the rule";
            }

            detail.remove();
            actions.remove();
            setTimeout(remove, 1500);
        });

        actions.appendChild(dismissBtn);
        actions.appendChild(neverBtn);
        actions.appendChild(saveBtn);
        card.appendChild(title);
        card.appendChild(detail);
        card.appendChild(actions);
        (document.body ?? document.documentElement).appendChild(card);

        const autoDismissTimer = setTimeout(remove, 12000);
    };

    if (isTargetLink(window.location.href)) {
        const requestSuggestionPrompt = async () => {
            try {
                const response = await chrome.runtime.sendMessage({type: "getFreshSuggestion"});
                if (response?.suggestedRule) showSuggestionPrompt(response.suggestedRule, response.existingAuthuser ?? null);
            } catch {
                // Service worker unreachable — skip the prompt.
            }
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                void requestSuggestionPrompt();
            }, {once: true});
        } else {
            void requestSuggestionPrompt();
        }
    }
})();
