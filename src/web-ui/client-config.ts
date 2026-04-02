/** Config viewer panel for the KOTA web UI. */

export const CLIENT_CONFIG_JS = `
  // --- Config panel ---

  async function refreshConfig() {
    if (!$configList) return;
    try {
      var res = await apiFetch(API + "/api/config");
      if (!res.ok) {
        $configList.innerHTML = '<div class="run-empty">Failed to load config</div>';
        return;
      }
      var data = await res.json();
      renderConfig(data.config || {});
    } catch {
      $configList.innerHTML = '<div class="run-empty">Failed to load config</div>';
    }
  }

  function renderConfig(config) {
    if (!$configList) return;
    $configList.innerHTML = "";
    var keys = Object.keys(config);
    if (!keys.length) {
      $configList.innerHTML = '<div class="run-empty">No config loaded</div>';
      return;
    }
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = config[key];
      var item = document.createElement("div");
      item.className = "overview-row";
      var valStr = typeof val === "object" && val !== null
        ? JSON.stringify(val)
        : String(val);
      item.innerHTML =
        '<span class="overview-label" title="' + escapeHtml(key) + '">' + escapeHtml(key) + '</span>' +
        '<span class="overview-value" title="' + escapeHtml(valStr) + '" style="font-family:monospace;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(valStr) + '</span>';
      $configList.appendChild(item);
    }
  }
`;
