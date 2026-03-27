/** Shared browser utility functions for the KOTA web UI. */

export const CLIENT_UTILS_JS = `
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDuration(ms) {
    if (!ms) return "";
    if (ms < 1000) return ms + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return Math.floor(ms / 60000) + "m" + Math.floor((ms % 60000) / 1000) + "s";
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
`;
