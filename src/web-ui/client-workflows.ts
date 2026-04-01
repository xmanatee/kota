/** Workflow controls, run list, filter, and refresh functions for the KOTA web UI. */

export const CLIENT_WORKFLOWS_JS = `
  // --- Shared trigger helper ---

  async function triggerWorkflowByName(name, btn) {
    if (btn) btn.disabled = true;
    try {
      var r = await apiFetch(API + "/api/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name }),
      });
      if (!r.ok) {
        var d = await r.json();
        if (btn) btn.title = d.error || "Error";
      } else {
        if (btn) btn.title = "Queued!";
      }
      await refreshWorkflows();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // --- Workflow controls ---

  function renderWorkflowControls(paused, workflowNames, activeRunCount) {
    $workflowControls.innerHTML = "";
    var row = document.createElement("div");
    row.className = "wf-controls";

    var pauseBtn = document.createElement("button");
    pauseBtn.className = "wf-ctrl-btn " + (paused ? "resume" : "pause");
    pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
    pauseBtn.onclick = async function() {
      pauseBtn.disabled = true;
      try {
        await apiFetch(API +(paused ? "/api/workflow/resume" : "/api/workflow/pause"), { method: "POST" });
        await refreshWorkflows();
      } finally {
        pauseBtn.disabled = false;
      }
    };
    row.appendChild(pauseBtn);

    if (activeRunCount > 0) {
      var abortBtn = document.createElement("button");
      abortBtn.className = "wf-ctrl-btn abort";
      abortBtn.textContent = "⏹ Abort";
      abortBtn.title = "Abort all active runs";
      abortBtn.onclick = async function() {
        if (!confirm("Abort all active workflow runs?")) return;
        abortBtn.disabled = true;
        try {
          await apiFetch(API +"/api/workflow/abort", { method: "POST" });
          await refreshWorkflows();
        } finally {
          abortBtn.disabled = false;
        }
      };
      row.appendChild(abortBtn);
    }

    for (var i = 0; i < workflowNames.length; i++) {
      (function(name) {
        var btn = document.createElement("button");
        btn.className = "wf-ctrl-btn trigger";
        btn.textContent = "▶ " + name;
        btn.title = "Trigger " + name;
        btn.onclick = function() { triggerWorkflowByName(name, btn); };
        row.appendChild(btn);
      })(workflowNames[i]);
    }

    $workflowControls.appendChild(row);
  }

  // --- History filter state ---

  var _allRecentRuns = [];
  var _allActiveRuns = [];
  var _allPendingRuns = [];
  var _runsOffset = 0;
  var _runsLoading = false;
  var _canLoadMore = false;
  var wfFilter = { workflow: "", status: "", dateRange: "all", tag: "" };

  function renderHistoryFilter(workflowNames, tagNames) {
    $workflowHistoryFilter.innerHTML = "";

    var row1 = document.createElement("div");
    row1.className = "wf-filter-row";

    var wfSel = document.createElement("select");
    wfSel.className = "wf-filter-select";
    wfSel.title = "Filter by workflow";
    var allWfOpt = document.createElement("option");
    allWfOpt.value = "";
    allWfOpt.textContent = "All";
    wfSel.appendChild(allWfOpt);
    for (var i = 0; i < workflowNames.length; i++) {
      var wfOpt = document.createElement("option");
      wfOpt.value = workflowNames[i];
      wfOpt.textContent = workflowNames[i];
      wfSel.appendChild(wfOpt);
    }
    wfSel.value = wfFilter.workflow;
    wfSel.onchange = function() { wfFilter.workflow = wfSel.value; applyHistoryFilter(); };
    row1.appendChild(wfSel);

    var stSel = document.createElement("select");
    stSel.className = "wf-filter-select";
    stSel.title = "Filter by status";
    [["", "Any status"], ["failed", "Failed"], ["success", "Completed"], ["interrupted", "Interrupted"]].forEach(function(pair) {
      var opt = document.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      stSel.appendChild(opt);
    });
    stSel.value = wfFilter.status;
    stSel.onchange = function() { wfFilter.status = stSel.value; applyHistoryFilter(); };
    row1.appendChild(stSel);

    var tagSel = document.createElement("select");
    tagSel.className = "wf-filter-select wf-filter-tag";
    tagSel.title = "Filter by tag";
    var allTagOpt = document.createElement("option");
    allTagOpt.value = "";
    allTagOpt.textContent = "All tags";
    tagSel.appendChild(allTagOpt);
    for (var j = 0; j < tagNames.length; j++) {
      var tagOpt = document.createElement("option");
      tagOpt.value = tagNames[j];
      tagOpt.textContent = tagNames[j];
      tagSel.appendChild(tagOpt);
    }
    tagSel.value = wfFilter.tag;
    tagSel.onchange = function() { wfFilter.tag = tagSel.value; applyHistoryFilter(); };
    row1.appendChild(tagSel);

    $workflowHistoryFilter.appendChild(row1);

    var row2 = document.createElement("div");
    row2.className = "wf-filter-dates";
    [["all", "All time"], ["today", "Today"], ["7d", "7 days"]].forEach(function(pair) {
      var btn = document.createElement("button");
      btn.className = "wf-date-btn" + (wfFilter.dateRange === pair[0] ? " active" : "");
      btn.textContent = pair[1];
      btn.setAttribute("data-range", pair[0]);
      btn.onclick = (function(range, b) {
        return function() {
          wfFilter.dateRange = range;
          row2.querySelectorAll(".wf-date-btn").forEach(function(x) { x.classList.remove("active"); });
          b.classList.add("active");
          applyHistoryFilter();
        };
      })(pair[0], btn);
      row2.appendChild(btn);
    });
    $workflowHistoryFilter.appendChild(row2);
  }

  function applyHistoryFilter() {
    var cutoff = 0;
    if (wfFilter.dateRange === "today") {
      var d = new Date(); d.setHours(0, 0, 0, 0); cutoff = d.getTime();
    } else if (wfFilter.dateRange === "7d") {
      cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    }
    var filtered = _allRecentRuns.filter(function(r) {
      if (wfFilter.workflow && r.workflow !== wfFilter.workflow) return false;
      if (wfFilter.status && r.status !== wfFilter.status) return false;
      if (cutoff && new Date(r.startedAt).getTime() < cutoff) return false;
      if (wfFilter.tag && !(r.tags && r.tags.indexOf(wfFilter.tag) !== -1)) return false;
      return true;
    });
    renderWorkflows(_allActiveRuns, filtered, _allPendingRuns);
  }

  // --- Workflow runs panel ---

  function renderWorkflows(activeRuns, recentRuns, pendingRuns) {
    $workflowList.innerHTML = "";
    var shown = 0;
    pendingRuns = pendingRuns || [];

    for (var pi = 0; pi < pendingRuns.length; pi++) {
      (function(pending) {
        var item = document.createElement("div");
        item.className = "run-item";
        item.innerHTML = '<span class="run-badge interrupted">⏳</span>' +
          '<span class="run-name">' + escapeHtml(pending.workflowName) + '</span>' +
          '<span class="run-meta">queued</span>';
        if (pending.runId) {
          var cancelBtn = document.createElement("button");
          cancelBtn.className = "wf-ctrl-btn abort run-cancel-btn";
          cancelBtn.textContent = "✕ Cancel";
          cancelBtn.title = "Cancel this queued run";
          cancelBtn.onclick = async function(e) {
            e.stopPropagation();
            cancelBtn.disabled = true;
            try {
              var r = await apiFetch(API + "/api/workflow/runs/" + encodeURIComponent(pending.runId), { method: "DELETE" });
              if (!r.ok) {
                var d = await r.json();
                cancelBtn.title = d.error || "Error";
                cancelBtn.disabled = false;
              } else {
                item.remove();
                await refreshWorkflows();
              }
            } catch {
              cancelBtn.disabled = false;
            }
          };
          item.appendChild(cancelBtn);
        }
        $workflowList.appendChild(item);
        shown++;
      })(pendingRuns[pi]);
    }

    for (var i = 0; i < activeRuns.length; i++) {
      var run = activeRuns[i];
      var elapsed = Date.now() - new Date(run.startedAt).getTime();
      var item = document.createElement("div");
      item.className = "run-item";
      item.style.cursor = "pointer";
      item.setAttribute("data-run-id", run.runId);
      item.innerHTML = '<span class="run-badge running">▶</span>' +
        '<span class="run-name">' + escapeHtml(run.workflow) + '</span>' +
        '<span class="run-meta">' + fmtDuration(elapsed) + '</span>';
      item.onclick = (function(id) { return function() { showRunDetail(id); }; })(run.runId);
      $workflowList.appendChild(item);
      shown++;
    }

    var activeIds = {};
    for (var j = 0; j < activeRuns.length; j++) activeIds[activeRuns[j].runId] = true;

    for (var k = 0; k < recentRuns.length; k++) {
      var r = recentRuns[k];
      if (r.status === "running" || activeIds[r.id]) continue;
      var badgeClass = r.status === "success" ? "success" : r.status === "failed" ? "failed" : "interrupted";
      var icon = r.status === "success" ? "✓" : r.status === "failed" ? "✗" : "⚡";
      var meta = (r.durationMs ? fmtDuration(r.durationMs) : "") + (r.totalCostUsd != null ? " $" + r.totalCostUsd.toFixed(3) : "");
      var tagBadges = "";
      if (r.tags && r.tags.length > 0) {
        tagBadges = r.tags.map(function(t) { return '<span class="run-tag">' + escapeHtml(t) + '</span>'; }).join("");
      }
      var ri = document.createElement("div");
      ri.className = "run-item";
      ri.style.cursor = "pointer";
      ri.setAttribute("data-run-id", r.id);
      ri.innerHTML = '<span class="run-badge ' + badgeClass + '">' + icon + '</span>' +
        '<span class="run-name">' + escapeHtml(r.workflow) + tagBadges + '</span>' +
        '<span class="run-meta">' + meta.trim() + '</span>';
      ri.onclick = (function(id) { return function() { showRunDetail(id); }; })(r.id);
      if (r.status === "failed" || r.status === "interrupted") {
        (function(runId) {
          var retryBtn = document.createElement("button");
          retryBtn.className = "wf-ctrl-btn retry run-retry-btn";
          retryBtn.textContent = "↺ Retry";
          retryBtn.title = "Retry this run";
          retryBtn.onclick = async function(e) {
            e.stopPropagation();
            retryBtn.disabled = true;
            try {
              var r2 = await apiFetch(API + "/api/workflow/retry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ runId: runId }),
              });
              if (!r2.ok) {
                var d = await r2.json();
                retryBtn.title = d.error || "Error";
              } else {
                retryBtn.title = "Queued!";
              }
              await refreshWorkflows();
            } finally {
              retryBtn.disabled = false;
            }
          };
          ri.appendChild(retryBtn);
        })(r.id);
      }
      $workflowList.appendChild(ri);
      shown++;
    }

    if (shown === 0) {
      $workflowList.innerHTML = '<div class="run-empty">No recent runs</div>';
    }

    if (_canLoadMore) {
      var loadMoreBtn = document.createElement("button");
      loadMoreBtn.id = "wf-load-more";
      loadMoreBtn.className = "wf-load-more-btn";
      loadMoreBtn.textContent = _runsLoading ? "Loading…" : "Load more";
      loadMoreBtn.disabled = _runsLoading;
      loadMoreBtn.onclick = loadMoreRuns;
      $workflowList.appendChild(loadMoreBtn);
    }
  }

  async function loadMoreRuns() {
    if (_runsLoading || !_canLoadMore) return;
    _runsLoading = true;
    var btn = document.getElementById("wf-load-more");
    if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
    try {
      var res = await apiFetch(API + "/api/workflow/runs?limit=50&offset=" + _runsOffset);
      if (!res.ok) return;
      var data = await res.json();
      var newRuns = data.runs || [];
      _runsOffset += 50;
      _canLoadMore = newRuns.length >= 50;
      _allRecentRuns = _allRecentRuns.concat(newRuns);
      applyHistoryFilter();
    } catch {} finally {
      _runsLoading = false;
    }
  }

  async function refreshWorkflows() {
    try {
      var statusRes = await apiFetch(API +"/api/workflow/status");
      var runsRes = await apiFetch(API +"/api/workflow/runs?limit=50");
      if (!statusRes.ok || !runsRes.ok) return;
      var statusData = await statusRes.json();
      var runsData = await runsRes.json();
      _allActiveRuns = statusData.activeRuns || [];
      _allPendingRuns = statusData.pendingRuns || [];
      _allRecentRuns = runsData.runs || [];
      _runsOffset = 50;
      _canLoadMore = _allRecentRuns.length >= 50;
      var wfNames = Object.keys(statusData.workflows || {}).sort();
      renderWorkflowControls(!!statusData.paused, wfNames, _allActiveRuns.length);
      var historyNames = [];
      var seenWf = {};
      var historyTags = [];
      var seenTag = {};
      for (var i = 0; i < _allRecentRuns.length; i++) {
        var name = _allRecentRuns[i].workflow;
        if (name && !seenWf[name]) { seenWf[name] = true; historyNames.push(name); }
        var runTags = _allRecentRuns[i].tags || [];
        for (var t = 0; t < runTags.length; t++) {
          if (!seenTag[runTags[t]]) { seenTag[runTags[t]] = true; historyTags.push(runTags[t]); }
        }
      }
      historyNames.sort();
      historyTags.sort();
      renderHistoryFilter(historyNames, historyTags);
      applyHistoryFilter();
    } catch {}
  }

  var _daemonEventsSource = null;
  var _daemonEventsRetryTimer = null;
  var _sseFallbackIntervals = [];

  function _clearSseFallback() {
    for (var i = 0; i < _sseFallbackIntervals.length; i++) clearInterval(_sseFallbackIntervals[i]);
    _sseFallbackIntervals = [];
  }

  function _startSseFallback() {
    _clearSseFallback();
    _sseFallbackIntervals.push(setInterval(function() { refreshWorkflows(); refreshWfDefinitions(); refreshSchedules(); refreshCost(); }, 30000));
    _sseFallbackIntervals.push(setInterval(refreshApprovals, 30000));
    _sseFallbackIntervals.push(setInterval(refreshTasks, 30000));
    _sseFallbackIntervals.push(setInterval(refreshActiveSessions, 30000));
  }

  function initBrowserNotifications() {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") Notification.requestPermission();
  }

  function _notify(title, body) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    var n = new Notification(title, { body: body });
    n.onclick = function() { window.focus(); n.close(); };
  }

  function connectDaemonEvents() {
    if (_daemonEventsSource) return;
    var eventsUrl = API + "/api/daemon/events" + (authToken ? "?token=" + encodeURIComponent(authToken) : "");
    var src = new EventSource(eventsUrl);
    _daemonEventsSource = src;

    src.onopen = function() {
      _clearSseFallback();
      if ($health.className !== "err") {
        $health.className = "ok";
        $health.title = "Connected";
      }
    };

    function onQueueEvent() { refreshWorkflows(); refreshWfDefinitions(); refreshSchedules(); refreshCost(); }
    src.addEventListener("workflow.started", onQueueEvent);
    src.addEventListener("workflow.completed", onQueueEvent);
    src.addEventListener("workflow.step.completed", onQueueEvent);
    src.addEventListener("queue.changed", onQueueEvent);
    src.addEventListener("approval.changed", function(e) {
      refreshApprovals();
      try {
        var d = JSON.parse(e.data);
        if (d.pendingCount > 0) _notify("Approval required", "A workflow step is waiting for approval.");
      } catch {}
    });
    src.addEventListener("workflow.failure.alert", function(e) {
      try {
        var d = JSON.parse(e.data);
        _notify("Workflow failed", d.workflow + " — " + d.runId);
      } catch {}
    });
    src.addEventListener("task.changed", function() { refreshTasks(); });
    src.addEventListener("session.registered", function() { refreshActiveSessions(); });
    src.addEventListener("session.unregistered", function() { refreshActiveSessions(); });

    src.onerror = function() {
      src.close();
      _daemonEventsSource = null;
      if ($health.className !== "err") {
        $health.className = "warn";
        $health.title = "Reconnecting...";
      }
      _startSseFallback();
      _daemonEventsRetryTimer = setTimeout(connectDaemonEvents, 10000);
    };
  }

  function startWorkflowUpdates() {
    connectDaemonEvents();
  }
`;
