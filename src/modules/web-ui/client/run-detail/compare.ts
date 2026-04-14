/** Run detail comparison: side-by-side diff table for two workflow runs. */

export const CLIENT_RUN_DETAIL_COMPARE_JS = `
  var _compareRunId = null;

  function renderCompareSection(primaryRun) {
    var existing = document.getElementById("run-compare-section");
    if (existing) existing.remove();

    var section = document.createElement("div");
    section.id = "run-compare-section";
    section.className = "run-compare-section";

    var header = document.createElement("div");
    header.className = "run-compare-header";
    header.textContent = "Compare with another run";
    section.appendChild(header);

    var row = document.createElement("div");
    row.className = "run-compare-row";

    var sel = document.createElement("select");
    sel.className = "run-compare-select";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select run to compare\u2026";
    sel.appendChild(placeholder);

    var runs = (_allRecentRuns || []).filter(function(r) { return r.id !== primaryRun.id; });
    runs.forEach(function(r) {
      var opt = document.createElement("option");
      opt.value = r.id;
      var meta = r.workflow + " \u2014 " + new Date(r.startedAt).toLocaleString() + (r.durationMs ? " (" + fmtDuration(r.durationMs) + ")" : "");
      opt.textContent = meta;
      if (r.id === _compareRunId) opt.selected = true;
      sel.appendChild(opt);
    });
    row.appendChild(sel);

    var btn = document.createElement("button");
    btn.className = "run-compare-btn";
    btn.textContent = "Compare";
    btn.disabled = !_compareRunId;
    row.appendChild(btn);

    sel.onchange = function() {
      _compareRunId = sel.value || null;
      btn.disabled = !_compareRunId;
    };

    btn.onclick = async function() {
      if (!_compareRunId) return;
      btn.disabled = true;
      btn.textContent = "Loading\u2026";
      try {
        var res = await apiFetch(API + "/api/workflow/runs/" + encodeURIComponent(_compareRunId));
        if (!res.ok) throw new Error("Run not found");
        var compareRun = await res.json();
        renderDiffTable(primaryRun, compareRun, section);
      } catch (err) {
        var errDiv = document.getElementById("run-compare-diff");
        if (!errDiv) { errDiv = document.createElement("div"); errDiv.id = "run-compare-diff"; section.appendChild(errDiv); }
        errDiv.textContent = "Error loading run: " + escapeHtml(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "Compare";
      }
    };

    section.appendChild(row);
    $runDetail.appendChild(section);

    if (_compareRunId) btn.click();
  }

  function fmtDiffDelta(a, b, fmt) {
    if (a == null || b == null) return "N/A";
    var delta = b - a;
    if (delta === 0) return "=";
    return (delta > 0 ? "+" : "") + fmt(delta);
  }

  function renderDiffTable(a, b, container) {
    var existing = document.getElementById("run-compare-diff");
    if (existing) existing.remove();

    var stepsA = {};
    (a.steps || []).forEach(function(s) { stepsA[s.id] = s; });
    var stepsB = {};
    (b.steps || []).forEach(function(s) { stepsB[s.id] = s; });

    var allIds = [];
    var seen = {};
    (a.steps || []).forEach(function(s) { if (!seen[s.id]) { seen[s.id] = true; allIds.push(s.id); } });
    (b.steps || []).forEach(function(s) { if (!seen[s.id]) { seen[s.id] = true; allIds.push(s.id); } });

    var hasCost = allIds.some(function(id) {
      var sa = stepsA[id]; var sb = stepsB[id];
      function getCost(s) { return s && s.output && typeof s.output.totalCostUsd === "number" ? s.output.totalCostUsd : null; }
      return getCost(sa) !== null || getCost(sb) !== null;
    });

    var wrap = document.createElement("div");
    wrap.id = "run-compare-diff";
    wrap.className = "run-diff-wrap";

    var subtitle = document.createElement("div");
    subtitle.className = "run-diff-subtitle";
    subtitle.innerHTML = '<code>' + escapeHtml(a.id) + '</code> vs <code>' + escapeHtml(b.id) + '</code>';
    wrap.appendChild(subtitle);

    var table = document.createElement("table");
    table.className = "run-diff-table";

    var thead = document.createElement("thead");
    var headerRow = document.createElement("tr");
    var cols = ["Step", "Status", "A Dur", "B Dur", "\\u0394 Dur"];
    if (hasCost) cols = cols.concat(["A Cost", "B Cost", "\\u0394 Cost"]);
    cols.forEach(function(c) {
      var th = document.createElement("th");
      th.textContent = c;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    allIds.forEach(function(id) {
      var sa = stepsA[id] || null;
      var sb = stepsB[id] || null;

      function getCost(s) { return s && s.output && typeof s.output.totalCostUsd === "number" ? s.output.totalCostUsd : null; }
      function fmtStatus(s) { return s === null ? "N/A" : (s === "success" ? "\\u2713" : s === "failed" ? "\\u2717" : s === "skipped" ? "\\u2014" : "\\u26a1"); }

      var statusA = sa ? sa.status : null;
      var statusB = sb ? sb.status : null;
      var durA = sa ? sa.durationMs : null;
      var durB = sb ? sb.durationMs : null;
      var costA = getCost(sa);
      var costB = getCost(sb);

      var regressed = statusA === "success" && statusB === "failed";
      var improved = statusA === "failed" && statusB === "success";

      var tr = document.createElement("tr");
      if (regressed) tr.className = "diff-regressed";
      else if (improved) tr.className = "diff-improved";

      function td(text, cls) {
        var cell = document.createElement("td");
        cell.textContent = text;
        if (cls) cell.className = cls;
        return cell;
      }

      tr.appendChild(td(id));
      tr.appendChild(td(fmtStatus(statusA) + "\\u2192" + fmtStatus(statusB)));
      tr.appendChild(td(durA !== null ? fmtDuration(durA) : "N/A"));
      tr.appendChild(td(durB !== null ? fmtDuration(durB) : "N/A"));
      var durDelta = fmtDiffDelta(durA, durB, fmtDuration);
      var durDeltaClass = durDelta.startsWith("+") ? "diff-worse" : durDelta.startsWith("-") ? "diff-better" : "";
      tr.appendChild(td(durDelta, durDeltaClass));

      if (hasCost) {
        tr.appendChild(td(costA !== null ? "$" + costA.toFixed(3) : "\\u2014"));
        tr.appendChild(td(costB !== null ? "$" + costB.toFixed(3) : "\\u2014"));
        var costDelta = fmtDiffDelta(costA, costB, function(n) { return "$" + Math.abs(n).toFixed(3); });
        var costDeltaClass = costDelta.startsWith("+") ? "diff-worse" : costDelta.startsWith("-") ? "diff-better" : "";
        tr.appendChild(td(costDelta, costDeltaClass));
      }

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }
`;
