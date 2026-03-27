# Google Account Chooser Redirect

Chrome/Vivaldi extension for forcing supported Google links through Google's account chooser before the destination app opens.

## What It Does

The extension can intercept:

- clicks to supported Google services from non-Google pages
- typed or bookmarked Google service URLs
- navigation between supported Google apps

Supported services are configurable and default to a wider Google domain list including Drive, Docs, Gmail, Calendar, Photos, Meet, Chat, Forms, Cloud, Firebase, and others.

## Key Features

- global enable/disable toggle
- configurable target Google domains
- excluded source domains where click interception should not run
- optional direct-navigation interception for typed/bookmarked URLs
- optional Google-to-Google interception
- optional preferred-account rules that add `authuser` directly instead of showing chooser
- suggested account rule capture after chooser-based redirects

## Stored Settings

The extension stores the following in `chrome.storage.sync`:

- enabled state
- target service domains
- excluded source domains
- redirect behavior toggles
- preferred account rules, including user-entered `authuser` values

## Installation

1. Open `chrome://extensions/` or `vivaldi://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `google-account-chooser` folder.

## Repo Notes

The repository root also contains older packaged builds and legacy files. The active unpacked extension source lives in the `google-account-chooser` directory.
