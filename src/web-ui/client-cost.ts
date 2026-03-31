/** Cost summary panel functions for the KOTA web UI. */

export const CLIENT_COST_JS = `
  // --- Cost summary panel ---

  function renderCost(totals) {
    $costList.innerHTML = "";
    var workflows = Object.keys(totals).sort();
    if (workflows.length === 0) {
      $costList.innerHTML = '<div class="run-empty">No runs in last 24h</div>';
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
  }

  async function refreshCost() {
    try {
      var since = Date.now() - 24 * 60 * 60 * 1000;
      var res = await apiFetch(API +"/api/workflow/runs?since=" + since);
      if (!res.ok) return;
      var data = await res.json();
      var totals = {};
      for (var i = 0; i < (data.runs || []).length; i++) {
        var r = data.runs[i];
        if (r.totalCostUsd == null) continue;
        totals[r.workflow] = (totals[r.workflow] || 0) + r.totalCostUsd;
      }
      renderCost(totals);
    } catch {}
  }
`;
