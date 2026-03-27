# Privacy Policy for Google Account Chooser Redirect

**Last Updated:** March 27, 2026

## 1. Data Collection and Storage

This extension runs locally in the browser. It does not send browsing data, account selections, or settings to any external server controlled by the developer.

The extension stores user preferences in `chrome.storage.sync` so they can persist across the user's signed-in browser profile.

Stored settings may include:

- enabled or disabled state
- target Google service domains
- excluded source domains
- redirect behavior toggles
- preferred account rules
- user-entered `authuser` values inside preferred account rules

`authuser` values can be numeric account indexes or user-entered account hints. They are stored only for the extension's redirect behavior and are not transmitted to the developer.

## 2. How Stored Data Is Used

Stored settings are used only to decide:

- when a Google URL should be redirected through Account Chooser
- when an existing account hint should be respected
- when a saved preferred-account rule should add `authuser` directly
- which source sites should be excluded from click interception

## 3. Permissions Used

The extension currently requests these permissions:

- `storage`
  Used to persist extension settings in `chrome.storage.sync`.
- `scripting`
  Used to register and inject the content script that watches supported pages and links.
- `tabs`
  Used to inspect and update the current tab during redirect handling and popup-assisted rule capture.
- `webNavigation`
  Used to observe top-level navigations so direct typed/bookmarked Google URLs can be intercepted earlier.
- `host_permissions` = `*://*/*`
  Required because the extension registers a content script broadly and then applies its own internal filtering rules.

## 4. Data Sharing

The developer does not sell, rent, or transfer this stored settings data to third parties. Extension behavior is executed locally in the browser.

## 5. Changes

This policy may be updated when extension behavior or stored settings change. The date at the top of this document will be updated when that happens.
