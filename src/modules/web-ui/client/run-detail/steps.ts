/** Run detail step list rendering: step row HTML, foreach/branch detail, thinking toggles, log search. */

export const CLIENT_RUN_DETAIL_STEPS_JS = `
  function toggleThinking(stepId) {
    var body = document.getElementById("step-thinking-body-" + stepId);
    var btn = body && body.previousElementSibling;
    if (!body) return;
    var open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    if (btn) btn.textContent = (open ? "\\u25b6" : "\\u25bc") + btn.textContent.slice(1);
  }

  function toggleForeachDetail(stepId) {
    var body = document.getElementById("foreach-body-" + stepId);
    var btn = document.getElementById("foreach-toggle-" + stepId);
    if (!body) return;
    var open = body.style.display !== "none";
    body.style.display = open ? "none" : "";
    if (btn) btn.textContent = (open ? "\\u25b6" : "\\u25bc") + btn.textContent.slice(1);
  }

  function renderStepRowsHtml(run, thinkingData) {
    var html = "";
    var completedMap = {};
    var allSteps = run.steps || [];
    for (var ci = 0; ci < allSteps.length; ci++) {
      completedMap[allSteps[ci].id] = allSteps[ci].status;
    }
    var approvalReasonMap = {};
    var allWorkflowSteps = run.workflowSteps || [];
    for (var ari = 0; ari < allWorkflowSteps.length; ari++) {
      var aws = allWorkflowSteps[ari];
      if (aws.type === "approval" && aws.reason) approvalReasonMap[aws.id] = aws.reason;
    }
    if (run.workflowSteps && run.workflowSteps.length > 0) {
      html += '<div class="step-progress" id="step-progress">';
      for (var wi = 0; wi < run.workflowSteps.length; wi++) {
        var ws = run.workflowSteps[wi];
        var wstatus = completedMap[ws.id] || "pending";
        var wbadge = wstatus === "success" ? "success" : wstatus === "failed" ? "failed" : wstatus === "skipped" ? "interrupted" : "pending";
        var wicon = wstatus === "success" ? "\\u2713" : wstatus === "failed" ? "\\u2717" : wstatus === "skipped" ? "\\u2014" : "\\u25cb";
        html += '<div class="step-progress-item" id="sp-' + escapeHtml(ws.id) + '">';
        html += '<span class="run-badge ' + wbadge + '" id="sp-badge-' + escapeHtml(ws.id) + '">' + wicon + '</span>';
        html += '<span class="step-progress-name">' + escapeHtml(ws.id) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '<div class="log-search-bar"><input type="text" id="log-search-input" class="log-search-input" placeholder="Search logs\\u2026" autocomplete="off" /></div>';
    html += '<div class="run-detail-steps" id="run-detail-steps">';
    var steps = run.steps || [];
    if (steps.length === 0 && run.status !== "running") {
      html += '<div class="run-empty">No steps recorded</div>';
    } else {
      for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var isApprovalWaiting = step.type === "approval" && step.status === "running";
        var sb = step.status === "success" ? "success" : step.status === "failed" ? "failed" : step.status === "running" ? "running" : "interrupted";
        var si = step.status === "success" ? "\\u2713" : step.status === "failed" ? "\\u2717" : step.status === "running" ? (isApprovalWaiting ? "\\u23f3" : "\\u25b6") : "\\u26a1";
        var sm = step.durationMs ? fmtDuration(step.durationMs) : "";
        var stepCostVal = step.costUsd != null ? step.costUsd : (step.output && typeof step.output === "object" && step.output.totalCostUsd != null ? step.output.totalCostUsd : null);
        var stepCost = (stepCostVal != null && stepCostVal > 0) ? ("$" + stepCostVal.toFixed(2)) : "";
        if (stepCost) sm += (sm ? " \\u00b7 " : "") + stepCost;
        var rawOutput = "";
        if (step.output != null) {
          rawOutput = typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2);
        } else if (step.error) {
          rawOutput = "Error: " + step.error;
        }
        var truncated = rawOutput.length > 300;
        var outputText = truncated ? rawOutput.slice(0, 300) : rawOutput;

        // Build compound step detail for foreach / branch types
        var compoundHtml = "";
        if (step.type === "foreach" && step.output && Array.isArray(step.output.results)) {
          var fIters = step.output.results;
          var fFailed = 0;
          for (var fi = 0; fi < fIters.length; fi++) { if (fIters[fi].status === "failed") fFailed++; }
          var fAutoOpen = fFailed > 0;
          var fBodyId = "foreach-body-" + escapeHtml(step.id);
          var fToggleId = "foreach-toggle-" + escapeHtml(step.id);
          var fLabel = fIters.length === 1 ? "1 iteration" : fIters.length + " iterations";
          if (fFailed > 0) fLabel += " \\u00b7 " + fFailed + " failed";
          compoundHtml += '<div class="step-foreach-detail">';
          compoundHtml += '<button class="step-foreach-toggle" id="' + fToggleId + '" onclick="toggleForeachDetail(' + JSON.stringify(escapeHtml(step.id)) + ')">';
          compoundHtml += (fAutoOpen ? "\\u25bc" : "\\u25b6") + " " + fLabel;
          compoundHtml += '</button>';
          compoundHtml += '<div class="step-foreach-body" id="' + fBodyId + '"' + (fAutoOpen ? "" : ' style="display:none"') + '>';
          for (var fi2 = 0; fi2 < fIters.length; fi2++) {
            var fIter = fIters[fi2];
            var fIterBadge = fIter.status === "failed" ? "failed" : "success";
            var fIterIcon = fIter.status === "failed" ? "\\u2717" : "\\u2713";
            compoundHtml += '<div class="foreach-item">';
            compoundHtml += '<span class="run-badge ' + fIterBadge + '">' + fIterIcon + '</span>';
            compoundHtml += '<span class="foreach-item-label">iter ' + fIter.index + '</span>';
            var fStepIds = Object.keys(fIter.steps || {});
            if (fStepIds.length > 0) {
              compoundHtml += '<span class="foreach-item-steps">';
              for (var fsi = 0; fsi < fStepIds.length; fsi++) {
                var fSub = fIter.steps[fStepIds[fsi]];
                var fSubBadge = fSub.status === "failed" ? "failed" : fSub.status === "skipped" ? "interrupted" : "success";
                var fSubIcon = fSub.status === "failed" ? "\\u2717" : fSub.status === "skipped" ? "\\u2014" : "\\u2713";
                compoundHtml += '<span class="foreach-substep">';
                compoundHtml += '<span class="run-badge ' + fSubBadge + '">' + fSubIcon + '</span>';
                compoundHtml += '<code>' + escapeHtml(fStepIds[fsi]) + '</code>';
                if (fSub.durationMs) compoundHtml += '<span class="foreach-substep-dur">' + escapeHtml(fmtDuration(fSub.durationMs)) + '</span>';
                compoundHtml += '</span>';
              }
              compoundHtml += '</span>';
            }
            compoundHtml += '</div>';
          }
          compoundHtml += '</div></div>';
        } else if (step.type === "branch" && step.output && step.output.arm) {
          var bArm = step.output.arm === "ifTrue" ? "ifTrue" : "ifFalse";
          var bCount = step.output.steps != null ? step.output.steps + " step" + (step.output.steps !== 1 ? "s" : "") : null;
          compoundHtml += '<div class="step-branch-detail">';
          compoundHtml += '<span class="branch-arm-label">' + escapeHtml(bArm) + '</span>';
          if (bCount) compoundHtml += '<span class="branch-step-count">' + escapeHtml(bCount) + '</span>';
          compoundHtml += '</div>';
        } else if (isApprovalWaiting) {
          var approvalReason = approvalReasonMap[step.id] || "";
          compoundHtml += '<div class="step-approval-waiting">';
          compoundHtml += '\\u23f3 Waiting for approval';
          if (approvalReason) compoundHtml += '<span class="step-approval-reason">' + escapeHtml(approvalReason) + '</span>';
          compoundHtml += '<a href="#" class="step-approval-link" onclick="scrollToApprovals();return false;">\\u2192 Approvals</a>';
          compoundHtml += '</div>';
        }

        var toolCallsLabel = "";
        if (step.toolCalls && step.toolCalls.length > 0) {
          toolCallsLabel = step.toolCalls.map(function(tc) { return escapeHtml(tc.tool) + "\\u00d7" + tc.count; }).join(", ");
        }
        html += '<div class="step-row" id="step-row-' + escapeHtml(step.id) + '">';
        html += '<div class="step-row-header">';
        html += '<span class="run-badge ' + sb + '" id="step-badge-' + escapeHtml(step.id) + '">' + si + '</span>';
        html += '<span class="step-row-name">' + escapeHtml(step.id) + '</span>';
        html += '<span class="step-row-meta" id="step-meta-' + escapeHtml(step.id) + '">' + escapeHtml(sm) + '</span>';
        if ((run.status === "failed" || run.status === "interrupted") && step.status === "success") {
          html += '<button class="step-resume-btn" onclick="resumeFromStep(' + JSON.stringify(run.id) + ',' + JSON.stringify(step.id) + ',' + JSON.stringify(run.workflow) + ',this)">Resume from here</button>';
        }
        html += '</div>';
        if (toolCallsLabel) {
          html += '<div class="step-tool-calls">Tools: ' + toolCallsLabel + '</div>';
        }
        var stepThinking = thinkingData && thinkingData[step.id] ? thinkingData[step.id] : null;
        if (stepThinking && stepThinking.length > 0) {
          var thinkingId = "step-thinking-" + escapeHtml(step.id);
          var thinkingBodyId = "step-thinking-body-" + escapeHtml(step.id);
          var thinkingText = stepThinking.join("\\n\\n---\\n\\n");
          html += '<div class="step-thinking" id="' + thinkingId + '">';
          html += '<button class="step-thinking-toggle" onclick="toggleThinking(' + JSON.stringify(escapeHtml(step.id)) + ')">\\u25b6 Thinking (' + stepThinking.length + ')</button>';
          html += '<pre class="step-thinking-body" id="' + thinkingBodyId + '" style="display:none">' + escapeHtml(thinkingText) + '</pre>';
          html += '</div>';
        }
        if (compoundHtml) {
          html += compoundHtml;
        } else if (rawOutput) {
          html += '<div class="step-row-output" id="step-output-' + escapeHtml(step.id) + '" data-full="' + escapeHtml(rawOutput) + '" data-truncated="' + (truncated ? '1' : '0') + '">' + escapeHtml(outputText) + (truncated ? '\\u2026' : '') + '</div>';
          if (truncated) {
            html += '<button class="step-show-more" data-step="' + escapeHtml(step.id) + '">Show more</button>';
          }
        }
        html += '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  function applyLogSearch(query) {
    var stepsEl = document.getElementById("run-detail-steps");
    if (!stepsEl) return;
    var rows = stepsEl.querySelectorAll(".step-row");
    if (!query) {
      rows.forEach(function(row) {
        row.style.display = "";
        var outputEl = row.querySelector(".step-row-output");
        if (outputEl && outputEl.getAttribute("data-original") !== null) {
          outputEl.textContent = outputEl.getAttribute("data-original");
          outputEl.removeAttribute("data-original");
        }
      });
      return;
    }
    var lq = query.toLowerCase();
    rows.forEach(function(row) {
      var outputEl = row.querySelector(".step-row-output");
      if (!outputEl) { row.style.display = "none"; return; }
      var original = outputEl.getAttribute("data-original");
      if (original === null) {
        original = outputEl.getAttribute("data-full") || outputEl.textContent || "";
        outputEl.setAttribute("data-original", original);
      }
      if (original.toLowerCase().indexOf(lq) === -1) {
        row.style.display = "none";
        return;
      }
      row.style.display = "";
      var lower = original.toLowerCase();
      var parts = [];
      var i = 0;
      while (i < original.length) {
        var idx = lower.indexOf(lq, i);
        if (idx === -1) { parts.push(escapeHtml(original.slice(i))); break; }
        if (idx > i) parts.push(escapeHtml(original.slice(i, idx)));
        parts.push('<mark class="log-match">' + escapeHtml(original.slice(idx, idx + query.length)) + "</mark>");
        i = idx + query.length;
      }
      outputEl.innerHTML = parts.join("");
    });
  }
`;
