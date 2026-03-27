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
