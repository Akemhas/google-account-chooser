# Privacy Policy for Google Account Chooser Redirect

This Privacy Policy explains the data practices for the "Google Account Chooser Redirect" Chrome extension, developed by
a solo developer (Akemhas).

**Last Updated:** October 13, 2025

## 1. Data Collection and Storage

### A. Data Collected

The **Google Account Chooser Redirect** extension is designed to run locally in your browser and **does not collect,
store, or transmit any Personally Identifiable Information (PII)**.

The extension only collects and stores user preferences required for its core functionality. This data is non-personally
identifiable and is stored locally within your Chrome profile using the `chrome.storage.sync` API.

The following user settings are collected and stored:

| Data Item            | Purpose                                                                                                               |
|:---------------------|:----------------------------------------------------------------------------------------------------------------------|
| **Enabled State**    | To remember if the user has turned the redirection functionality ON or OFF.                                           |
| **Mode Preference**  | To remember whether the extension is using the "Include List" or "Exclude List" filtering mode.                       |
| **Custom Site List** | To store the list of hostnames (websites) manually entered by the user to control where the redirection logic is run. |

### B. Data Usage and Sharing

The collected user settings are used **solely** for the operational purpose of the extension to determine where the
redirection occurs. No user data is transferred, sold, rented, or shared with any third parties, advertising networks,
or external servers. All core functionality occurs exclusively within your browser.

---

## 2. Permissions and Host Permissions Used

The extension requires the following permissions, which are strictly necessary to perform its advertised function:

| Permission                         | Justification for Use                                                                                                                                                                                                                                                                                                                                                 |
|:-----------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **`storage`**                      | Used only to save the non-PII user settings (Enabled State, Mode, and Custom Site List) described above.                                                                                                                                                                                                                                                              |
| **`scripting`**                    | Used to dynamically inject the `redirector.js` script into specific web pages to check for Google links and perform the redirection.                                                                                                                                                                                                                                  |
| **`activeTab`**                    | Used only when the user interacts with the extension popup to get the current tab's details for displaying context-relevant information.                                                                                                                                                                                                                              |
| **`host_permissions`** (`*://*/*`) | **This broad permission is required** to allow the background script to dynamically inject the content script onto user-configured websites. The content script itself runs with strict internal logic, only checking for Google Docs/Drive links and respecting the user's inclusion/exclusion list. **No data is collected or transmitted due to this permission.** |

---

## 3. Changes to This Privacy Policy

This Privacy Policy may be updated occasionally. We will always update the "Last Updated" date at the top of the policy.
Continued use of the extension after any changes constitutes your acceptance of the new policy.

## 4. Contact Us

If you have any questions or concerns about this Privacy Policy or the data practices of the extension, please contact
the developer at:

**Akemhas.ce@gmail.com**