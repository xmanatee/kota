/**
 * Testable equivalents of the web UI's escapeHtml and renderMarkdown.
 *
 * These are the canonical reference for the rendering logic embedded in
 * web-ui-client.ts. Changes to the rendering rules should be made in both
 * places — the tests here catch regressions in the browser-side logic.
 */

const SAFE_PROTOCOL = /^https?:|^mailto:/i;

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(/```(\w*)?\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/(?<![*])\*(?![*])(.+?)(?<![*])\*(?![*])/g, "<em>$1</em>");

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Links — only allow safe protocols (http, https, mailto)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    const trimmed = (url as string).trim().toLowerCase();
    if (SAFE_PROTOCOL.test(trimmed)) {
      return `<a href="${(url as string).replace(/"/g, "&quot;")}" target="_blank" rel="noopener">${linkText}</a>`;
    }
    return `[${linkText}](${url})`;
  });

  return html;
}
