/** Run detail panel, streaming, and close/show-chat helpers for the KOTA web UI. */

export const CLIENT_RUN_DETAIL_JS = `
  // --- Run detail panel ---

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
    refreshHistory();
  }

  async function showRunDetail(runId) {
    closeStream();
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
      renderRunDetail(run, artifacts);
      if (run.status === "running") {
        startRunStream(runId);
      }
    } catch (err) {
      $runDetail.innerHTML = '<div style="color:#f44336;padding:24px">Error: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderRunDetail(run, artifacts) {
    var badgeClass = run.status === "success" ? "success" : run.status === "failed" ? "failed" : run.status === "running" ? "running" : "interrupted";
    var icon = run.status === "success" ? "\\u2713" : run.status === "failed" ? "\\u2717" : run.status === "running" ? "\\u25b6" : "\\u26a1";
    var duration = run.durationMs ? fmtDuration(run.durationMs) : (run.status === "running" ? fmtDuration(Date.now() - new Date(run.startedAt).getTime()) : "\\u2014");
    var cost = run.totalCostUsd != null ? "$" + run.totalCostUsd.toFixed(4) : "\\u2014";
    var started = new Date(run.startedAt).toLocaleString();
    var completed = run.completedAt ? new Date(run.completedAt).toLocaleString() : "\\u2014";
    var html = '<div class="run-detail-header">';
    html += '<button class="run-detail-back" id="run-detail-back">\\u2190 Back</button>';
    html += '<div class="run-detail-title"><span class="run-badge ' + badgeClass + '">' + icon + '</span>' + escapeHtml(run.workflow) + '</div>';
    html += '<div class="run-detail-meta">';
    html += '<span>ID: <code>' + escapeHtml(run.id) + '</code></span>';
    html += '<span>Status: ' + escapeHtml(run.status) + '</span>';
    html += '<span>Duration: ' + duration + '</span>';
    html += '<span>Cost: ' + cost + '</span>';
    html += '<span>Started: ' + escapeHtml(started) + '</span>';
    html += '<span>Completed: ' + escapeHtml(completed) + '</span>';
    html += '</div></div>';

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
    html += '<div class="run-detail-steps" id="run-detail-steps">';
    var steps = run.steps || [];
    if (steps.length === 0 && run.status !== "running") {
      html += '<div class="run-empty">No steps recorded</div>';
    } else {
      for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var sb = step.status === "success" ? "success" : step.status === "failed" ? "failed" : step.status === "running" ? "running" : "interrupted";
        var si = step.status === "success" ? "\\u2713" : step.status === "failed" ? "\\u2717" : step.status === "running" ? "\\u25b6" : "\\u26a1";
        var sm = step.durationMs ? fmtDuration(step.durationMs) : "";
        var rawOutput = "";
        if (step.output != null) {
          rawOutput = typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2);
        } else if (step.error) {
          rawOutput = "Error: " + step.error;
        }
        var truncated = rawOutput.length > 300;
        var outputText = truncated ? rawOutput.slice(0, 300) : rawOutput;
        html += '<div class="step-row" id="step-row-' + escapeHtml(step.id) + '">';
        html += '<div class="step-row-header">';
        html += '<span class="run-badge ' + sb + '" id="step-badge-' + escapeHtml(step.id) + '">' + si + '</span>';
        html += '<span class="step-row-name">' + escapeHtml(step.id) + '</span>';
        html += '<span class="step-row-meta" id="step-meta-' + escapeHtml(step.id) + '">' + escapeHtml(sm) + '</span>';
        html += '</div>';
        if (rawOutput) {
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
      if (spBadge) { spBadge.className = "run-badge running"; spBadge.textContent = "\u25b6"; }
      if (spItem) spItem.classList.add("active");
      var existingRow = document.getElementById("step-row-" + payload.stepId);
      if (!existingRow) {
        var row = document.createElement("div");
        row.className = "step-row";
        row.id = "step-row-" + payload.stepId;
        row.innerHTML =
          '<div class="step-row-header">' +
          '<span class="run-badge running" id="step-badge-' + escapeHtml(payload.stepId) + '">\u25b6</span>' +
          '<span class="step-row-name">' + escapeHtml(payload.stepId) + '</span>' +
          '<span class="step-row-meta" id="step-meta-' + escapeHtml(payload.stepId) + '"></span>' +
          '</div>' +
          '<div class="step-row-output" id="step-output-' + escapeHtml(payload.stepId) + '"></div>';
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
      if (meta && payload.durationMs) meta.textContent = fmtDuration(payload.durationMs);
    } else if (eventName === "run_completed") {
      closeStream();
      showRunDetail(runId);
    }
  }
`;
