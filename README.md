# Google Account Chooser Redirect

A simple Chrome extension designed to improve the multi-account experience for Google services.

## Overview

This extension automatically redirects clicks on Google Docs, Google Drive, and Google Forms links to the **Google
Account Chooser** page before loading the final destination.

When working with multiple Google accounts logged in, this behavior ensures you are prompted to select the correct
account for the document or service, preventing the "You need permission" error or accidental access using the wrong
account.

## Features

* **Automatic Account Chooser Redirection:** Links matching `docs.google.com`, `drive.google.com`, and
  `forms.google.com` are intercepted and routed through `accounts.google.com/AccountChooser`.
* **Toggle Enable/Disable:** A simple checkbox in the extension popup allows you to quickly turn the redirect logic on
  or off globally.
* **Site Filtering:** Control where the redirect logic runs:
    * **Exclude List (Default):** The redirect runs on *all* sites except those you specify.
    * **Include Only:** The redirect runs *only* on the sites you specify.
* **No Data Collection:** The extension stores its settings (enabled state, mode, and site list) locally using Chrome's
  `storage.sync` API and does not collect or transmit any personal data.

## Installation

1. Download the repository source code as a ZIP file or clone the repository.
2. Unzip the files to a local directory.
3. Navigate to `chrome://extensions/` in your Chrome browser.
4. Enable **Developer mode** using the toggle switch in the top right.
5. Click the **Load unpacked** button and select the directory containing the extension files (the folder with
   `manifest.json`).

The extension should now be installed and ready to use.