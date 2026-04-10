/** Cost analytics panel functions for the KOTA web UI. */

export const CLIENT_COST_JS = `
  // --- Cost analytics panel ---

  var costWindowMs = 24 * 60 * 60 * 1000;
  var costNotice = "";

  function setCostNotice(message) {
    costNotice = message;
  }

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

  function renderCostChart(runs, windowMs) {
    var now = Date.now();
    var count, msPerBucket, labelFn;
    if (windowMs <= 24 * 60 * 60 * 1000) {
      count = 24;
      msPerBucket = 60 * 60 * 1000;
      labelFn = function(i) {
        var d = new Date(now - (count - 1 - i) * msPerBucket);
        return d.getHours() + ":00";
      };
    } else {
      count = windowMs === 7 * 24 * 60 * 60 * 1000 ? 7 : 30;
      msPerBucket = 24 * 60 * 60 * 1000;
      labelFn = function(i) {
        var d = new Date(now - (count - 1 - i) * msPerBucket);
        return (d.getMonth() + 1) + "/" + d.getDate();
      };
    }
    var buckets = [];
    for (var b = 0; b < count; b++) buckets.push(0);
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      if (!r.totalCostUsd || !r.startedAt) continue;
      var idx = count - 1 - Math.floor((now - new Date(r.startedAt).getTime()) / msPerBucket);
      if (idx >= 0 && idx < count) buckets[idx] += r.totalCostUsd;
    }
    var max = 0;
    for (var k = 0; k < buckets.length; k++) if (buckets[k] > max) max = buckets[k];
    if (max === 0) return null;

    var svgH = 50;
    var gap = 1;
    var barW = Math.max(2, Math.floor((280 - gap * (count - 1)) / count));
    var svgW = count * barW + gap * (count - 1);
    var rects = "";
    for (var j = 0; j < count; j++) {
      var bh = Math.round((buckets[j] / max) * svgH);
      var bx = j * (barW + gap);
      var by = svgH - Math.max(bh, buckets[j] > 0 ? 1 : 0);
      var fill = buckets[j] > 0 ? "#6c63ffaa" : "#ffffff11";
      var lbl = labelFn(j) + ": $" + buckets[j].toFixed(4);
      rects += "<rect x=\\"" + bx + "\\" y=\\"" + by + "\\" width=\\"" + barW + "\\" height=\\"" + Math.max(bh, buckets[j] > 0 ? 1 : 0) + "\\" fill=\\"" + fill + "\\"><title>" + lbl + "</title></rect>";
    }
    var svg = "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 " + svgW + " " + svgH + "\\" preserveAspectRatio=\\"none\\" style=\\"width:100%;height:50px;display:block;\\">" + rects + "</svg>";
    var wrap = document.createElement("div");
    wrap.className = "cost-chart";
    wrap.innerHTML = svg;
    return wrap;
  }

  function renderCost(totals, topRuns, runs) {
    $costList.innerHTML = "";
    $costList.appendChild(renderCostWindowButtons());

    if (costNotice) {
      var notice = document.createElement("div");
      notice.className = "run-empty";
      notice.textContent = costNotice;
      $costList.appendChild(notice);
    }

    var chart = renderCostChart(runs || [], costWindowMs);
    if (chart) $costList.appendChild(chart);

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
      if (!res.ok) {
        setCostNotice("Failed to load cost data");
        renderCost({}, [], []);
        return;
      }
      var data = await res.json();
      setCostNotice("");
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
      renderCost(totals, topRuns, costedRuns);
    } catch {
      setCostNotice("Failed to load cost data");
      renderCost({}, [], []);
    }
  }
`;
