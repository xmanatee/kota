/** Chat area, messages, input, scrollbar, and welcome screen styles for the KOTA web UI. */

export const STYLES_CHAT_CSS = `
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

/* History view bar */
#history-view-bar {
  display: none;
  padding: 10px 24px;
  max-width: 848px;
  width: 100%;
  margin: 0 auto;
  align-items: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: 13px;
  border-top: 1px solid var(--border);
}
#history-view-bar button {
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 5px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
}
#history-view-bar button:hover { border-color: var(--accent); color: var(--accent); }
`;
