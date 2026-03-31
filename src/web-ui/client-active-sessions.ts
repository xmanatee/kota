/** Active daemon sessions panel for the KOTA web UI. */

export const CLIENT_ACTIVE_SESSIONS_JS = `
  // --- Active sessions panel ---

  var _activeSessions = [];

  function renderActiveSessions(sessions) {
    _activeSessions = sessions;
    $activeSessionsList.innerHTML = "";
    if (!sessions.length) {
      $activeSessionsList.innerHTML = '<div class="run-empty">No active sessions</div>';
      return;
    }
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var ageMs = Date.now() - new Date(s.createdAt).getTime();
      var item = document.createElement("div");
      item.className = "session-live-item";
      item.innerHTML =
        '<span class="run-badge success">interactive</span>' +
        '<span class="session-live-id">' + escapeHtml(s.id.slice(0, 8)) + '</span>' +
        '<span class="run-meta">' + fmtDuration(ageMs) + '</span>';
      $activeSessionsList.appendChild(item);
    }
  }

  async function refreshActiveSessions() {
    try {
      var res = await apiFetch(API +"/api/daemon/status");
      if (!res.ok) return;
      var data = await res.json();
      renderActiveSessions((data.daemon && data.daemon.sessions) || []);
    } catch {}
  }
`;
