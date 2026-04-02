/** Run detail panel, streaming, and close/show-chat helpers for the KOTA web UI. */

export const CLIENT_RUN_DETAIL_JS = `
  // --- Run detail panel ---

  function scrollToApprovals() {
    var el = document.getElementById('approval-list');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }

  function closeStream() {
    if (activeStream) {
      activeStream.cancel();
      activeStream = null;
    }
  }

  function showChat() {
    closeStream();
    $runDetail.classList.remove("visible");
    $messages.style.display = "";
    $inputArea.style.display = "";
    $historyViewBar.style.display = "none";
    historyViewId = null;
    history.replaceState(null, "", window.location.pathname);
    refreshHistory();
  }

  async function showRunDetail(runId) {
    closeStream();
    history.replaceState(null, "", "#run=" + encodeURIComponent(runId));
    $messages.style.display = "none";
    $inputArea.style.display = "none";
    $runDetail.innerHTML = '<div style="color:var(--text-muted);padding:24px">Loading\u2026</div>';
    $runDetail.classList.add("visible");
    try {
      var res = await apiFetch(API +"/api/workflow/runs/" + encodeURIComponent(runId));
      if (!res.ok) {
        $runDetail.innerHTML = '<div style="color:#f44336;padding:24px">Run not found</div>';
        return;
      }
      var run = await res.json();
      var artifacts = null;
      try {
        var aRes = await apiFetch(API + "/api/workflow/runs/" + encodeURIComponent(runId) + "/artifacts");
        if (aRes.ok) artifacts = await aRes.json();
      } catch {}
      var thinkingData = null;
      try {
        var tRes = await apiFetch(API + "/api/workflow/runs/" + encodeURIComponent(runId) + "/thinking");
        if (tRes.ok) { var td = await tRes.json(); thinkingData = td.thinking || null; }
      } catch {}
      var triggeredRuns = null;
      try {
        var trRes = await apiFetch(API + "/api/workflow/runs?causedByRunId=" + encodeURIComponent(runId));
        if (trRes.ok) { var trData = await trRes.json(); triggeredRuns = trData.runs || null; }
      } catch {}
      renderRunDetail(run, artifacts, thinkingData, triggeredRuns);
      renderCompareSection(run);
      if (run.status === "running") {
        startRunStream(runId);
      }
    } catch (err) {
      $runDetail.innerHTML = '<div style="color:#f44336;padding:24px">Error: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderRunDetail(run, artifacts, thinkingData, triggeredRuns) {
    var badgeClass = run.status === "success" ? "success" : run.status === "failed" ? "failed" : run.status === "running" ? "running" : "interrupted";
    var icon = run.status === "success" ? "\\u2713" : run.status === "failed" ? "\\u2717" : run.status === "running" ? "\\u25b6" : "\\u26a1";
    var duration = run.durationMs ? fmtDuration(run.durationMs) : (run.status === "running" ? fmtDuration(Date.now() - new Date(run.startedAt).getTime()) : "\\u2014");
    var cost = run.totalCostUsd != null ? "$" + run.totalCostUsd.toFixed(4) : "\\u2014";
    var started = new Date(run.startedAt).toLocaleString();
    var completed = run.completedAt ? new Date(run.completedAt).toLocaleString() : "\\u2014";
    var html = '<div class="run-detail-header">';
    html += '<button class="run-detail-back" id="run-detail-back">\\u2190 Back</button>';
    if (run.status === "running" || run.status === "repairing") {
      html += '<button class="run-detail-abort" id="run-detail-abort">\\u23f9 Abort</button>';
    }
    if (run.status !== "running" && run.status !== "repairing") {
      html += '<button class="run-detail-replay" id="run-detail-replay">\\u21ba Replay</button>';
    }
    if (run.status === "failed" || run.status === "interrupted") {
      html += '<button class="run-detail-retry" id="run-detail-retry">\\u21ba Retry</button>';
    }
    html += '<div class="run-detail-title"><span class="run-badge ' + badgeClass + '">' + icon + '</span>' + escapeHtml(run.workflow) + '</div>';
    html += '<div class="run-detail-meta">';
    html += '<span>ID: <code>' + escapeHtml(run.id) + '</code></span>';
    html += '<span>Status: ' + escapeHtml(run.status) + '</span>';
    html += '<span>Duration: ' + duration + '</span>';
    html += '<span>Cost: ' + cost + '</span>';
    html += '<span>Started: ' + escapeHtml(started) + '</span>';
    html += '<span>Completed: ' + escapeHtml(completed) + '</span>';
    if (run.causedBy) {
      html += '<span>Triggered by: <a href="#" class="run-causedby-link" data-runid="' + escapeHtml(run.causedBy.runId) + '">' + escapeHtml(run.causedBy.workflow) + ' / ' + escapeHtml(run.causedBy.runId) + '</a></span>';
    }
    if (triggeredRuns && triggeredRuns.length > 0) {
      html += '<span>Triggered runs: ';
      for (var tri = 0; tri < triggeredRuns.length; tri++) {
        var tr = triggeredRuns[tri];
        var trIcon = tr.status === "success" ? "\\u2713" : tr.status === "failed" ? "\\u2717" : tr.status === "running" ? "\\u25b6" : "\\u26a1";
        var trBadge = tr.status === "success" ? "success" : tr.status === "failed" ? "failed" : tr.status === "running" ? "running" : "interrupted";
        if (tri > 0) html += " ";
        html += '<a href="#" class="run-causedby-link" data-runid="' + escapeHtml(tr.id) + '"><span class="run-badge ' + trBadge + '">' + trIcon + '</span> ' + escapeHtml(tr.workflow) + ' / ' + escapeHtml(tr.id) + '</a>';
      }
      html += '</span>';
    }
    html += '</div></div>';

    if (run.warnings && run.warnings.length > 0) {
      html += '<div class="run-warnings">';
      html += '<div class="run-warnings-title">\\u26a0 Warnings</div>';
      for (var wi2 = 0; wi2 < run.warnings.length; wi2++) {
        var w = run.warnings[wi2];
        html += '<div class="run-warning-row"><code>' + escapeHtml(w.type) + '</code> ' + escapeHtml(w.message) + '</div>';
      }
      html += '</div>';
    }

    if (artifacts && artifacts.runSummary) {
      var s = artifacts.runSummary;
      html += '<div class="run-artifacts">';
      html += '<div class="run-artifacts-title">Run Summary</div>';
      if (s.taskTitle) html += '<div class="run-artifact-row"><span class="run-artifact-label">Task</span><span>' + escapeHtml(s.taskTitle) + '</span></div>';
      html += '<div class="run-artifact-row"><span class="run-artifact-label">Commit</span><code>' + escapeHtml(s.commitSha.slice(0, 8)) + '</code> ' + escapeHtml(s.commitMessage) + '</div>';
      if (s.filesChanged && s.filesChanged.length > 0) {
        html += '<div class="run-artifact-row"><span class="run-artifact-label">Files</span><span class="run-artifact-files">' + s.filesChanged.map(function(f) { return '<code>' + escapeHtml(f) + '</code>'; }).join(' ') + '</span></div>';
      }
      html += '</div>';
    } else if (artifacts && artifacts.commitMessage) {
      html += '<div class="run-artifacts">';
      html += '<div class="run-artifacts-title">Commit</div>';
      html += '<div class="run-artifact-row"><pre class="run-artifact-pre">' + escapeHtml(artifacts.commitMessage) + '</pre></div>';
      html += '</div>';
    }

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
    html += '<div class="log-search-bar"><input type="text" id="log-search-input" class="log-search-input" placeholder="Search logs\u2026" autocomplete="off" /></div>';
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

        html += '<div class="step-row" id="step-row-' + escapeHtml(step.id) + '">';
        html += '<div class="step-row-header">';
        html += '<span class="run-badge ' + sb + '" id="step-badge-' + escapeHtml(step.id) + '">' + si + '</span>';
        html += '<span class="step-row-name">' + escapeHtml(step.id) + '</span>';
        html += '<span class="step-row-meta" id="step-meta-' + escapeHtml(step.id) + '">' + escapeHtml(sm) + '</span>';
        html += '</div>';
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
    $runDetail.innerHTML = html;
    document.getElementById("run-detail-back").onclick = showChat;
    var $abortBtn = document.getElementById("run-detail-abort");
    if ($abortBtn) {
      $abortBtn.onclick = async function() {
        if (!confirm("Abort this run?")) return;
        $abortBtn.disabled = true;
        $abortBtn.textContent = "Aborting\\u2026";
        try {
          await apiFetch(API + "/api/workflow/runs/" + encodeURIComponent(run.id) + "/abort", { method: "POST" });
          showRunDetail(run.id);
        } catch (err) {
          $abortBtn.textContent = "\\u23f9 Abort";
          $abortBtn.disabled = false;
          alert("Abort failed: " + err.message);
        }
      };
    }
    $runDetail.querySelectorAll(".run-causedby-link").forEach(function($link) {
      $link.onclick = function(e) {
        e.preventDefault();
        showRunDetail($link.getAttribute("data-runid"));
      };
    });
    var $replayBtn = document.getElementById("run-detail-replay");
    if ($replayBtn) {
      $replayBtn.onclick = async function() {
        $replayBtn.disabled = true;
        $replayBtn.textContent = "Replaying\\u2026";
        try {
          var res = await apiFetch(API + "/api/workflow/replay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: run.id }),
          });
          var data = await res.json();
          if (res.ok && data.ok) {
            $replayBtn.textContent = "\\u2713 Queued";
            if (data.runId) {
              var notice = document.createElement("div");
              notice.style.cssText = "margin-top:8px;font-size:12px;color:var(--text-muted)";
              notice.textContent = "New run: " + data.runId;
              $replayBtn.parentNode.insertBefore(notice, $replayBtn.nextSibling);
            }
          } else {
            $replayBtn.textContent = "\\u21ba Replay";
            $replayBtn.disabled = false;
            alert(data.error || "Replay failed");
          }
        } catch (err) {
          $replayBtn.textContent = "\\u21ba Replay";
          $replayBtn.disabled = false;
          alert("Replay failed: " + err.message);
        }
      };
    }

    var $retryBtn = document.getElementById("run-detail-retry");
    if ($retryBtn) {
      $retryBtn.onclick = async function() {
        $retryBtn.disabled = true;
        try {
          var retryRes = await apiFetch(API + "/api/workflow/retry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: run.id }),
          });
          if (!retryRes.ok) {
            var retryErr = await retryRes.json();
            $retryBtn.title = retryErr.error || "Error";
          } else {
            $retryBtn.textContent = "Queued!";
          }
          await refreshWorkflows();
        } finally {
          $retryBtn.disabled = false;
        }
      };
    }

    var $logSearch = document.getElementById("log-search-input");
    if ($logSearch) {
      $logSearch.addEventListener("input", function() {
        applyLogSearch($logSearch.value);
      });
      $logSearch.addEventListener("keydown", function(e) {
        if (e.key === "Escape") { $logSearch.value = ""; applyLogSearch(""); }
      });
    }

    $runDetail.querySelectorAll(".step-show-more").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var stepId = btn.getAttribute("data-step");
        var outputEl = document.getElementById("step-output-" + stepId);
        if (!outputEl) return;
        if (outputEl.getAttribute("data-truncated") === "1") {
          outputEl.textContent = outputEl.getAttribute("data-full") || "";
          outputEl.setAttribute("data-truncated", "0");
          btn.textContent = "Show less";
        } else {
          var full = outputEl.getAttribute("data-full") || "";
          outputEl.textContent = full.slice(0, 300) + (full.length > 300 ? "\\u2026" : "");
          outputEl.setAttribute("data-truncated", "1");
          btn.textContent = "Show more";
        }
      });
    });
  }

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

  function startRunStream(runId) {
    var stepsContainer = document.getElementById("run-detail-steps");
    if (!stepsContainer) return;

    var cancelled = false;
    var reader = null;

    activeStream = {
      cancel: function() {
        cancelled = true;
        if (reader) reader.cancel();
      }
    };

    apiFetch(API +"/api/workflow/runs/" + encodeURIComponent(runId) + "/stream")
      .then(function(res) {
        if (!res.ok) { showRunDetail(runId); return; }
        if (cancelled) return;
        reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";
        var curEvent = "";
        var curData = "";

        function read() {
          if (cancelled) return;
          reader.read().then(function(chunk) {
            if (chunk.done || cancelled) return;
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split("\\n");
            buffer = lines.pop() || "";
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line.startsWith("event: ")) {
                curEvent = line.slice(7);
              } else if (line.startsWith("data: ")) {
                curData = line.slice(6);
              } else if (line === "" && curData) {
                try {
                  var payload = JSON.parse(curData);
                  handleStreamEvent(curEvent, payload, stepsContainer, runId);
                } catch {}
                curEvent = "";
                curData = "";
              }
            }
            read();
          }).catch(function() {});
        }
        read();
      })
      .catch(function() {});
  }

  function handleStreamEvent(eventName, payload, stepsContainer, runId) {
    if (eventName === "step_started") {
      var spBadge = document.getElementById("sp-badge-" + payload.stepId);
      var spItem = document.getElementById("sp-" + payload.stepId);
      var streamIsApproval = payload.type === "approval";
      if (spBadge) { spBadge.className = "run-badge running"; spBadge.textContent = streamIsApproval ? "\u23f3" : "\u25b6"; }
      if (spItem) spItem.classList.add("active");
      var existingRow = document.getElementById("step-row-" + payload.stepId);
      if (!existingRow) {
        var row = document.createElement("div");
        row.className = "step-row";
        row.id = "step-row-" + payload.stepId;
        var approvalWaitingHtml = streamIsApproval
          ? '<div class="step-approval-waiting">\u23f3 Waiting for approval<a href="#" class="step-approval-link" onclick="scrollToApprovals();return false;">\u2192 Approvals</a></div>'
          : '<div class="step-row-output" id="step-output-' + escapeHtml(payload.stepId) + '"></div>';
        row.innerHTML =
          '<div class="step-row-header">' +
          '<span class="run-badge running" id="step-badge-' + escapeHtml(payload.stepId) + '">' + (streamIsApproval ? "\u23f3" : "\u25b6") + '</span>' +
          '<span class="step-row-name">' + escapeHtml(payload.stepId) + '</span>' +
          '<span class="step-row-meta" id="step-meta-' + escapeHtml(payload.stepId) + '"></span>' +
          '</div>' +
          approvalWaitingHtml;
        stepsContainer.appendChild(row);
      }
    } else if (eventName === "step_output") {
      var outputEl = document.getElementById("step-output-" + payload.stepId);
      if (outputEl && payload.text) {
        var combined = (outputEl.textContent || "") + payload.text;
        outputEl.textContent = combined.length > 600 ? "\u2026" + combined.slice(-600) : combined;
      }
    } else if (eventName === "step_tool") {
      var toolEl = document.getElementById("step-output-" + payload.stepId);
      if (toolEl && payload.tool) {
        toolEl.textContent = (toolEl.textContent || "") + (toolEl.textContent ? "\\n" : "") + "[" + payload.tool + "]";
      }
    } else if (eventName === "step_thinking") {
      if (!payload.thinking) { /* nothing to render */ }
      else {
        var thinkingBodyEl = document.getElementById("step-thinking-body-" + payload.stepId);
        if (!thinkingBodyEl) {
          var stepRow = document.getElementById("step-row-" + payload.stepId);
          if (stepRow) {
            var thinkingDiv = document.createElement("div");
            thinkingDiv.className = "step-thinking";
            thinkingDiv.id = "step-thinking-" + payload.stepId;
            thinkingDiv.innerHTML =
              '<button class="step-thinking-toggle" onclick="toggleThinking(' + JSON.stringify(payload.stepId) + ')">' +
              '\\u25b6 Thinking (1)</button>' +
              '<pre class="step-thinking-body" id="step-thinking-body-' + escapeHtml(payload.stepId) + '" style="display:none">' +
              escapeHtml(payload.thinking) + '</pre>';
            var outputEl2 = document.getElementById("step-output-" + payload.stepId);
            stepRow.insertBefore(thinkingDiv, outputEl2 || null);
          }
        } else {
          var prev = thinkingBodyEl.textContent || "";
          thinkingBodyEl.textContent = prev + "\\n\\n---\\n\\n" + payload.thinking;
          var toggleBtn = document.querySelector("#step-thinking-" + payload.stepId + " .step-thinking-toggle");
          if (toggleBtn) {
            var countMatch = toggleBtn.textContent.match(/\\((\\d+)\\)/);
            if (countMatch) {
              toggleBtn.textContent = toggleBtn.textContent.replace(/\\(\\d+\\)/, "(" + (parseInt(countMatch[1], 10) + 1) + ")");
            }
          }
        }
      }
    } else if (eventName === "step_completed") {
      var spBadge2 = document.getElementById("sp-badge-" + payload.stepId);
      var spItem2 = document.getElementById("sp-" + payload.stepId);
      if (spBadge2) {
        var spStatus = payload.status === "success" ? "success" : payload.status === "skipped" ? "interrupted" : "failed";
        var spIcon = payload.status === "success" ? "\\u2713" : payload.status === "skipped" ? "\\u2014" : "\\u2717";
        spBadge2.className = "run-badge " + spStatus;
        spBadge2.textContent = spIcon;
      }
      if (spItem2) spItem2.classList.remove("active");
      var badge = document.getElementById("step-badge-" + payload.stepId);
      if (badge) {
        badge.className = "run-badge " + (payload.status === "success" ? "success" : "failed");
        badge.textContent = payload.status === "success" ? "\\u2713" : "\\u2717";
      }
      var meta = document.getElementById("step-meta-" + payload.stepId);
      if (meta) {
        var metaText = payload.durationMs ? fmtDuration(payload.durationMs) : "";
        var streamCost = (payload.output && typeof payload.output === "object" && payload.output.totalCostUsd != null) ? ("$" + payload.output.totalCostUsd.toFixed(3)) : "";
        if (streamCost) metaText += (metaText ? " \u00b7 " : "") + streamCost;
        if (metaText) meta.textContent = metaText;
      }
    } else if (eventName === "run_completed") {
      closeStream();
      showRunDetail(runId);
    }
  }

  // --- Run diff (compare two runs) ---

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
      var meta = r.workflow + " — " + new Date(r.startedAt).toLocaleString() + (r.durationMs ? " (" + fmtDuration(r.durationMs) + ")" : "");
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

  function _openRunFromHash() {
    var hash = window.location.hash;
    if (!hash.startsWith("#run=")) return;
    var runId = decodeURIComponent(hash.slice(5));
    if (!runId) return;
    var found = (_allRecentRuns || []).some(function(r) { return r.id === runId; });
    if (found) showRunDetail(runId);
  }
`;
