/**
 * Page-level HTML extraction: metadata, content region detection, and
 * class/id-based boilerplate removal. Builds on top of extractContent()
 * from html-extract.ts for the actual HTML→Markdown conversion.
 */

import { decodeEntities, extractContent } from "./html-extract.js";

/** Metadata extracted from HTML <head>. */
export type PageMetadata = {
  title?: string;
  description?: string;
  author?: string;
  date?: string;
  siteName?: string;
};

/** Result of full page extraction with metadata. */
export type PageExtraction = {
  metadata: PageMetadata;
  content: string;
};

/** Extract a meta tag's content attribute by name or property. */
function getMetaContent(html: string, attr: string, value: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]*${attr}="${value}"[^>]*content="([^"]*)"[^>]*/?>|` +
    `<meta[^>]*content="([^"]*)"[^>]*${attr}="${value}"[^>]*/?>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return undefined;
  const raw = m[1] ?? m[2];
  return raw ? decodeEntities(raw).trim() : undefined;
}

/** Extract metadata from <head>. */
export function extractMetadata(html: string): PageMetadata {
  const meta: PageMetadata = {};

  // Title: og:title > <title>
  meta.title = getMetaContent(html, "property", "og:title");
  if (!meta.title) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) meta.title = decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim();
  }

  // Description: og:description > meta description
  meta.description = getMetaContent(html, "property", "og:description")
    ?? getMetaContent(html, "name", "description");

  // Author
  meta.author = getMetaContent(html, "name", "author")
    ?? getMetaContent(html, "property", "article:author");

  // Date: article:published_time > meta date
  meta.date = getMetaContent(html, "property", "article:published_time")
    ?? getMetaContent(html, "name", "date")
    ?? getMetaContent(html, "property", "article:modified_time");

  // Site name
  meta.siteName = getMetaContent(html, "property", "og:site_name");

  // Remove empty values
  for (const key of Object.keys(meta) as (keyof PageMetadata)[]) {
    if (!meta[key]) delete meta[key];
  }
  return meta;
}

/**
 * Try to find the main content region in HTML.
 * Looks for <article>, <main>, [role="main"], or common content IDs/classes.
 * Returns the inner HTML of the best match, or null to fall back to full page.
 */
export function findContentRegion(html: string): string | null {
  const patterns: RegExp[] = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*role="main"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="main-content"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="article"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*\bpost-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*\barticle-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*\bentry-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const candidate = match[1];
      const textLen = candidate.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().length;
      if (textLen > 100) return candidate;
    }
  }
  return null;
}

/** Pattern for class/id values that indicate non-content boilerplate. */
const BOILERPLATE_ATTR_RE = /\b(sidebar|comment|comments|related|social|share|sharing|widget|advertisement|ad-|cookie|consent|popup|modal|banner|toolbar|search-form|signup|newsletter|promo|sponsor)\b/i;

/**
 * Remove div/section elements whose class or id matches boilerplate patterns.
 */
export function removeBoilerplateByAttr(html: string): string {
  return html.replace(
    /<(div|section)[^>]*(?:class|id)="([^"]*)"[^>]*>[\s\S]*?<\/\1>/gi,
    (fullMatch, _tag, attrValue) => {
      return BOILERPLATE_ATTR_RE.test(attrValue) ? "" : fullMatch;
    },
  );
}

/** Format metadata as a compact header block for display. */
export function formatMetadataHeader(meta: PageMetadata): string {
  const parts: string[] = [];
  if (meta.title) parts.push(`**${meta.title}**`);
  const details: string[] = [];
  if (meta.siteName) details.push(meta.siteName);
  if (meta.author) details.push(`by ${meta.author}`);
  if (meta.date) {
    const d = meta.date.match(/^(\d{4}-\d{2}-\d{2})/);
    details.push(d ? d[1] : meta.date);
  }
  if (details.length > 0) parts.push(details.join(" · "));
  if (meta.description) parts.push(`> ${meta.description}`);
  return parts.length > 0 ? `${parts.join("\n")}\n\n---\n` : "";
}

/**
 * Full page extraction: metadata + content region detection + enhanced cleanup.
 * Pre-processes HTML to narrow content region and remove boilerplate by
 * class/id, then delegates to extractContent() for Markdown conversion.
 */
export function extractPage(html: string): PageExtraction {
  const metadata = extractMetadata(html);

  // Narrow to main content region if possible
  let body = findContentRegion(html) ?? html;

  // Remove boilerplate elements by class/id before conversion
  body = removeBoilerplateByAttr(body);

  // Remove <form> and <template> blocks (not handled by extractContent)
  body = body.replace(/<form[\s>][\s\S]*?<\/form>/gi, "");
  body = body.replace(/<template[\s>][\s\S]*?<\/template>/gi, "");

  // Use the existing pipeline for Markdown conversion
  const content = extractContent(body);
  return { metadata, content };
}
