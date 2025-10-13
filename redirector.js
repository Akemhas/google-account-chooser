(async () => {
  const { enabled = true, mode = "exclude", sites = [] } = await chrome.storage.sync.get([
    "enabled",
    "mode",
    "sites",
  ])

  if (!enabled) return

  const currentSite = location.hostname

  const shouldRun =
    (mode === "include" && sites.includes(currentSite)) ||
    (mode === "exclude" && !sites.includes(currentSite))

  if (!shouldRun) return

  const redirect = (url, isLoad = false) => {
    const isGoogleLink =
      url.includes("https://docs.google.com/") ||
      url.includes("https://drive.google.com/") ||
      url.includes("https://forms.google.com/")

    // Check for AccountChooser, Google's authuser parameter, OR custom stop sign parameter
    const isAlreadyChoosy = url.includes("AccountChooser") || url.includes("authuser=") || url.includes("gacrdone=1")

    if (isGoogleLink && !isAlreadyChoosy) {
      // 1. Append custom stop sign parameter (&gacrdone=1) to the continue URL
      const continueUrl = url + (url.includes('?') ? '&' : '?') + 'gacrdone=1'
      
      // 2. Build the final chooser URL with the modified continue URL
      const chooserUrl =
        "https://accounts.google.com/AccountChooser?continue=" +
        encodeURIComponent(continueUrl)
      
      if (isLoad) {
        location.replace(chooserUrl) 
      } else {
        window.open(chooserUrl, "_blank")
      }
      
      return true
    }
    return false
  }

  const currentUrl = window.location.href
  if (redirect(currentUrl, true)) {
    return 
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a")
    if (!link) return

    const url = link.href
    if (!url) return

    redirect(url, false)
  })
})()