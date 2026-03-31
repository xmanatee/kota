/** Session management, history, and health-check functions for the KOTA web UI. */

export const CLIENT_SESSIONS_JS = `
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
        await apiFetch(API +"/api/sessions/" + s.id, { method: "DELETE" });
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
      const res = await apiFetch(API +"/api/history?limit=15");
      const data = await res.json();
      renderHistory(data.conversations || []);
    } catch {}
  }

  function renderHistory(convos) {
    $historyList.innerHTML = "";
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
