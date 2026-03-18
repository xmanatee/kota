/** Client-side JavaScript for the KOTA web UI (browser template literal).
 * Testable equivalents of escapeHtml/renderMarkdown live in web-ui-markdown.ts. */

export const WEB_UI_JS = /* js */ `
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
