# Privacy Policy for Google Account Chooser Redirect

**Last Updated:** March 28, 2026

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

## 3. What Is Stored in `chrome.storage.sync`

The extension stores settings in `chrome.storage.sync` so preferences can persist across the user's signed-in browser profile.

Stored data may include:

- enabled or disabled state
- target Google service domains
- excluded source domains
- redirect behavior toggles
- preferred account rules
- document-specific remembered rules
- user-entered `authuser` values, including numeric account indexes or email-based account hints
- popup tab preference

This stored data remains in the user's browser storage and is not transmitted to the developer.

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
  Used to persist extension settings in `chrome.storage.sync`.
- `scripting`
  Used to register and inject the content script that detects supported Google service links and pages.
- `tabs`
  Used to inspect and update the current tab during redirect handling and popup-related rule workflows.
- `webNavigation`
  Used to observe top-level navigations so typed or bookmarked supported Google URLs can be intercepted earlier.
- `host_permissions` = `*://*/*`
  Required so the extension can run on pages where supported Google service links may appear and route those links according to the user's settings.

## 7. Data Retention and User Control

Users can control stored extension data by:

- editing or removing saved rules in the extension popup
- changing extension settings in the popup
- disabling or uninstalling the extension
- clearing extension storage through the browser's extension management tools

## 8. Changes to This Policy

This Privacy Policy may be updated when the extension's behavior, permissions, or data handling changes. The "Last Updated" date at the top of this document will be revised when changes are made.
