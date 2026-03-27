/** Chat rendering and message-sending functions for the KOTA web UI. */

export const CLIENT_CHAT_JS = `
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
`;
