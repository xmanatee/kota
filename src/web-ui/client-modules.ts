/** Modules status panel for the KOTA web UI. */

export const CLIENT_EXTENSIONS_JS = `
  // --- Modules panel ---

  async function refreshExtensions() {
    try {
      var res = await apiFetch(API + "/api/modules");
      if (!res.ok) {
        $extensionsList.innerHTML = '<div class="run-empty">Failed to load modules</div>';
        return;
      }
      var data = await res.json();
      _cachedExtensions = data.modules || [];
      renderExtensions(_cachedExtensions);
      refreshOverview();
    } catch {
      $extensionsList.innerHTML = '<div class="run-empty">Failed to load modules</div>';
    }
  }

  function healthBadge(ext) {
    if (ext.status === "failed") {
      var tip = ext.error ? "Load error: " + ext.error : "Failed to load";
      return '<span class="run-badge failed" title="' + escapeHtml(tip) + '">\\u2022</span>';
    }
    var health = ext.health;
    if (!health) return '<span class="run-badge success">\\u2022</span>';
    var cls = health.status === "ok" ? "success" : health.status === "restarting" ? "interrupted" : "failed";
    var tip = "Status: " + health.status + " | Restarts: " + health.restartCount;
    if (health.lastRestartAt) tip += " | Last restart: " + health.lastRestartAt;
    return '<span class="run-badge ' + cls + '" title="' + escapeHtml(tip) + '">\\u2022</span>';
  }

  function renderExtensions(modules) {
    $extensionsList.innerHTML = "";
    if (!modules.length) {
      $extensionsList.innerHTML = '<div class="run-empty">No modules loaded</div>';
      return;
    }
    for (var i = 0; i < modules.length; i++) {
      var ext = modules[i];
      var item = document.createElement("div");
      item.className = "task-item";

      var summary;
      if (ext.status === "failed") {
        summary = ext.error ? escapeHtml(ext.error) : "failed to load";
      } else {
        var parts = [];
        if (ext.toolCount) parts.push(ext.toolCount + " tool" + (ext.toolCount === 1 ? "" : "s"));
        if (ext.agentCount) parts.push(ext.agentCount + " agent" + (ext.agentCount === 1 ? "" : "s"));
        if (ext.workflowCount) parts.push(ext.workflowCount + " workflow" + (ext.workflowCount === 1 ? "" : "s"));
        if (ext.skillCount) parts.push(ext.skillCount + " skill" + (ext.skillCount === 1 ? "" : "s"));
        if (ext.channelCount) parts.push(ext.channelCount + " channel" + (ext.channelCount === 1 ? "" : "s"));
        summary = escapeHtml(parts.length ? parts.join(", ") : "no contributions");
      }

      var healthInfo = "";
      if (ext.health && ext.health.restartCount > 0) {
        healthInfo = ' <span class="task-item-area">' + ext.health.restartCount + ' restart' + (ext.health.restartCount === 1 ? "" : "s") + '</span>';
      }

      item.innerHTML =
        '<div class="task-item-header">' +
        healthBadge(ext) +
        '<span class="task-item-title">' + escapeHtml(ext.name) + '</span>' +
        (ext.version ? '<span class="task-item-area">v' + escapeHtml(ext.version) + '</span>' : '') +
        healthInfo +
        '</div>' +
        '<div class="task-item-summary">' + summary + '</div>';

      $extensionsList.appendChild(item);
    }
  }
`;
