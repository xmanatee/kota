/** Run detail SSE streaming: startRunStream and handleStreamEvent. */

export const CLIENT_RUN_DETAIL_STREAM_JS = `
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
                } catch (err) {
                  console.warn("[kota-web-ui] Failed to parse run stream event", err);
                }
                curEvent = "";
                curData = "";
              }
            }
            read();
          }).catch(function(err) {
            console.warn("[kota-web-ui] Run stream reader failed", err);
          });
        }
        read();
      })
      .catch(function(err) {
        console.warn("[kota-web-ui] Failed to connect run stream", err);
      });
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
`;
