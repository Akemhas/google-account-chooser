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

  const redirect = (url) => {
    const isGoogleLink =
      url.includes("https://docs.google.com/") ||
      url.includes("https://drive.google.com/") ||
      url.includes("https://forms.google.com/")

    if (isGoogleLink && !url.includes("AccountChooser")) {
      const chooserUrl =
        "https://accounts.google.com/AccountChooser?continue=" +
        encodeURIComponent(url)
      
      location.replace(chooserUrl) 
      
      return true
    }
    return false
  }

  const currentUrl = window.location.href
  if (redirect(currentUrl)) {
    return 
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a")
    if (!link) return

    const url = link.href
    if (!url) return

    const isGoogleLink =
      url.includes("https://docs.google.com/") ||
      url.includes("https://drive.google.com/") ||
      url.includes("https://forms.google.com/")

    if (isGoogleLink && !url.includes("AccountChooser")) {
      event.preventDefault()
      const chooserUrl =
        "https://accounts.google.com/AccountChooser?continue=" +
        encodeURIComponent(url)
      
      window.open(chooserUrl, "_blank") 
    }
  })
})()