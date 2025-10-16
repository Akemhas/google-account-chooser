// --- Helper Functions for HTML Generation ---

const getTargetHtml = (site) => `
    <div class="list-item is-adding">
        <div class="list-item-content">
            <span class="item-name">${site}</span>
        </div>
        <button class="remove-btn" data-site="${site}">Remove</button>
    </div>
`;

const getExcludedHtml = (site) => `
    <div class="list-item is-adding">
        <div class="list-item-content">
            <span class="item-name">${site}</span>
        </div>
        <button class="remove-btn" data-site="${site}">Remove</button>
    </div>
`;

// --- Main DOM Content Loaded Listener ---
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

    const data = await chrome.storage.sync.get([
        "enabled",
        "targetSites",
        "excludedSourceSites",
    ])

    enabled.checked = data.enabled ?? true
    let targetSites = data.targetSites && data.targetSites.length > 0 ? data.targetSites : [...DEFAULT_GOOGLE_DOMAINS]
    targetSites.sort()
    let excludedSourceSites = data.excludedSourceSites ?? []

    const saveSettings = async () => {
        await chrome.storage.sync.set({
            enabled: enabled.checked,
            targetSites,
            excludedSourceSites,
        })
    }

    // Function to handle the add process with animation and immediate DOM update
    const handleAddSite = async (inputElement, listArray, listElement, htmlGenerator) => {
        const site = inputElement.value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")

        if (site && !listArray.includes(site)) {
            listArray.push(site)
            inputElement.value = ""
            await saveSettings()

            const range = document.createRange();

            const fragment = range.createContextualFragment(htmlGenerator(site));
            const newElement = fragment.firstElementChild;

            if (!newElement) return;

            listElement.prepend(newElement);
            void newElement.offsetHeight;
            newElement.classList.remove('is-adding');
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"))
            panels.forEach(p => p.classList.remove("active"))
            tab.classList.add("active")
            document.getElementById(`${tab.dataset.tab}-panel`).classList.add("active")
        })
    })

    const renderTargetsInitial = () => {
        targetsList.innerHTML = targetSites.map(site =>
            getTargetHtml(site).replace(' is-adding', '')
        ).join("")
    }

    const renderExcludedInitial = () => {
        excludedList.innerHTML = excludedSourceSites.map(site =>
            getExcludedHtml(site).replace(' is-adding', '')
        ).join("")
    }

    const removeTarget = async (site, element) => {
        element.classList.add('is-removing');
        await new Promise(resolve => setTimeout(resolve, 300));
        targetSites = targetSites.filter(s => s !== site);
        await saveSettings();
        element.remove();
    }

    const removeExcluded = async (site, element) => {
        element.classList.add('is-removing');
        await new Promise(resolve => setTimeout(resolve, 300));
        excludedSourceSites = excludedSourceSites.filter(s => s !== site);
        await saveSettings();
        element.remove();
    }

    targetsList.addEventListener("click", (e) => {
        if (e.target.classList.contains("remove-btn")) {
            const site = e.target.dataset.site;
            const listItem = e.target.closest('.list-item');
            if (site && listItem) {
                removeTarget(site, listItem);
            }
        }
    })

    excludedList.addEventListener("click", (e) => {
        if (e.target.classList.contains("remove-btn")) {
            const site = e.target.dataset.site;
            const listItem = e.target.closest('.list-item');
            if (site && listItem) {
                removeExcluded(site, listItem);
            }
        }
    })

    // --- Add target button now calls the helper function ---
    addTargetBtn.addEventListener("click", async () => {
        await handleAddSite(targetInput, targetSites, targetsList, getTargetHtml);
    })

    // --- Add excluded button now calls the helper function ---
    addExcludedBtn.addEventListener("click", async () => {
        await handleAddSite(excludedInput, excludedSourceSites, excludedList, getExcludedHtml);
    })

    enabled.addEventListener("change", async () => {
        await saveSettings()
    })

    renderTargetsInitial()
    renderExcludedInitial()
})
