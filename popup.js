document.addEventListener("DOMContentLoaded", async () => {
    const enabled = document.getElementById("enabled")
    const tabs = document.querySelectorAll(".tab")
    const panels = document.querySelectorAll(".tab-panel")

    const targetsList = document.getElementById("targetsList")
    const excludedList = document.getElementById("excludedList")
    const targetInput = document.getElementById("targetInput")
    const excludedInput = document.getElementById("excludedInput")
    const addTargetBtn = document.getElementById("addTargetBtn")
    const addExcludedBtn = document.getElementById("addExcludedBtn")

    // Load saved settings
    const data = await chrome.storage.sync.get([
        "enabled",
        "targetSites",
        "excludedSourceSites",
    ])

    enabled.checked = data.enabled ?? true
    let targetSites = data.targetSites && data.targetSites.length > 0 ? data.targetSites : [...DEFAULT_GOOGLE_DOMAINS]
    let excludedSourceSites = data.excludedSourceSites ?? []

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"))
            panels.forEach(p => p.classList.remove("active"))
            tab.classList.add("active")
            document.getElementById(`${tab.dataset.tab}-panel`).classList.add("active")
        })
    })

    // Render lists
    const renderTargets = () => {
        targetsList.innerHTML = targetSites.map(site => `
            <div class="list-item">
                <div class="list-item-content">
                    <span class="item-name">${site}</span>
                </div>
                <button class="remove-btn" onclick="removeTarget('${site}')">Remove</button>
            </div>
        `).join("")
    }

    const renderExcluded = () => {
        excludedList.innerHTML = excludedSourceSites.map(site => `
            <div class="list-item">
                <div class="list-item-content">
                    <span class="item-name">${site}</span>
                </div>
                <button class="remove-btn" onclick="removeExcluded('${site}')">Remove</button>
            </div>
        `).join("")
    }

    // Save to storage
    const saveSettings = async () => {
        await chrome.storage.sync.set({
            enabled: enabled.checked,
            targetSites,
            excludedSourceSites,
        })
    }

    // Add target
    addTargetBtn.addEventListener("click", async () => {
        const site = targetInput.value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
        if (site && !targetSites.includes(site)) {
            targetSites.push(site)
            targetInput.value = ""
            renderTargets()
            await saveSettings()
        }
    })

    // Add excluded
    addExcludedBtn.addEventListener("click", async () => {
        const site = excludedInput.value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
        if (site && !excludedSourceSites.includes(site)) {
            excludedSourceSites.push(site)
            excludedInput.value = ""
            renderExcluded()
            await saveSettings()
        }
    })

    // Remove functions
    window.removeTarget = async (site) => {
        targetSites = targetSites.filter(s => s !== site)
        renderTargets()
        await saveSettings()
    }

    window.removeExcluded = async (site) => {
        excludedSourceSites = excludedSourceSites.filter(s => s !== site)
        renderExcluded()
        await saveSettings()
    }

    // Enable/Disable toggle
    enabled.addEventListener("change", async () => {
        await saveSettings()
    })

    // Initial render
    renderTargets()
    renderExcluded()
})