/** Cost analytics panel functions for the KOTA web UI. */

export const CLIENT_COST_JS = `
  // --- Cost analytics panel ---

  var costWindowMs = 24 * 60 * 60 * 1000;

  function renderCostWindowButtons() {
    var container = document.createElement("div");
    container.className = "cost-window-btns";
    var windows = [
      [24 * 60 * 60 * 1000, "24h"],
      [7 * 24 * 60 * 60 * 1000, "7d"],
      [30 * 24 * 60 * 60 * 1000, "30d"],
    ];
    for (var i = 0; i < windows.length; i++) {
      (function(ms, label) {
        var btn = document.createElement("button");
        btn.className = "cost-window-btn" + (costWindowMs === ms ? " active" : "");
        btn.textContent = label;
        btn.setAttribute("data-window", String(ms));
        btn.onclick = function() {
          costWindowMs = ms;
          refreshCost();
        };
        container.appendChild(btn);
      })(windows[i][0], windows[i][1]);
    }
    return container;
  }

  function renderCost(totals, topRuns) {
    $costList.innerHTML = "";
    $costList.appendChild(renderCostWindowButtons());

    var workflows = Object.keys(totals).sort();
    if (workflows.length === 0) {
      var empty = document.createElement("div");
      empty.className = "run-empty";
      empty.textContent = "No runs in window";
      $costList.appendChild(empty);
      return;
    }

    var grand = 0;
    for (var i = 0; i < workflows.length; i++) {
      var wf = workflows[i];
      var amt = totals[wf];
      grand += amt;
      var row = document.createElement("div");
      row.className = "cost-row";
      row.innerHTML = '<span class="cost-workflow">' + escapeHtml(wf) + '</span>' +
        '<span class="cost-amount">$' + amt.toFixed(3) + '</span>';
      $costList.appendChild(row);
    }

    var total = document.createElement("div");
    total.className = "cost-row cost-total";
    total.innerHTML = '<span class="cost-workflow">total</span>' +
      '<span class="cost-amount">$' + grand.toFixed(3) + '</span>';
    $costList.appendChild(total);

    if (topRuns && topRuns.length > 0) {
      var header = document.createElement("div");
      header.className = "cost-top-header";
      header.textContent = "Top runs";
      $costList.appendChild(header);
      for (var j = 0; j < topRuns.length; j++) {
        var r = topRuns[j];
        var runRow = document.createElement("div");
        runRow.className = "cost-top-run";
        runRow.style.cursor = "pointer";
        runRow.innerHTML = '<span class="cost-workflow">' + escapeHtml(r.workflow) + '</span>' +
          '<span class="cost-amount">$' + r.totalCostUsd.toFixed(3) + '</span>';
        runRow.onclick = (function(id) { return function() { showRunDetail(id); }; })(r.id);
        $costList.appendChild(runRow);
      }
    }
  }

  async function refreshCost() {
    try {
      var since = Date.now() - costWindowMs;
      var res = await apiFetch(API + "/api/workflow/runs?since=" + since);
      if (!res.ok) return;
      var data = await res.json();
      var totals = {};
      var costedRuns = (data.runs || []).filter(function(r) { return r.totalCostUsd != null; });
      for (var i = 0; i < costedRuns.length; i++) {
        var r = costedRuns[i];
        totals[r.workflow] = (totals[r.workflow] || 0) + r.totalCostUsd;
      }
      var topRuns = costedRuns
        .slice()
        .sort(function(a, b) { return b.totalCostUsd - a.totalCostUsd; })
        .slice(0, 5);
      renderCost(totals, topRuns);
    } catch {}
  }
`;
