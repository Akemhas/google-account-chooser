# Google Account Chooser Redirect

A Chrome/Vivaldi extension for improving the multi-account experience across Google services.

## Overview

This extension routes supported Google links and navigations through Google's Account Chooser before the final destination opens. It can intercept external clicks, typed or bookmarked Google URLs, and navigation between supported Google apps.

When working with multiple Google accounts, this helps you choose the correct account before opening the destination and reduces accidental opens in the wrong profile. The supported services are configurable and default to a wider Google domain list including Drive, Docs, Gmail, Calendar, Photos, Meet, Chat, Forms, Cloud, Firebase, and others.

## Key Features

- global enable/disable toggle
- configurable target Google domains
- excluded source domains where click interception should not run
- optional direct-navigation interception for typed/bookmarked URLs
- optional Google-to-Google interception
- preferred-account rules that add `authuser` directly instead of showing chooser whenever they match
- suggested account rule capture after chooser-based redirects, with one-click saving from the popup
- links that open in a new tab (`target=_blank`, middle-click) are intercepted too
- toolbar badge: "1" when a rule suggestion is waiting for the current tab, "OFF" when disabled
- keyboard shortcut to toggle the extension (default `Alt+Shift+G`, rebindable at `chrome://extensions/shortcuts`)
- page reloads and back/forward navigations are never intercepted, and URLs that already name an account (`authuser` or `/u/N/`) open directly

## Stored Settings

The extension stores the following in `chrome.storage.sync`:

- enabled state
- target service domains
- excluded source domains
- redirect behavior toggles
- preferred account rules, including user-entered `authuser` values

## Project Structure

```
google-account-chooser/
├── manifest.json              # MV3 manifest — permissions, service worker, popup, CSP
├── background.js              # Service worker: redirect decision engine, content-script registration
├── config.js                  # Content script (1st): shared defaults on globalThis
├── redirector.js              # Content script (2nd): direct-nav redirect + click interception
├── popup.html                 # Settings UI markup + styles
├── popup.js                   # Settings UI logic
├── icons/                     # icon.svg source + rendered 16/32/48/128 PNGs
├── tests/
│   └── background.test.js     # node:test suite — runs background.js in a vm with mocked chrome API
├── CLAUDE.md                  # Guidance for Claude Code (claude.ai/code)
├── README.md
└── PRIVACY.md                 # Privacy policy
```

## Installation

1. Open `chrome://extensions/` or `vivaldi://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `google-account-chooser` folder.

## Repo Notes

The repository root is the unpacked extension source — there is no build step. Load the repo folder directly as an unpacked extension. Tests use Node's built-in test runner: `node --test` (Node 18+, no dependencies).
