import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDuration(ms: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

export function fmtUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "just now";
  const totalS = Math.floor(ms / 1000);
  const totalM = Math.floor(totalS / 60);
  const totalH = Math.floor(totalM / 60);
  const days = Math.floor(totalH / 24);
  if (days > 0) return `${days}d ${totalH % 24}h`;
  if (totalH > 0) return `${totalH}h ${totalM % 60}m`;
  if (totalM > 0) return `${totalM}m ${totalS % 60}s`;
  return `${totalS}s`;
}

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
  html = html.replace(
    /```(\w*)?\n([\s\S]*?)```/g,
    (_, _lang, code) => `<pre><code>${code}</code></pre>`,
  );
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /(?<![*])\*(?![*])(.+?)(?<![*])\*(?![*])/g,
    "<em>$1</em>",
  );
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, linkText: string, url: string) => {
      const trimmed = url.trim().toLowerCase();
      if (
        trimmed.startsWith("http:") ||
        trimmed.startsWith("https:") ||
        trimmed.startsWith("mailto:")
      ) {
        return `<a href="${url.replace(/"/g, "&quot;")}" target="_blank" rel="noopener">${linkText}</a>`;
      }
      return `[${linkText}](${url})`;
    },
  );
  return html;
}
