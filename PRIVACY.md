# Privacy Policy for Google Account Chooser Redirect

**Last Updated:** July 29, 2026

## 1. Overview

Google Account Chooser Redirect runs locally in the browser and is designed to help users open supported Google service URLs with the correct Google account.

The extension does not sell user data, does not transfer user data to the developer's servers, and does not use remote analytics, advertising, or tracking services.

## 2. Data the Extension May Process or Store

To provide its core functionality, the extension may process or store the following categories of data inside the user's browser profile:

- **Personally identifiable information**
  This may include an email address if the user enters an email-based `authuser` value in a remembered account rule.
- **Authentication information**
  This includes user-entered `authuser` values and account-selection hints used to open supported Google services with the intended account.
- **Web history**
  The extension reads supported page URLs and top-level navigation events in order to decide whether a page should be routed through Google Account Chooser.
- **User activity**
  The extension listens for clicks on supported Google service links so it can redirect those links through Google Account Chooser when enabled.

The extension does **not** collect or process the following categories as part of its intended functionality:

- health information
- financial and payment information
- personal communications
- location
- website content beyond the link URL or page URL needed for redirect decisions

## 3. What the Extension Stores

All extension data lives in the browser's extension storage. Three storage areas are used, each with a different scope and lifetime. None of this data is transmitted to the developer.

### `chrome.storage.sync` — settings

Settings are stored in `chrome.storage.sync` so preferences can persist across the user's signed-in browser profile. Stored data may include:

- enabled or disabled state
- target Google service domains
- excluded source domains
- redirect behavior toggles
- preferred account rules
- document-specific remembered rules
- user-entered `authuser` values, including numeric account indexes or email-based account hints
- user-entered account labels (friendly names shown next to `authuser` values)

This data is retained until the user edits or removes it, or uninstalls the extension. Chrome may sync it across the user's signed-in browsers as part of normal profile sync.

### `chrome.storage.local` — appearance preference

The user's manual theme choice (light/dark override) is stored in `chrome.storage.local`. It stays on the local device and is retained until the user switches back to the system theme or uninstalls the extension.

### `chrome.storage.session` — short-lived per-tab redirect state

To prevent redirect loops and to offer rule suggestions, the extension keeps short-lived per-tab state in `chrome.storage.session`:

- pending redirects (the destination URL of an in-flight chooser round-trip; expires after 5 minutes)
- completed redirects (the destination hostname, used to suppress re-interception; expires after 15 seconds)
- suggested rules (the destination domain, document path prefix, source domain, and `authuser` value observed after a chooser-based redirect; expires after 10 minutes)

This data is held in session storage only: entries expire automatically on the timers above, are removed when their tab is closed, and the entire area is erased by the browser when the browser session ends. It is never written to `chrome.storage.sync` unless the user explicitly saves a suggested rule, and it never leaves the browser.

## 4. How the Data Is Used

The extension uses the processed or stored data only to provide its single purpose functionality, including:

- deciding when a supported Google URL should be routed through Google Account Chooser
- deciding when an existing account hint should be respected
- applying remembered account rules
- suggesting document-specific rules after chooser-based redirects
- restoring extension UI preferences

## 5. Data Sharing and Sale

The developer does not:

- sell user data
- rent user data
- transfer user data to data brokers
- share user data with advertisers, analytics providers, or third parties for independent use

All core behavior is executed locally in the browser.

## 6. Permissions Used

The extension currently requests these permissions:

- `storage`
  Used to persist extension settings (`chrome.storage.sync`), an appearance preference (`chrome.storage.local`), and short-lived per-tab redirect state (`chrome.storage.session`), as described in Section 3.
- `scripting`
  Used to register and inject the content script that detects supported Google service links and pages.
- `tabs`
  Used to inspect and update the current tab during redirect handling and popup-related rule workflows.
- `webNavigation`
  Used to observe top-level navigations so typed or bookmarked supported Google URLs can be intercepted earlier.
- `declarativeNetRequestWithHostAccess`
  Used, when the experimental pre-request option is enabled, to redirect supported navigations inside the browser before any network request is sent. The redirect rules are session-scoped, derived from the user's target-site list, and never leave the browser.
- `host_permissions` = `*://*/*`
  Required so the extension can run on pages where supported Google service links may appear and route those links according to the user's settings.

## 7. Data Retention and User Control

Retention differs by storage area:

- settings in `chrome.storage.sync` are kept until the user changes or removes them, or uninstalls the extension
- the appearance preference in `chrome.storage.local` is kept until changed back or uninstall
- per-tab state in `chrome.storage.session` expires automatically (5 minutes / 15 seconds / 10 minutes as described in Section 3), is removed when the tab closes, and is erased entirely when the browser session ends

Users can control stored extension data by:

- editing or removing saved rules in the extension popup
- changing extension settings in the popup
- disabling or uninstalling the extension
- clearing extension storage through the browser's extension management tools

## 8. Changes to This Policy

This Privacy Policy may be updated when the extension's behavior, permissions, or data handling changes. The "Last Updated" date at the top of this document will be revised when changes are made.

## 9. Contact

Questions about this policy, or requests concerning stored data, can be directed to: [privacy contact email]

<!-- TODO: replace [privacy contact email] with the address to publish before uploading to the Chrome Web Store. -->
