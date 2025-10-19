const createListItem = (site) => {
    const container = document.createElement('div');
    container.className = 'list-item is-adding';
    container.setAttribute('role', 'listitem');

    const content = document.createElement('div');
    content.className = 'list-item-content';

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = site;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${site}`);
    removeBtn.dataset.site = site;

    content.appendChild(name);
    container.appendChild(content);
    container.appendChild(removeBtn);

    return container;
};

const showError = (message) => {
    const toast = document.createElement('div');
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.style.cssText = 'position:fixed;top:10px;right:10px;background:#d32f2f;color:white;padding:12px 16px;border-radius:4px;font-size:13px;z-index:1000;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

const isValidDomain = (domain) => {
    if (!domain || domain.trim() === '') return false;

    const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

    if (!domainRegex.test(domain)) return false;
    if (domain.length > 253) return false;
    if (domain.startsWith('.') || domain.endsWith('.')) return false;
    if (domain.includes('..')) return false;
    if (domain.split('.').some(part => part.length > 63)) return false;
    if (/[^a-z0-9.-]/i.test(domain)) return false;

    return true;
};

const sanitizeDomainInput = (input) => {
    let domain = input.trim();

    try {
        const url = new URL(domain.startsWith('http') ? domain : 'http://' + domain);
        domain = url.hostname;
    } catch {
        domain = domain.replace(/^https?:\/\//, '');
        domain = domain.replace(/\/.*$/, '');
        domain = domain.replace(/:\d+$/, '');
    }

    return domain.toLowerCase();
};

document.addEventListener("DOMContentLoaded", async () => {
    const enabled = document.getElementById("enabled");
    const tabs = document.querySelectorAll(".tab");
    const panels = document.querySelectorAll(".tab-panel");
    const skipRedirectIfDone = document.getElementById("skipRedirectIfDone"); // NEW LINE

    const targetsList = document.getElementById("targetsList");
    const excludedList = document.getElementById("excludedList");
    const targetInput = document.getElementById("targetInput");
    const excludedInput = document.getElementById("excludedInput");
    const addTargetBtn = document.getElementById("addTargetBtn");
    const addExcludedBtn = document.getElementById("addExcludedBtn");
    const targetSearch = document.getElementById("targetSearch");
    const excludedSearch = document.getElementById("excludedSearch");

    let targetSites = [];
    let excludedSourceSites = [];
    let skipRedirectIfDoneSetting = true;

    try {
        const data = await chrome.storage.sync.get([
            "enabled",
            "targetSites",
            "excludedSourceSites",
        ]);

        enabled.checked = data.enabled ?? true;
        skipRedirectIfDone.checked = data.skipRedirectIfDone ?? true;
        targetSites = data.targetSites && data.targetSites.length > 0 ? data.targetSites : [...DEFAULT_GOOGLE_DOMAINS];
        targetSites.sort();
        excludedSourceSites = data.excludedSourceSites ?? [];
        skipRedirectIfDoneSetting = skipRedirectIfDone.checked;
    } catch (error) {
        console.error("Failed to load settings:", error);
        showError("Failed to load settings");
        return;
    }

    const saveSettings = async () => {
        try {
            await chrome.storage.sync.set({
                enabled: enabled.checked,
                targetSites,
                excludedSourceSites,
                skipRedirectIfDone: skipRedirectIfDone.checked,
            });
            skipRedirectIfDoneSetting = skipRedirectIfDone.checked;
        } catch (error) {
            console.error("Failed to save settings:", error);
            showError("Failed to save settings");
            throw error;
        }
    };

    const handleAddSite = async (inputElement, listArray, listElement) => {
        const rawInput = inputElement.value;
        const site = sanitizeDomainInput(rawInput);

        if (!site) {
            showError("Please enter a domain");
            return;
        }

        if (!isValidDomain(site)) {
            showError("Invalid domain format. Use: example.com or sub.example.com");
            return;
        }

        if (listArray.includes(site)) {
            showError("Site already exists");
            return;
        }

        try {
            listArray.push(site);
            inputElement.value = "";
            await saveSettings();

            const newElement = createListItem(site);
            listElement.prepend(newElement);
            void newElement.offsetHeight;
            newElement.classList.remove('is-adding');
        } catch (error) {
            const index = listArray.indexOf(site);
            if (index > -1) listArray.splice(index, 1);
        }
    };

    targetInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") addTargetBtn.click();
    });

    excludedInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") addExcludedBtn.click();
    });

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => {
                t.classList.remove("active");
                t.setAttribute("aria-selected", "false");
            });
            panels.forEach(p => p.classList.remove("active"));

            tab.classList.add("active");
            tab.setAttribute("aria-selected", "true");
            document.getElementById(`${tab.dataset.tab}-panel`).classList.add("active");
        });

        tab.addEventListener("keydown", (e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const currentIndex = Array.from(tabs).indexOf(tab);
                const nextIndex = e.key === "ArrowRight"
                    ? (currentIndex + 1) % tabs.length
                    : (currentIndex - 1 + tabs.length) % tabs.length;
                tabs[nextIndex].click();
                tabs[nextIndex].focus();
            }
        });
    });

    const renderTargetsInitial = () => {
        targetsList.innerHTML = "";
        targetSites.forEach(site => {
            const element = createListItem(site);
            element.classList.remove('is-adding');
            targetsList.appendChild(element);
        });
    };

    const renderExcludedInitial = () => {
        excludedList.innerHTML = "";
        excludedSourceSites.forEach(site => {
            const element = createListItem(site);
            element.classList.remove('is-adding');
            excludedList.appendChild(element);
        });
    };

    const filterList = (searchTerm, listElement, items) => {
        const term = searchTerm.toLowerCase().trim();
        const listItems = listElement.querySelectorAll('.list-item');

        listItems.forEach((item, index) => {
            const siteName = items[index];
            if (!siteName) return;

            if (siteName.toLowerCase().includes(term)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    };

    targetSearch.addEventListener("input", (e) => {
        filterList(e.target.value, targetsList, targetSites);
    });

    excludedSearch.addEventListener("input", (e) => {
        filterList(e.target.value, excludedList, excludedSourceSites);
    });

    const removeTarget = async (site, element) => {
        element.classList.add('is-removing');
        await new Promise(resolve => setTimeout(resolve, 300));

        try {
            targetSites = targetSites.filter(s => s !== site);
            await saveSettings();
            element.remove();
        } catch (error) {
            element.classList.remove('is-removing');
            targetSites.push(site);
        }
    };

    const removeExcluded = async (site, element) => {
        element.classList.add('is-removing');
        await new Promise(resolve => setTimeout(resolve, 300));

        try {
            excludedSourceSites = excludedSourceSites.filter(s => s !== site);
            await saveSettings();
            element.remove();
        } catch (error) {
            element.classList.remove('is-removing');
            excludedSourceSites.push(site);
        }
    };

    targetsList.addEventListener("click", (e) => {
        if (e.target.classList.contains("remove-btn")) {
            const site = e.target.dataset.site;
            const listItem = e.target.closest('.list-item');
            if (site && listItem) {
                removeTarget(site, listItem);
            }
        }
    });

    excludedList.addEventListener("click", (e) => {
        if (e.target.classList.contains("remove-btn")) {
            const site = e.target.dataset.site;
            const listItem = e.target.closest('.list-item');
            if (site && listItem) {
                removeExcluded(site, listItem);
            }
        }
    });

    addTargetBtn.addEventListener("click", async () => {
        await handleAddSite(targetInput, targetSites, targetsList);
    });

    addExcludedBtn.addEventListener("click", async () => {
        await handleAddSite(excludedInput, excludedSourceSites, excludedList);
    });

    enabled.addEventListener("change", async () => {
        try {
            await saveSettings();
        } catch (error) {
            enabled.checked = !enabled.checked;
        }
    });

    skipRedirectIfDone.addEventListener("change", async () => {
        try {
            await saveSettings();
        } catch (error) {
            skipRedirectIfDone.checked = !skipRedirectIfDone.checked;
            skipRedirectIfDoneSetting = skipRedirectIfDone.checked;
        }
    });

    renderTargetsInitial();
    renderExcludedInitial();
});