/**
 * Extract readable content from HTML, converting to Markdown-like format.
 * Removes boilerplate (nav, header, footer, sidebar) and preserves structure
 * (headings, code blocks, lists, links). Dramatically improves signal-to-noise
 * ratio compared to naive tag stripping.
 */

export { decodeEntities } from "./html-extract-utils.js";

import {
  convertCodeBlocks,
  convertHeadings,
  convertInlineElements,
  convertTables,
  finalCleanup,
  removeBlocks,
} from "./html-extract-utils.js";

/**
 * Extract readable content from HTML.
 *
 * Pipeline:
 * 1. Remove boilerplate blocks (script, style, nav, header, footer, aside, etc.)
 * 2. Remove HTML comments
 * 3. Convert code blocks → Markdown fenced blocks (protected by placeholders)
 * 4. Convert headings → Markdown # syntax
 * 5. Convert inline elements (lists, links, bold, italic, blockquotes)
 * 6. Strip remaining tags, decode entities, restore placeholders, normalize
 */
export function extractContent(html: string): string {
  let text = removeBlocks(html, [
    "script", "style", "noscript", "nav", "header", "footer",
    "aside", "menu", "svg", "iframe",
  ]);

  text = text.replace(/<!--[\s\S]*?-->/g, "");

  const placeholders: string[] = [];
  text = convertCodeBlocks(text, placeholders);
  text = convertTables(text, placeholders);
  text = convertHeadings(text);
  text = convertInlineElements(text);

  return finalCleanup(text, placeholders);
}
