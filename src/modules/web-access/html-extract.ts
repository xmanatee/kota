/**
 * Extract readable content from HTML, converting to Markdown-like format.
 * Removes boilerplate (nav, header, footer, sidebar) and preserves structure
 * (headings, code blocks, lists, links). Dramatically improves signal-to-noise
 * ratio compared to naive tag stripping.
 */

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
 * 1. Remove HTML comments and boilerplate blocks in document order
 *    (script, style, nav, header, footer, aside, etc.)
 * 2. Convert code blocks → Markdown fenced blocks (protected by placeholders)
 * 3. Convert headings → Markdown # syntax
 * 4. Convert inline elements (lists, links, bold, italic, blockquotes)
 * 5. Strip remaining tags, decode entities, restore placeholders, normalize
 */
export function extractContent(html: string): string {
  let text = removeBlocks(html, [
    "script", "style", "noscript", "nav", "header", "footer",
    "aside", "menu", "svg", "iframe",
  ]);

  const placeholders: string[] = [];
  text = convertCodeBlocks(text, placeholders);
  text = convertTables(text, placeholders);
  text = convertHeadings(text);
  text = convertInlineElements(text);

  return finalCleanup(text, placeholders);
}
