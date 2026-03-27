/** Client-side JavaScript for the KOTA web UI (browser template literal).
 * Testable equivalents of escapeHtml/renderMarkdown live in web-ui-markdown.ts. */

export const WEB_UI_JS = /* js */ `
(function() {
  const API = window.location.origin;
  let sessionId = null;
  let sending = false;
  let activeStream = null;

  const $messages = document.getElementById("messages");
  const $input = document.getElementById("input");
  const $send = document.getElementById("send");
  const $newChat = document.getElementById("new-chat");
  const $sessionList = document.getElementById("session-list");
  const $historyList = document.getElementById("history-list");
  const $approvalList = document.getElementById("approval-list");
  const $taskList = document.getElementById("task-queue-list");
  const $workflowList = document.getElementById("workflow-runs-list");
  const $costList = document.getElementById("cost-summary-list");
  const $runDetail = document.getElementById("run-detail");
  const $inputArea = document.getElementById("input-area");
  const $health = document.getElementById("health-status");
  const $sidebar = document.getElementById("sidebar");
  const $toggleSidebar = document.getElementById("toggle-sidebar");

  // --- Session management ---

  async function createSession() {
    const res = await fetch(API + "/api/sessions", { method: "POST" });
    const data = await res.json();
    sessionId = data.session_id;
    $messages.innerHTML = "";
    showWelcome();
    refreshSessions();
    return sessionId;
  }

  async function refreshSessions() {
    try {
      const res = await fetch(API + "/api/sessions");
      const data = await res.json();
      renderSessions(data.sessions || []);
    } catch {}
  }

  function renderSessions(sessions) {
    $sessionList.innerHTML = "";
    for (const s of sessions) {
      const div = document.createElement("div");
      div.className = "session-item" + (s.id === sessionId ? " active" : "");
      const label = document.createElement("span");
      label.textContent = s.id + (s.busy ? " (busy)" : "");
      div.appendChild(label);

      const del = document.createElement("button");
      del.className = "delete-btn";
      del.textContent = "×";
      del.onclick = async (e) => {
        e.stopPropagation();
        await fetch(API + "/api/sessions/" + s.id, { method: "DELETE" });
        if (s.id === sessionId) { sessionId = null; $messages.innerHTML = ""; showWelcome(); }
        refreshSessions();
      };
      div.appendChild(del);

      div.onclick = () => {
        sessionId = s.id;
        $messages.innerHTML = "";
        addMessage("status", "Switched to session " + s.id);
        refreshSessions();
      };
      $sessionList.appendChild(div);
    }
  }

  // --- History ---

  async function refreshHistory() {
    try {
      const res = await fetch(API + "/api/history?limit=15");
      const data = await res.json();
      renderHistory(data.conversations || []);
    } catch {}
  }

  function renderHistory(convos) {
    $historyList.innerHTML = "";
    for (const c of convos) {
      const div = document.createElement("div");
      div.className = "history-item";
      const label = document.createElement("span");
      label.textContent = c.title || c.id.slice(0, 12);
      label.title = new Date(c.updatedAt).toLocaleString();
      div.appendChild(label);
      $historyList.appendChild(div);
    }
  }

  // --- Health check ---

  async function checkHealth() {
    try {
      const res = await fetch(API + "/api/health");
      if (res.ok) {
        $health.className = "ok";
        $health.title = "Connected";
      } else {
        $health.className = "err";
        $health.title = "Server error";
      }
    } catch {
      $health.className = "err";
      $health.title = "Disconnected";
    }
  }

  // --- Chat ---

  function showWelcome() {
    $messages.innerHTML = '<div class="welcome"><h2>KOTA</h2><p>General-purpose AI assistant.<br>Ask anything — research, code, analysis, writing, planning.</p></div>';
  }

  function addMessage(role, content) {
    const welcome = $messages.querySelector(".welcome");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = "message " + role;
    if (role === "assistant") {
      div.innerHTML = renderMarkdown(content);
    } else {
      div.textContent = content;
    }
    $messages.appendChild(div);
    $messages.scrollTop = $messages.scrollHeight;
    return div;
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
      return '<pre><code>' + code + '</code></pre>';
    });

    // Inline code
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/(?<![*])\\*(?![*])(.+?)(?<![*])\\*(?![*])/g, '<em>$1</em>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // Links — only allow safe protocols (http, https, mailto)
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(_, linkText, url) {
      var trimmed = url.trim().toLowerCase();
      if (trimmed.startsWith("http:") || trimmed.startsWith("https:") || trimmed.startsWith("mailto:")) {
        return '<a href="' + url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">' + linkText + '</a>';
      }
      return '[' + linkText + '](' + url + ')';
    });

    return html;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function sendMessage() {
    const text = $input.value.trim();
    if (!text || sending) return;

    sending = true;
    $send.disabled = true;
    $input.value = "";
    autoResize();

    addMessage("user", text);

    // Create session on first message if needed
    if (!sessionId) {
      await createSession();
    }

    const assistantDiv = addMessage("assistant", "");
    assistantDiv.innerHTML = '<span class="typing-indicator">Thinking...</span>';
    let fullText = "";

    try {
      const res = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        assistantDiv.className = "message error";
        assistantDiv.textContent = err.error || "Request failed";
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "text" && data.content) {
                fullText += data.content;
                assistantDiv.innerHTML = renderMarkdown(fullText);
                $messages.scrollTop = $messages.scrollHeight;
              } else if (data.type === "status") {
                // Optional: show status in a subtle way
              } else if (data.type === "error") {
                fullText += "\\n[Error: " + (data.message || "unknown") + "]";
                assistantDiv.innerHTML = renderMarkdown(fullText);
              }
            } catch {}
          } else if (line.startsWith("event: session")) {
            // Session event
          } else if (line.startsWith("event: done")) {
            // Stream complete
          }
        }
      }

      if (!fullText) {
        assistantDiv.innerHTML = '<span class="typing-indicator">No response</span>';
      }
    } catch (err) {
      assistantDiv.className = "message error";
      assistantDiv.textContent = "Connection error: " + err.message;
    } finally {
      sending = false;
      $send.disabled = false;
      $input.focus();
      refreshSessions();
    }
  }

  // --- Auto-resize textarea ---
  function autoResize() {
    $input.style.height = "auto";
    $input.style.height = Math.min($input.scrollHeight, 200) + "px";
  }

  // --- Event listeners ---

  $send.onclick = sendMessage;

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  $input.addEventListener("input", autoResize);

  $newChat.onclick = () => {
    sessionId = null;
    showChat();
    showWelcome();
    refreshSessions();
  };

  $toggleSidebar.onclick = () => {
    $sidebar.classList.toggle("collapsed");
  };

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
  }

  async function showRunDetail(runId) {
    closeStream();
    $messages.style.display = "none";
    $inputArea.style.display = "none";
    $runDetail.innerHTML = '<div style="color:var(--text-muted);padding:24px">Loading\u2026</div>';
    $runDetail.classList.add("visible");
    try {
      var res = await fetch(API + "/api/workflow/runs/" + encodeURIComponent(runId));
      if (!res.ok) {
        $runDetail.innerHTML = '<div style="color:#f44336;padding:24px">Run not found</div>';
        return;
      }
      var run = await res.json();
      renderRunDetail(run);
      if (run.status === "running") {
        startRunStream(runId);
      }
    } catch (err) {
      $runDetail.innerHTML = '<div style="color:#f44336;padding:24px">Error: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderRunDetail(run) {
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
        var outputText = "";
        if (step.output != null) {
          var raw = typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2);
          outputText = raw.length > 300 ? raw.slice(0, 300) + "\\u2026" : raw;
        } else if (step.error) {
          outputText = "Error: " + step.error;
        }
        html += '<div class="step-row">';
        html += '<div class="step-row-header">';
        html += '<span class="run-badge ' + sb + '">' + si + '</span>';
        html += '<span class="step-row-name">' + escapeHtml(step.id) + '</span>';
        html += '<span class="step-row-meta">' + escapeHtml(sm) + '</span>';
        html += '</div>';
        if (outputText) {
          html += '<div class="step-row-output">' + escapeHtml(outputText) + '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
    $runDetail.innerHTML = html;
    document.getElementById("run-detail-back").onclick = showChat;
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

    fetch(API + "/api/workflow/runs/" + encodeURIComponent(runId) + "/stream")
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

  // --- Approval panel ---

  function renderApprovals(approvals) {
    $approvalList.innerHTML = "";
    if (!approvals.length) {
      $approvalList.innerHTML = '<div class="run-empty">No pending approvals</div>';
      return;
    }
    for (var i = 0; i < approvals.length; i++) {
      var a = approvals[i];
      var ageMs = Date.now() - new Date(a.createdAt).getTime();
      var item = document.createElement("div");
      item.className = "approval-item";
      item.innerHTML =
        '<div class="approval-header">' +
        '<span class="approval-risk ' + escapeHtml(a.risk) + '">' + escapeHtml(a.risk) + '</span>' +
        '<span class="approval-tool">' + escapeHtml(a.tool) + '</span>' +
        '<span class="run-meta">' + fmtDuration(ageMs) + '</span>' +
        '</div>' +
        '<div class="approval-reason">' + escapeHtml(a.reason) + '</div>' +
        '<div class="approval-actions">' +
        '<button class="approval-btn approval-approve" data-id="' + escapeHtml(a.id) + '">\u2713 Approve</button>' +
        '<button class="approval-btn approval-reject" data-id="' + escapeHtml(a.id) + '">\u2717 Reject</button>' +
        '</div>';
      $approvalList.appendChild(item);
    }
    var approveBtns = $approvalList.querySelectorAll(".approval-approve");
    var rejectBtns = $approvalList.querySelectorAll(".approval-reject");
    for (var j = 0; j < approveBtns.length; j++) {
      (function(btn) {
        btn.onclick = async function() {
          btn.disabled = true;
          try {
            await fetch(API + "/api/approvals/" + encodeURIComponent(btn.dataset.id) + "/approve", { method: "POST" });
            refreshApprovals();
          } catch { btn.disabled = false; }
        };
      })(approveBtns[j]);
    }
    for (var k = 0; k < rejectBtns.length; k++) {
      (function(btn) {
        btn.onclick = async function() {
          btn.disabled = true;
          try {
            await fetch(API + "/api/approvals/" + encodeURIComponent(btn.dataset.id) + "/reject", { method: "POST" });
            refreshApprovals();
          } catch { btn.disabled = false; }
        };
      })(rejectBtns[k]);
    }
  }

  async function refreshApprovals() {
    try {
      var res = await fetch(API + "/api/approvals");
      if (!res.ok) return;
      var data = await res.json();
      renderApprovals(data.approvals || []);
    } catch {}
  }

  // --- Task queue panel ---

  function renderTasks(counts, doing) {
    $taskList.innerHTML = "";
    var countsEl = document.createElement("div");
    countsEl.className = "task-counts";
    var labels = [
      ["doing", counts.doing],
      ["ready", counts.ready],
      ["blocked", counts.blocked],
      ["backlog", counts.backlog],
      ["inbox", counts.inbox],
    ];
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i][0];
      var count = labels[i][1];
      if (!count) continue;
      var span = document.createElement("span");
      span.className = "task-count-item task-state-" + label;
      span.textContent = label + ": " + count;
      countsEl.appendChild(span);
    }
    if (countsEl.childNodes.length === 0) {
      countsEl.textContent = "No open tasks";
      countsEl.className = "run-empty";
    }
    $taskList.appendChild(countsEl);

    for (var j = 0; j < doing.length; j++) {
      var t = doing[j];
      var item = document.createElement("div");
      item.className = "run-item";
      item.innerHTML = '<span class="run-badge running">▶</span>' +
        '<span class="run-name">' + escapeHtml(t.title) + '</span>' +
        '<span class="run-meta">' + escapeHtml(t.priority) + '</span>';
      $taskList.appendChild(item);
    }
  }

  async function refreshTasks() {
    try {
      var res = await fetch(API + "/api/tasks");
      if (!res.ok) return;
      var data = await res.json();
      renderTasks(data.counts || {}, data.doing || []);
    } catch {}
  }

  // --- Workflow runs panel ---

  function fmtDuration(ms) {
    if (!ms) return "";
    if (ms < 1000) return ms + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return Math.floor(ms / 60000) + "m" + Math.floor((ms % 60000) / 1000) + "s";
  }

  function renderWorkflows(activeRuns, recentRuns) {
    $workflowList.innerHTML = "";
    var shown = 0;

    for (var i = 0; i < activeRuns.length; i++) {
      var run = activeRuns[i];
      var elapsed = Date.now() - new Date(run.startedAt).getTime();
      var item = document.createElement("div");
      item.className = "run-item";
      item.style.cursor = "pointer";
      item.innerHTML = '<span class="run-badge running">▶</span>' +
        '<span class="run-name">' + escapeHtml(run.workflow) + '</span>' +
        '<span class="run-meta">' + fmtDuration(elapsed) + '</span>';
      item.onclick = (function(id) { return function() { showRunDetail(id); }; })(run.runId);
      $workflowList.appendChild(item);
      shown++;
    }

    var activeIds = {};
    for (var j = 0; j < activeRuns.length; j++) activeIds[activeRuns[j].runId] = true;

    for (var k = 0; k < recentRuns.length && shown < 10; k++) {
      var r = recentRuns[k];
      if (r.status === "running" || activeIds[r.id]) continue;
      var badgeClass = r.status === "success" ? "success" : r.status === "failed" ? "failed" : "interrupted";
      var icon = r.status === "success" ? "✓" : r.status === "failed" ? "✗" : "⚡";
      var meta = (r.durationMs ? fmtDuration(r.durationMs) : "") + (r.totalCostUsd != null ? " $" + r.totalCostUsd.toFixed(3) : "");
      var ri = document.createElement("div");
      ri.className = "run-item";
      ri.style.cursor = "pointer";
      ri.innerHTML = '<span class="run-badge ' + badgeClass + '">' + icon + '</span>' +
        '<span class="run-name">' + escapeHtml(r.workflow) + '</span>' +
        '<span class="run-meta">' + meta.trim() + '</span>';
      ri.onclick = (function(id) { return function() { showRunDetail(id); }; })(r.id);
      $workflowList.appendChild(ri);
      shown++;
    }

    if (shown === 0) {
      $workflowList.innerHTML = '<div class="run-empty">No recent runs</div>';
    }
  }

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
      var res = await fetch(API + "/api/workflow/runs?since=" + since);
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

  async function refreshWorkflows() {
    try {
      var statusRes = await fetch(API + "/api/workflow/status");
      var runsRes = await fetch(API + "/api/workflow/runs?limit=10");
      if (!statusRes.ok || !runsRes.ok) return;
      var statusData = await statusRes.json();
      var runsData = await runsRes.json();
      renderWorkflows(statusData.activeRuns || [], runsData.runs || []);
    } catch {}
  }

  // --- Init ---
  showWelcome();
  checkHealth();
  refreshSessions();
  refreshHistory();
  refreshWorkflows();
  refreshTasks();
  refreshCost();
  refreshApprovals();
  setInterval(checkHealth, 30000);
  setInterval(refreshSessions, 15000);
  setInterval(refreshWorkflows, 5000);
  setInterval(refreshTasks, 5000);
  setInterval(refreshCost, 5000);
  setInterval(refreshApprovals, 5000);
  $input.focus();
})();
`;
