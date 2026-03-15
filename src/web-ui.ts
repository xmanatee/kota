/**
 * Embedded web UI for KOTA — a chat interface served directly from the HTTP server.
 * No build step, no external files. Just HTML/CSS/JS as a string.
 */

export function getWebUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KOTA</title>
<style>
${CSS}
</style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <div class="sidebar-header">
      <h1>KOTA</h1>
      <button id="new-chat" title="New chat">+</button>
    </div>
    <div id="session-list"></div>
    <div class="sidebar-section">
      <h3>History</h3>
      <div id="history-list"></div>
    </div>
    <div class="sidebar-footer">
      <span id="health-status">●</span>
      <button id="toggle-sidebar" class="icon-btn" title="Toggle sidebar">☰</button>
    </div>
  </aside>
  <main id="chat-area">
    <div id="messages"></div>
    <div id="input-area">
      <textarea id="input" placeholder="Message KOTA..." rows="1"></textarea>
      <button id="send" title="Send">→</button>
    </div>
  </main>
</div>
<script>
${JS}
</script>
</body>
</html>`;
}

// --- CSS ---

const CSS = /* css */ `
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-chat: #0f0f23;
  --text: #e0e0e0;
  --text-muted: #8888aa;
  --accent: #6c63ff;
  --accent-hover: #5a52d5;
  --user-bg: #2a2a4a;
  --assistant-bg: #1e1e3a;
  --border: #2a2a4a;
  --input-bg: #1e1e3a;
  --sidebar-w: 260px;
  --radius: 8px;
}

html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg-chat);
  color: var(--text);
}

#app {
  display: flex;
  height: 100vh;
}

/* --- Sidebar --- */
#sidebar {
  width: var(--sidebar-w);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s;
}
#sidebar.collapsed { width: 0; border-right: none; }

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}
.sidebar-header h1 {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--accent);
}
#new-chat {
  background: var(--accent);
  color: #fff;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
#new-chat:hover { background: var(--accent-hover); }

.sidebar-section { padding: 8px 12px; }
.sidebar-section h3 {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
  letter-spacing: 1px;
}

#session-list, #history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}
#history-list { max-height: 300px; }

.session-item, .history-item {
  padding: 8px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.session-item:hover, .history-item:hover { background: var(--border); }
.session-item.active { background: var(--accent); color: #fff; }
.session-item .delete-btn, .history-item .delete-btn {
  opacity: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}
.session-item:hover .delete-btn, .history-item:hover .delete-btn { opacity: 1; }

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
}
#health-status { font-size: 10px; }
#health-status.ok { color: #4caf50; }
#health-status.err { color: #f44336; }
.icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
}

/* --- Chat area --- */
#chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

#messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  padding: 14px 18px;
  border-radius: var(--radius);
  line-height: 1.6;
  font-size: 14px;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.message.user {
  background: var(--user-bg);
  border-left: 3px solid var(--accent);
}
.message.assistant {
  background: var(--assistant-bg);
}
.message.status {
  background: none;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: 4px;
}
.message.error {
  background: #2a1020;
  border-left: 3px solid #f44336;
  color: #ff8a80;
}

.message pre {
  background: #0a0a1a;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.4;
}
.message code {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 13px;
}
.message :not(pre) > code {
  background: #0a0a1a;
  padding: 2px 6px;
  border-radius: 4px;
}

.typing-indicator {
  color: var(--text-muted);
  font-style: italic;
  font-size: 13px;
}

/* --- Input area --- */
#input-area {
  padding: 16px 24px;
  display: flex;
  gap: 8px;
  max-width: 848px;
  width: 100%;
  margin: 0 auto;
}

#input {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 12px 16px;
  font-family: inherit;
  font-size: 14px;
  resize: none;
  max-height: 200px;
  outline: none;
}
#input:focus { border-color: var(--accent); }

#send {
  background: var(--accent);
  color: #fff;
  border: none;
  width: 44px;
  border-radius: var(--radius);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
#send:hover { background: var(--accent-hover); }
#send:disabled { opacity: 0.5; cursor: not-allowed; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* Welcome */
.welcome {
  text-align: center;
  color: var(--text-muted);
  margin: auto;
  padding: 40px;
}
.welcome h2 {
  font-size: 24px;
  color: var(--accent);
  margin-bottom: 12px;
}
.welcome p { font-size: 14px; line-height: 1.8; }

/* Mobile */
@media (max-width: 768px) {
  #sidebar { position: fixed; z-index: 10; height: 100%; }
  #sidebar.collapsed { width: 0; }
  .toggle-visible { display: block !important; }
}
`;

// --- JS ---

const JS = /* js */ `
(function() {
  const API = window.location.origin;
  let sessionId = null;
  let sending = false;

  const $messages = document.getElementById("messages");
  const $input = document.getElementById("input");
  const $send = document.getElementById("send");
  const $newChat = document.getElementById("new-chat");
  const $sessionList = document.getElementById("session-list");
  const $historyList = document.getElementById("history-list");
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
    // Remove welcome if present
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
    // Minimal markdown: code blocks, inline code, bold, italic, headers, links
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

    // Links
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    return html;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
            // Session event — extract session_id from next data line
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
    $messages.innerHTML = "";
    showWelcome();
    refreshSessions();
  };

  $toggleSidebar.onclick = () => {
    $sidebar.classList.toggle("collapsed");
  };

  // --- Init ---
  showWelcome();
  checkHealth();
  refreshSessions();
  refreshHistory();
  setInterval(checkHealth, 30000);
  setInterval(refreshSessions, 15000);
  $input.focus();
})();
`;
