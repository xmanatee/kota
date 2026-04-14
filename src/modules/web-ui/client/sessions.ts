/** Session management, history, and health-check functions for the KOTA web UI. */

export const CLIENT_SESSIONS_JS = `
  // --- Session labels (localStorage) ---

  var sessionsNotice = "";
  var historyNotice = "";

  function setSessionsNotice(message) {
    sessionsNotice = message;
  }

  function setHistoryNotice(message) {
    historyNotice = message;
  }

  function getSessionLabel(id) {
    return localStorage.getItem("kota-session-label:" + id) || "";
  }

  function setSessionLabel(id, label) {
    if (label) {
      localStorage.setItem("kota-session-label:" + id, label);
    } else {
      localStorage.removeItem("kota-session-label:" + id);
    }
  }

  function clearSessionLabel(id) {
    localStorage.removeItem("kota-session-label:" + id);
  }

  // --- Session management ---

  async function createSession() {
    const res = await apiFetch(API +"/api/sessions", { method: "POST" });
    const data = await res.json();
    sessionId = data.session_id;
    $messages.innerHTML = "";
    showWelcome();
    refreshSessions();
    return sessionId;
  }

  async function refreshSessions() {
    try {
      const res = await apiFetch(API +"/api/sessions");
      if (!res.ok) {
        setSessionsNotice("Failed to load sessions");
        renderSessions([]);
        return;
      }
      const data = await res.json();
      setSessionsNotice("");
      renderSessions(data.sessions || []);
    } catch {
      setSessionsNotice("Failed to load sessions");
      renderSessions([]);
    }
  }

  function startSessionLabelEdit(id, labelSpan) {
    const current = getSessionLabel(id);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "session-label-input";
    input.value = current;
    input.placeholder = id.slice(0, 8);
    input.title = id;

    function save() {
      const val = input.value.trim();
      setSessionLabel(id, val);
      refreshSessions();
    }

    input.onblur = save;
    input.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { input.value = current; input.blur(); }
      e.stopPropagation();
    };
    input.onclick = (e) => e.stopPropagation();

    labelSpan.replaceWith(input);
    input.focus();
    input.select();
  }

  function renderSessions(sessions) {
    $sessionList.innerHTML = "";
    if (sessionsNotice) {
      $sessionList.innerHTML = '<div class="run-empty">' + escapeHtml(sessionsNotice) + '</div>';
      return;
    }
    for (const s of sessions) {
      const div = document.createElement("div");
      div.className = "session-item" + (s.id === sessionId ? " active" : "");

      const label = document.createElement("span");
      label.className = "session-label";
      const stored = getSessionLabel(s.id);
      label.textContent = stored || s.id.slice(0, 8) + (s.busy ? " (busy)" : "");
      label.title = s.id;
      if (stored && s.busy) label.textContent += " (busy)";
      div.appendChild(label);

      const editBtn = document.createElement("button");
      editBtn.className = "session-edit-btn";
      editBtn.textContent = "✎";
      editBtn.title = "Rename session";
      editBtn.onclick = (e) => {
        e.stopPropagation();
        startSessionLabelEdit(s.id, div.querySelector(".session-label"));
      };
      div.appendChild(editBtn);

      const del = document.createElement("button");
      del.className = "delete-btn";
      del.textContent = "×";
      del.onclick = async (e) => {
        e.stopPropagation();
        clearSessionLabel(s.id);
        await apiFetch(API +"/api/sessions/" + s.id, { method: "DELETE" });
        if (s.id === sessionId) { sessionId = null; $messages.innerHTML = ""; showWelcome(); }
        refreshSessions();
      };
      div.appendChild(del);

      div.ondblclick = () => startSessionLabelEdit(s.id, div.querySelector(".session-label"));

      div.onclick = () => {
        sessionId = s.id;
        $messages.innerHTML = "";
        const displayName = getSessionLabel(s.id) || s.id;
        addMessage("status", "Switched to session " + displayName);
        refreshSessions();
      };
      $sessionList.appendChild(div);
    }
  }

  // --- History ---

  async function refreshHistory() {
    try {
      const res = await apiFetch(API +"/api/history?limit=15");
      if (!res.ok) {
        setHistoryNotice("Failed to load history");
        renderHistory([]);
        return;
      }
      const data = await res.json();
      setHistoryNotice("");
      renderHistory(data.conversations || []);
    } catch {
      setHistoryNotice("Failed to load history");
      renderHistory([]);
    }
  }

  function renderHistory(convos) {
    $historyList.innerHTML = "";
    if (historyNotice) {
      $historyList.innerHTML = '<div class="run-empty">' + escapeHtml(historyNotice) + '</div>';
      return;
    }
    for (const c of convos) {
      const div = document.createElement("div");
      div.className = "history-item" + (c.id === historyViewId ? " active" : "");
      const label = document.createElement("span");
      label.textContent = c.title || c.id.slice(0, 12);
      label.title = new Date(c.updatedAt).toLocaleString();
      div.appendChild(label);
      div.onclick = () => loadHistoryView(c.id);
      $historyList.appendChild(div);
    }
  }

  // --- Health check ---

  async function checkHealth() {
    try {
      const res = await apiFetch(API +"/api/health");
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
`;
