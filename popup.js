document.addEventListener("DOMContentLoaded", async () => {
  const enabled = document.getElementById("enabled");
  const mode = document.getElementById("mode");
  const sites = document.getElementById("sites");
  const saveBtn = document.getElementById("save");

  // Load saved settings
  const data = await chrome.storage.sync.get(["enabled", "mode", "sites"]);
  enabled.checked = data.enabled ?? true;
  mode.value = data.mode ?? "exclude";
  sites.value = (data.sites ?? []).join(", ");

  saveBtn.addEventListener("click", async () => {
    const newSites = sites.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    await chrome.storage.sync.set({
      enabled: enabled.checked,
      mode: mode.value,
      sites: newSites,
    });

    saveBtn.textContent = "Saved Successfully!";
    setTimeout(() => (saveBtn.textContent = "Save"), 1500);
  });
});
