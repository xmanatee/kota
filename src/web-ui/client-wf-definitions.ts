/** All-workflows definitions panel for the KOTA web UI. */

export const CLIENT_WF_DEFINITIONS_JS = `
  // --- Workflow definitions panel ---

  function fmtTriggerSummary(triggers) {
    if (!triggers || !triggers.length) return "manual";
    return triggers.map(function(t) {
      if (t.type === "cron") return t.schedule;
      if (t.type === "interval") return fmtIntervalMs(t.intervalMs);
      if (t.type === "webhook") return "webhook";
      if (t.type === "event") return t.event;
      return t.type;
    }).join(", ");
  }

  function isTriggerable(triggers) {
    if (!triggers || !triggers.length) return true;
    return triggers.some(function(t) {
      return t.type !== "cron" && t.type !== "interval";
    });
  }

  function renderWfDefinitions(definitions, statusWorkflows) {
    $wfDefinitionsList.innerHTML = "";
    if (!definitions || !definitions.length) {
      $wfDefinitionsList.innerHTML = '<div class="run-empty">No workflow definitions</div>';
      return;
    }

    var sorted = definitions.slice().sort(function(a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    for (var i = 0; i < sorted.length; i++) {
      (function(def) {
        var wfState = statusWorkflows[def.name] || {};
        var triggerDesc = fmtTriggerSummary(def.triggers);

        var statusIcon = "";
        var statusClass = "pending";
        if (wfState.lastStatus === "success") { statusIcon = "\\u2713"; statusClass = "success"; }
        else if (wfState.lastStatus === "failed") { statusIcon = "\\u2717"; statusClass = "failed"; }
        else if (wfState.lastStatus === "interrupted") { statusIcon = "\\u26a1"; statusClass = "interrupted"; }

        var lastRun = wfState.lastCompletedAt
          ? new Date(wfState.lastCompletedAt).toLocaleString()
          : (wfState.lastStartedAt ? new Date(wfState.lastStartedAt).toLocaleString() : "");

        var item = document.createElement("div");
        item.className = "schedule-item";

        var nameDiv = document.createElement("div");
        nameDiv.className = "schedule-name";
        nameDiv.innerHTML =
          (wfState.lastStatus
            ? '<span class="run-badge ' + statusClass + '">' + statusIcon + '</span>'
            : '<span class="run-badge pending">\\u00b7</span>') +
          escapeHtml(def.name) +
          (!def.enabled ? ' <span class="run-meta">(disabled)</span>' : "");
        item.appendChild(nameDiv);

        var triggerDiv = document.createElement("div");
        triggerDiv.className = "schedule-trigger run-meta";
        triggerDiv.textContent = triggerDesc + " \\u00b7 " + def.stepCount + " step" + (def.stepCount !== 1 ? "s" : "");
        item.appendChild(triggerDiv);

        if (lastRun) {
          var lastRunDiv = document.createElement("div");
          lastRunDiv.className = "schedule-next run-meta";
          lastRunDiv.textContent = "Last: " + lastRun;
          item.appendChild(lastRunDiv);
        }

        if (isTriggerable(def.triggers)) {
          var btn = document.createElement("button");
          btn.className = "wf-ctrl-btn trigger";
          btn.textContent = "\\u25b6 Run";
          btn.title = "Trigger " + def.name;
          btn.onclick = function() { triggerWorkflowByName(def.name, btn); };
          item.appendChild(btn);
        }

        $wfDefinitionsList.appendChild(item);
      })(sorted[i]);
    }
  }

  async function refreshWfDefinitions() {
    try {
      var statusRes = await apiFetch(API + "/api/workflow/status");
      var defsRes = await apiFetch(API + "/api/workflow/definitions");
      if (!statusRes.ok || !defsRes.ok) return;
      var statusData = await statusRes.json();
      var defsData = await defsRes.json();
      renderWfDefinitions(defsData.definitions || [], statusData.workflows || {});
    } catch {}
  }
`;
