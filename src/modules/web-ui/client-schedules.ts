/** Workflow schedules panel for the KOTA web UI. */

export const CLIENT_SCHEDULES_JS = `
  // --- Schedules panel ---

  var schedulesNotice = "";

  function setSchedulesNotice(message) {
    schedulesNotice = message;
  }

  function fmtIntervalMs(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return "every " + s + "s";
    var m = Math.round(s / 60);
    if (m < 60) return "every " + m + "m";
    var h = Math.round(m / 60);
    if (h < 24) return "every " + h + "h";
    return "every " + Math.round(h / 24) + "d";
  }

  function renderSchedules(statusWorkflows, definitions) {
    $schedulesList.innerHTML = "";
    if (schedulesNotice) {
      $schedulesList.innerHTML = '<div class="run-empty">' + escapeHtml(schedulesNotice) + '</div>';
      return;
    }

    var scheduledNames = {};
    for (var i = 0; i < definitions.length; i++) {
      var def = definitions[i];
      for (var j = 0; j < def.triggers.length; j++) {
        var t = def.triggers[j];
        if (t.type === "cron" || t.type === "interval") {
          if (!scheduledNames[def.name]) scheduledNames[def.name] = [];
          scheduledNames[def.name].push(t);
        }
      }
    }

    var names = Object.keys(scheduledNames).sort();
    if (!names.length) {
      $schedulesList.innerHTML = '<div class="run-empty">No scheduled workflows</div>';
      return;
    }

    for (var k = 0; k < names.length; k++) {
      var name = names[k];
      var wfState = statusWorkflows[name] || {};
      var triggers = scheduledNames[name];
      var triggerDesc = triggers.map(function(t) {
        if (t.type === "cron") return t.schedule;
        if (t.type === "interval") return fmtIntervalMs(t.intervalMs);
        return t.type;
      }).join(", ");

      var statusIcon = "";
      var statusClass = "pending";
      if (wfState.lastStatus === "success") { statusIcon = "\\u2713"; statusClass = "success"; }
      else if (wfState.lastStatus === "failed") { statusIcon = "\\u2717"; statusClass = "failed"; }
      else if (wfState.lastStatus === "interrupted") { statusIcon = "\\u26a1"; statusClass = "interrupted"; }

      var nextRun = wfState.nextScheduledAt
        ? new Date(wfState.nextScheduledAt).toLocaleString()
        : "(not scheduled)";

      var item = document.createElement("div");
      item.className = "schedule-item";
      item.innerHTML =
        '<div class="schedule-name">' +
          (wfState.lastStatus
            ? '<span class="run-badge ' + statusClass + '">' + statusIcon + '</span>'
            : '<span class="run-badge pending">\\u00b7</span>') +
          escapeHtml(name) +
        '</div>' +
        '<div class="schedule-trigger run-meta">' + escapeHtml(triggerDesc) + '</div>' +
        '<div class="schedule-next run-meta">Next: ' + escapeHtml(nextRun) + '</div>';
      $schedulesList.appendChild(item);
    }
  }

  async function refreshSchedules() {
    try {
      var statusRes = await apiFetch(API + "/api/workflow/status");
      var defsRes = await apiFetch(API + "/api/workflow/definitions");
      if (!statusRes.ok || !defsRes.ok) {
        setSchedulesNotice("Failed to load schedules");
        renderSchedules({}, []);
        return;
      }
      var statusData = await statusRes.json();
      var defsData = await defsRes.json();
      setSchedulesNotice("");
      renderSchedules(statusData.workflows || {}, defsData.definitions || []);
    } catch {
      setSchedulesNotice("Failed to load schedules");
      renderSchedules({}, []);
    }
  }
`;
