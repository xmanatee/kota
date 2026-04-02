/** System status overview panel for the KOTA web UI. */

export const CLIENT_STATUS_OVERVIEW_JS = `
  // --- Status overview panel ---

  function _overviewFmtUptime(startedAt) {
    if (!startedAt) return "—";
    var ms = Date.now() - new Date(startedAt).getTime();
    if (ms < 0) return "just now";
    var totalS = Math.floor(ms / 1000);
    var totalM = Math.floor(totalS / 60);
    var totalH = Math.floor(totalM / 60);
    var days = Math.floor(totalH / 24);
    if (days > 0) return days + "d " + (totalH % 24) + "h";
    if (totalH > 0) return totalH + "h " + (totalM % 60) + "m";
    if (totalM > 0) return totalM + "m " + (totalS % 60) + "s";
    return totalS + "s";
  }

  function renderOverview(daemon) {
    if (!$overviewList) return;
    $overviewList.innerHTML = "";

    var frag = document.createDocumentFragment();

    // Daemon uptime row
    var uptimeRow = document.createElement("div");
    uptimeRow.className = "overview-row";
    var uptimeLabel = document.createElement("span");
    uptimeLabel.className = "overview-label";
    uptimeLabel.textContent = "Daemon";
    var uptimeVal = document.createElement("span");
    if (daemon && daemon.running !== false) {
      uptimeVal.textContent = "up " + _overviewFmtUptime(daemon.startedAt);
      uptimeVal.className = "overview-value overview-ok";
      if (daemon.startedAt) uptimeRow.title = "Started " + new Date(daemon.startedAt).toLocaleString();
    } else {
      uptimeVal.textContent = "offline";
      uptimeVal.className = "overview-value overview-warn";
    }
    uptimeRow.appendChild(uptimeLabel);
    uptimeRow.appendChild(uptimeVal);
    frag.appendChild(uptimeRow);

    // Dispatch window row
    var dispatchRow = document.createElement("div");
    dispatchRow.className = "overview-row";
    var dispatchLabel = document.createElement("span");
    dispatchLabel.className = "overview-label";
    dispatchLabel.textContent = "Dispatch";
    var dispatchVal = document.createElement("span");
    var wfStatus = daemon && daemon.workflow;
    if (!daemon) {
      dispatchVal.textContent = "—";
      dispatchVal.className = "overview-value";
    } else if (wfStatus && wfStatus.paused) {
      dispatchVal.textContent = "paused";
      dispatchVal.className = "overview-value overview-warn";
    } else if (wfStatus && wfStatus.dispatchWindowBlocked) {
      dispatchVal.textContent = "window blocked";
      dispatchVal.className = "overview-value overview-warn";
      if (wfStatus.dispatchWindowOpensAt) {
        var d0 = new Date(wfStatus.dispatchWindowOpensAt);
        var dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        var hh = String(d0.getHours()).padStart(2,"0");
        var mmStr = String(d0.getMinutes()).padStart(2,"0");
        dispatchRow.title = "Opens " + dayNames[d0.getDay()] + " " + hh + ":" + mmStr;
      }
    } else {
      dispatchVal.textContent = "open";
      dispatchVal.className = "overview-value overview-ok";
    }
    dispatchRow.appendChild(dispatchLabel);
    dispatchRow.appendChild(dispatchVal);
    frag.appendChild(dispatchRow);

    // 24h spend row (computed from _allRecentRuns)
    var oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    var dailySpend = 0;
    var recentRuns24h = (_allRecentRuns || []).filter(function(r) {
      return r.startedAt && new Date(r.startedAt).getTime() >= oneDayAgo;
    });
    for (var ci = 0; ci < recentRuns24h.length; ci++) {
      if (recentRuns24h[ci].totalCostUsd != null) dailySpend += recentRuns24h[ci].totalCostUsd;
    }
    var spendRow = document.createElement("div");
    spendRow.className = "overview-row";
    var spendLabel = document.createElement("span");
    spendLabel.className = "overview-label";
    spendLabel.textContent = "24h spend";
    var spendVal = document.createElement("span");
    spendVal.className = "overview-value";
    spendVal.textContent = "$" + dailySpend.toFixed(3);
    spendRow.appendChild(spendLabel);
    spendRow.appendChild(spendVal);
    frag.appendChild(spendRow);

    // Recent run health (last 1h) from _allRecentRuns + _allActiveRuns
    var oneHourAgo = Date.now() - 60 * 60 * 1000;
    var recentRuns1h = (_allRecentRuns || []).filter(function(r) {
      return r.startedAt && new Date(r.startedAt).getTime() >= oneHourAgo;
    });
    var successCnt = 0, failedCnt = 0, warnCnt = 0;
    for (var ri = 0; ri < recentRuns1h.length; ri++) {
      var st = recentRuns1h[ri].status;
      if (st === "success") successCnt++;
      else if (st === "failed" || st === "interrupted") failedCnt++;
      else if (st === "completed-with-warnings") warnCnt++;
    }
    var activeCnt = (_allActiveRuns || []).length;
    var healthRow = document.createElement("div");
    healthRow.className = "overview-row";
    var healthLabel = document.createElement("span");
    healthLabel.className = "overview-label";
    healthLabel.textContent = "Runs (1h)";
    var healthVal = document.createElement("span");
    healthVal.className = "overview-value";
    var runParts = [];
    if (activeCnt > 0) runParts.push('<span class="overview-running">\\u25b6 ' + activeCnt + '</span>');
    if (successCnt > 0) runParts.push('<span class="overview-ok">\\u2713 ' + successCnt + '</span>');
    if (warnCnt > 0) runParts.push('<span class="overview-warn">\\u26a0 ' + warnCnt + '</span>');
    if (failedCnt > 0) runParts.push('<span class="overview-err">\\u2717 ' + failedCnt + '</span>');
    if (!runParts.length) runParts.push("—");
    healthVal.innerHTML = runParts.join(" ");
    healthRow.appendChild(healthLabel);
    healthRow.appendChild(healthVal);
    frag.appendChild(healthRow);

    // Extension health from _cachedExtensions
    var extOk = 0, extDegraded = 0;
    var exts = _cachedExtensions || [];
    for (var ei = 0; ei < exts.length; ei++) {
      var eh = exts[ei].health;
      if (!eh || eh.status === "ok") extOk++;
      else extDegraded++;
    }
    var extRow = document.createElement("div");
    extRow.className = "overview-row";
    var extLabel = document.createElement("span");
    extLabel.className = "overview-label";
    extLabel.textContent = "Extensions";
    var extVal = document.createElement("span");
    if (exts.length === 0) {
      extVal.className = "overview-value";
      extVal.textContent = "—";
    } else if (extDegraded > 0) {
      extVal.className = "overview-value overview-warn";
      extVal.textContent = extOk + " ok, " + extDegraded + " degraded";
    } else {
      extVal.className = "overview-value overview-ok";
      extVal.textContent = extOk + " ok";
    }
    extRow.appendChild(extLabel);
    extRow.appendChild(extVal);
    frag.appendChild(extRow);

    $overviewList.appendChild(frag);
  }

  async function refreshOverview() {
    try {
      var res = await apiFetch(API + "/api/daemon/status");
      if (!res.ok) { renderOverview(null); return; }
      var data = await res.json();
      renderOverview(data.daemon || null);
    } catch {
      renderOverview(null);
    }
  }
`;
