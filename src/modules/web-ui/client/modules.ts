/** Modules status panel for the KOTA web UI. */

export const CLIENT_MODULES_JS = `
  // --- Modules panel ---

  async function refreshModules() {
    try {
      var res = await apiFetch(API + "/api/modules");
      if (!res.ok) {
        $modulesList.innerHTML = '<div class="run-empty">Failed to load modules</div>';
        return;
      }
      var data = await res.json();
      _cachedModules = data.modules || [];
      renderModules(_cachedModules);
      refreshOverview();
    } catch {
      $modulesList.innerHTML = '<div class="run-empty">Failed to load modules</div>';
    }
  }

  function healthBadge(mod) {
    if (mod.status === "failed") {
      var tip = mod.error ? "Load error: " + mod.error : "Failed to load";
      return '<span class="run-badge failed" title="' + escapeHtml(tip) + '">\\u2022</span>';
    }
    var health = mod.health;
    if (!health) return '<span class="run-badge success">\\u2022</span>';
    var cls = health.status === "ok" ? "success" : health.status === "restarting" ? "interrupted" : "failed";
    var tip = "Status: " + health.status + " | Restarts: " + health.restartCount;
    if (health.lastRestartAt) tip += " | Last restart: " + health.lastRestartAt;
    return '<span class="run-badge ' + cls + '" title="' + escapeHtml(tip) + '">\\u2022</span>';
  }

  function renderModules(modules) {
    $modulesList.innerHTML = "";
    if (!modules.length) {
      $modulesList.innerHTML = '<div class="run-empty">No modules loaded</div>';
      return;
    }
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      var item = document.createElement("div");
      item.className = "task-item";

      var summary;
      if (mod.status === "failed") {
        summary = mod.error ? escapeHtml(mod.error) : "failed to load";
      } else {
        var parts = [];
        if (mod.toolCount) parts.push(mod.toolCount + " tool" + (mod.toolCount === 1 ? "" : "s"));
        if (mod.agentCount) parts.push(mod.agentCount + " agent" + (mod.agentCount === 1 ? "" : "s"));
        if (mod.workflowCount) parts.push(mod.workflowCount + " workflow" + (mod.workflowCount === 1 ? "" : "s"));
        if (mod.skillCount) parts.push(mod.skillCount + " skill" + (mod.skillCount === 1 ? "" : "s"));
        if (mod.channelCount) parts.push(mod.channelCount + " channel" + (mod.channelCount === 1 ? "" : "s"));
        summary = escapeHtml(parts.length ? parts.join(", ") : "no contributions");
      }

      var healthInfo = "";
      if (mod.health && mod.health.restartCount > 0) {
        healthInfo = ' <span class="task-item-area">' + mod.health.restartCount + ' restart' + (mod.health.restartCount === 1 ? "" : "s") + '</span>';
      }

      item.innerHTML =
        '<div class="task-item-header">' +
        healthBadge(mod) +
        '<span class="task-item-title">' + escapeHtml(mod.name) + '</span>' +
        (mod.version ? '<span class="task-item-area">v' + escapeHtml(mod.version) + '</span>' : '') +
        healthInfo +
        '</div>' +
        '<div class="task-item-summary">' + summary + '</div>';

      $modulesList.appendChild(item);
    }
  }
`;
