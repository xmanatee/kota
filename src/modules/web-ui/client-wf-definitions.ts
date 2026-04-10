/** All-workflows definitions panel for the KOTA web UI. */

export const CLIENT_WF_DEFINITIONS_JS = `
  // --- Workflow definitions panel ---

  var wfDefinitionsNotice = "";

  function setWfDefinitionsNotice(message) {
    wfDefinitionsNotice = message;
  }

  function fmtTriggerSummary(triggers) {
    if (!triggers || !triggers.length) return "manual";
    return triggers.map(function(t) {
      if (t.type === "cron") return t.schedule;
      if (t.type === "interval") return fmtIntervalMs(t.intervalMs);
      if (t.type === "webhook") return "webhook";
      if (t.type === "watch") return "watch(" + t.patterns.join(", ") + ")";
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
    if (wfDefinitionsNotice) {
      $wfDefinitionsList.innerHTML = '<div class="run-empty">' + escapeHtml(wfDefinitionsNotice) + '</div>';
      return;
    }
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

        var effectiveEnabled = def.runtimeEnabled !== undefined ? def.runtimeEnabled : (def.enabled !== false);

        var nameDiv = document.createElement("div");
        nameDiv.className = "schedule-name";
        nameDiv.innerHTML =
          (wfState.lastStatus
            ? '<span class="run-badge ' + statusClass + '">' + statusIcon + '</span>'
            : '<span class="run-badge pending">\\u00b7</span>') +
          escapeHtml(def.name) +
          (!effectiveEnabled ? ' <span class="run-meta">(disabled)</span>' : "");
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

        if (def.inputSchema && def.inputSchema.properties) {
          var props = def.inputSchema.properties;
          var required = def.inputSchema.required || [];
          var fieldDescs = Object.keys(props).map(function(key) {
            var propSchema = props[key];
            var type = propSchema.type || "any";
            var req = required.indexOf(key) !== -1 ? "*" : "?";
            return key + req + ": " + type;
          });
          if (fieldDescs.length) {
            var inputsDiv = document.createElement("div");
            inputsDiv.className = "schedule-next run-meta";
            inputsDiv.textContent = "Inputs: " + fieldDescs.join(", ");
            item.appendChild(inputsDiv);
          }
        }

        if (def.outputSchema && def.outputSchema.properties) {
          var outProps = def.outputSchema.properties;
          var outFieldDescs = Object.keys(outProps).map(function(key) {
            var propSchema = outProps[key];
            var type = propSchema.type || "any";
            return key + ": " + type;
          });
          if (outFieldDescs.length) {
            var outputsDiv = document.createElement("div");
            outputsDiv.className = "schedule-next run-meta";
            outputsDiv.textContent = "Outputs: " + outFieldDescs.join(", ");
            item.appendChild(outputsDiv);
          }
        }

        if (isTriggerable(def.triggers)) {
          var btn = document.createElement("button");
          btn.className = "wf-ctrl-btn trigger";
          btn.textContent = "\\u25b6 Run";
          btn.title = "Trigger " + def.name;
          btn.onclick = (function(defRef, btnRef, itemRef) {
            return function() {
              var props = defRef.inputSchema && defRef.inputSchema.properties;
              var hasInputs = props && Object.keys(props).length > 0;
              if (!hasInputs) {
                triggerWorkflowByName(defRef.name, btnRef);
                return;
              }
              var required = defRef.inputSchema.required || [];
              var form = document.createElement("div");
              form.className = "wf-input-form";
              var fields = {};
              Object.keys(props).forEach(function(key) {
                var propSchema = props[key];
                var isReq = required.indexOf(key) !== -1;
                var type = propSchema.type || "string";
                var row = document.createElement("div");
                row.className = "wf-input-row";
                var label = document.createElement("label");
                label.className = "wf-input-label";
                label.textContent = key + (isReq ? " *" : "");
                var input;
                if (type === "boolean") {
                  input = document.createElement("input");
                  input.type = "checkbox";
                  input.className = "wf-input-checkbox";
                } else {
                  input = document.createElement("input");
                  input.type = type === "number" ? "number" : "text";
                  input.className = "wf-input-field";
                  if (propSchema.description) input.placeholder = propSchema.description;
                }
                input.setAttribute("data-key", key);
                input.setAttribute("data-required", isReq ? "1" : "0");
                input.setAttribute("data-type", type);
                fields[key] = input;
                row.appendChild(label);
                row.appendChild(input);
                form.appendChild(row);
              });
              var actions = document.createElement("div");
              actions.className = "wf-input-actions";
              var submitBtn = document.createElement("button");
              submitBtn.className = "wf-ctrl-btn trigger";
              submitBtn.textContent = "Submit";
              var cancelBtn = document.createElement("button");
              cancelBtn.className = "wf-ctrl-btn";
              cancelBtn.textContent = "Cancel";
              cancelBtn.onclick = function() {
                form.remove();
                btnRef.style.display = "";
              };
              submitBtn.onclick = function() {
                var payload = {};
                var valid = true;
                Object.keys(fields).forEach(function(key) {
                  var input = fields[key];
                  var type = input.getAttribute("data-type");
                  var isReq = input.getAttribute("data-required") === "1";
                  if (type === "boolean") {
                    payload[key] = input.checked;
                  } else if (type === "number") {
                    if (isReq && input.value === "") {
                      valid = false;
                      input.classList.add("wf-input-error");
                    } else {
                      input.classList.remove("wf-input-error");
                      if (input.value !== "") payload[key] = Number(input.value);
                    }
                  } else {
                    if (isReq && !input.value) {
                      valid = false;
                      input.classList.add("wf-input-error");
                    } else {
                      input.classList.remove("wf-input-error");
                      if (input.value) payload[key] = input.value;
                    }
                  }
                });
                if (!valid) return;
                form.remove();
                btnRef.style.display = "";
                triggerWorkflowByName(defRef.name, btnRef, payload);
              };
              actions.appendChild(submitBtn);
              actions.appendChild(cancelBtn);
              form.appendChild(actions);
              btnRef.style.display = "none";
              itemRef.appendChild(form);
            };
          })(def, btn, item);
          item.appendChild(btn);
        }

        var toggleBtn = document.createElement("button");
        toggleBtn.className = "wf-ctrl-btn";
        toggleBtn.textContent = effectiveEnabled ? "Disable" : "Enable";
        toggleBtn.title = (effectiveEnabled ? "Disable " : "Enable ") + def.name;
        toggleBtn.onclick = (function(defRef, btnRef) {
          return async function() {
            btnRef.disabled = true;
            try {
              var action = effectiveEnabled ? "disable" : "enable";
              var r = await apiFetch(API + "/api/workflow/definitions/" + encodeURIComponent(defRef.name) + "/" + action, {
                method: "POST",
              });
              if (!r.ok) {
                var d = await r.json();
                btnRef.title = d.error || "Error";
                btnRef.disabled = false;
              } else {
                setWfDefinitionsNotice("");
                await refreshWfDefinitions();
              }
            } catch {
              setWfDefinitionsNotice("Failed to update workflow state");
              btnRef.disabled = false;
            }
          };
        })(def, toggleBtn);
        item.appendChild(toggleBtn);

        $wfDefinitionsList.appendChild(item);
      })(sorted[i]);
    }
  }

  function buildTriggerGraph(definitions) {
    var edges = [];
    var nodeSet = {};
    for (var i = 0; i < definitions.length; i++) {
      var def = definitions[i];
      if (!def.triggers) continue;
      for (var j = 0; j < def.triggers.length; j++) {
        var t = def.triggers[j];
        if (t.type !== "event" || t.event !== "workflow.completed") continue;
        var filter = t.filter || {};
        var workflowFilter = filter.workflow;
        var statusFilter = filter.status;
        var sources = Array.isArray(workflowFilter) ? workflowFilter : (workflowFilter ? [workflowFilter] : []);
        var labelParts = [];
        if (statusFilter) {
          var statuses = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
          labelParts.push(statuses.join("/"));
        }
        var edgeLabel = labelParts.join(", ");
        if (sources.length === 0) {
          nodeSet["*"] = true;
          nodeSet[def.name] = true;
          edges.push({ from: "*", to: def.name, label: edgeLabel });
        } else {
          for (var k = 0; k < sources.length; k++) {
            nodeSet[sources[k]] = true;
            nodeSet[def.name] = true;
            edges.push({ from: sources[k], to: def.name, label: edgeLabel });
          }
        }
      }
    }
    return { edges: edges, nodes: Object.keys(nodeSet) };
  }

  function renderTriggerGraph(definitions) {
    var existing = document.getElementById("wf-trigger-graph-section");
    if (existing) existing.remove();

    var graph = buildTriggerGraph(definitions);
    if (graph.edges.length === 0) return;

    var nodes = graph.nodes;
    var edges = graph.edges;

    var inDegree = {};
    var adjOut = {};
    for (var i = 0; i < nodes.length; i++) {
      inDegree[nodes[i]] = 0;
      adjOut[nodes[i]] = [];
    }
    for (var e = 0; e < edges.length; e++) {
      inDegree[edges[e].to] = (inDegree[edges[e].to] || 0) + 1;
      adjOut[edges[e].from] = adjOut[edges[e].from] || [];
      adjOut[edges[e].from].push(edges[e].to);
    }

    var queue = [];
    for (var n = 0; n < nodes.length; n++) {
      if (!inDegree[nodes[n]]) queue.push(nodes[n]);
    }
    var sorted = [];
    var tempIn = {};
    for (var key in inDegree) tempIn[key] = inDegree[key];
    while (queue.length) {
      var cur = queue.shift();
      sorted.push(cur);
      var outs = adjOut[cur] || [];
      for (var oi = 0; oi < outs.length; oi++) {
        tempIn[outs[oi]]--;
        if (tempIn[outs[oi]] === 0) queue.push(outs[oi]);
      }
    }
    var hasCycle = sorted.length < nodes.length;

    var section = document.createElement("div");
    section.id = "wf-trigger-graph-section";
    section.style.cssText = "margin:8px 0 12px;padding:8px;background:var(--bg-panel,var(--bg));border:1px solid var(--border);border-radius:4px;";

    var heading = document.createElement("div");
    heading.style.cssText = "font-size:11px;font-weight:600;color:var(--fg-meta,var(--fg));margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;";
    heading.textContent = "Trigger Graph";
    section.appendChild(heading);

    if (hasCycle) {
      var warn = document.createElement("div");
      warn.style.cssText = "font-size:11px;color:var(--red,#e55);margin-bottom:4px;";
      warn.textContent = "\\u26a0 Cycle detected \\u2014 showing flat edge list";
      section.appendChild(warn);
      for (var ei = 0; ei < edges.length; ei++) {
        var row = document.createElement("div");
        row.style.cssText = "font-size:11px;color:var(--fg);margin:2px 0;font-family:monospace;";
        row.textContent = edges[ei].from + " \\u2192 " + edges[ei].to + (edges[ei].label ? " (" + edges[ei].label + ")" : "");
        section.appendChild(row);
      }
      $wfDefinitionsList.parentNode.insertBefore(section, $wfDefinitionsList);
      return;
    }

    var col = {};
    for (var si = 0; si < sorted.length; si++) col[sorted[si]] = 0;
    for (var fi = 0; fi < edges.length; fi++) {
      if (col[edges[fi].to] <= col[edges[fi].from]) col[edges[fi].to] = col[edges[fi].from] + 1;
    }
    var maxCol = 0;
    for (var cn in col) if (col[cn] > maxCol) maxCol = col[cn];

    var colGroups = {};
    for (var ng = 0; ng < nodes.length; ng++) {
      var c = col[nodes[ng]];
      colGroups[c] = colGroups[c] || [];
      colGroups[c].push(nodes[ng]);
    }

    var NODE_W = 90, NODE_H = 22, COL_GAP = 60, ROW_GAP = 8, PAD = 10;
    var colCount = maxCol + 1;

    var nodePos = {};
    var svgH = 0;
    for (var ci = 0; ci <= maxCol; ci++) {
      var grp = colGroups[ci] || [];
      for (var ri = 0; ri < grp.length; ri++) {
        var nx = PAD + ci * (NODE_W + COL_GAP);
        var ny = PAD + ri * (NODE_H + ROW_GAP);
        nodePos[grp[ri]] = { x: nx, y: ny, cx: nx + NODE_W / 2, cy: ny + NODE_H / 2 };
        var bottom = ny + NODE_H + PAD;
        if (bottom > svgH) svgH = bottom;
      }
    }
    var svgW = PAD + colCount * NODE_W + (colCount - 1) * COL_GAP + PAD;

    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", svgW);
    svg.setAttribute("height", svgH);
    svg.style.cssText = "display:block;overflow:visible;max-width:100%;";

    var defs = document.createElementNS(svgNS, "defs");
    var marker = document.createElementNS(svgNS, "marker");
    marker.setAttribute("id", "wf-graph-arrow");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "4");
    marker.setAttribute("refX", "6");
    marker.setAttribute("refY", "2");
    marker.setAttribute("orient", "auto");
    var poly = document.createElementNS(svgNS, "polygon");
    poly.setAttribute("points", "0 0, 6 2, 0 4");
    poly.setAttribute("fill", "var(--fg-meta,#888)");
    marker.appendChild(poly);
    defs.appendChild(marker);
    svg.appendChild(defs);

    for (var dei = 0; dei < edges.length; dei++) {
      var edge = edges[dei];
      var fp = nodePos[edge.from];
      var tp = nodePos[edge.to];
      if (!fp || !tp) continue;

      var x1 = fp.x + NODE_W, y1 = fp.cy;
      var x2 = tp.x, y2 = tp.cy;
      var mx = (x1 + x2) / 2;

      var path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--fg-meta,#888)");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("marker-end", "url(#wf-graph-arrow)");
      svg.appendChild(path);

      if (edge.label) {
        var lt = document.createElementNS(svgNS, "text");
        lt.setAttribute("x", mx);
        lt.setAttribute("y", (y1 + y2) / 2 - 3);
        lt.setAttribute("text-anchor", "middle");
        lt.setAttribute("font-size", "9");
        lt.setAttribute("fill", "var(--fg-meta,#888)");
        lt.textContent = edge.label;
        svg.appendChild(lt);
      }
    }

    var knownNames = {};
    for (var di = 0; di < definitions.length; di++) knownNames[definitions[di].name] = true;

    for (var nni = 0; nni < nodes.length; nni++) {
      var nodeName = nodes[nni];
      var pos = nodePos[nodeName];
      if (!pos) continue;

      var isKnown = !!knownNames[nodeName];
      var rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", pos.x);
      rect.setAttribute("y", pos.y);
      rect.setAttribute("width", NODE_W);
      rect.setAttribute("height", NODE_H);
      rect.setAttribute("rx", "3");
      rect.setAttribute("fill", isKnown ? "var(--bg-alt,var(--bg))" : "var(--bg)");
      rect.setAttribute("stroke", isKnown ? "var(--border-active,var(--border))" : "var(--border)");
      rect.setAttribute("stroke-width", "1");
      if (isKnown) {
        rect.style.cursor = "pointer";
        (function(name) {
          rect.addEventListener("click", function() {
            var items = $wfDefinitionsList.querySelectorAll(".schedule-item");
            for (var ii = 0; ii < items.length; ii++) {
              var nameEl = items[ii].querySelector(".schedule-name");
              if (nameEl && nameEl.textContent && nameEl.textContent.trim().startsWith(name)) {
                items[ii].scrollIntoView({ behavior: "smooth", block: "nearest" });
                items[ii].style.outline = "1px solid var(--border-active,#888)";
                setTimeout(function() { items[ii].style.outline = ""; }, 1200);
                break;
              }
            }
          });
        })(nodeName);
      }
      svg.appendChild(rect);

      var label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", pos.cx);
      label.setAttribute("y", pos.cy + 4);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "10");
      label.setAttribute("fill", "var(--fg)");
      label.setAttribute("pointer-events", "none");
      label.textContent = nodeName.length > 12 ? nodeName.slice(0, 11) + "\\u2026" : nodeName;
      if (isKnown) label.setAttribute("font-weight", "500");
      svg.appendChild(label);
    }

    section.appendChild(svg);
    $wfDefinitionsList.parentNode.insertBefore(section, $wfDefinitionsList);
  }

  async function refreshWfDefinitions() {
    try {
      var statusRes = await apiFetch(API + "/api/workflow/status");
      var defsRes = await apiFetch(API + "/api/workflow/definitions");
      if (!statusRes.ok || !defsRes.ok) {
        setWfDefinitionsNotice("Failed to load workflow definitions");
        renderWfDefinitions([], {});
        return;
      }
      var statusData = await statusRes.json();
      var defsData = await defsRes.json();
      setWfDefinitionsNotice("");
      var defs = defsData.definitions || [];
      renderTriggerGraph(defs);
      renderWfDefinitions(defs, statusData.workflows || {});
    } catch {
      setWfDefinitionsNotice("Failed to load workflow definitions");
      renderWfDefinitions([], {});
    }
  }
`;
