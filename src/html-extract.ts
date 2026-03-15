/**
 * Extract readable content from HTML, converting to Markdown-like format.
 * Removes boilerplate (nav, header, footer, sidebar) and preserves structure
 * (headings, code blocks, lists, links). Dramatically improves signal-to-noise
 * ratio compared to naive tag stripping.
 */

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&apos;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–",
  "&laquo;": "«", "&raquo;": "»", "&copy;": "©", "&reg;": "®",
  "&hellip;": "…", "&trade;": "™", "&bull;": "•", "&middot;": "·",
};

export function decodeEntities(text: string): string {
  let result = text;
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    result = result.replaceAll(entity, char);
  }
  result = result.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
    String.fromCharCode(Number.parseInt(h, 16)),
  );
  return result;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

/**
 * Remove self-contained HTML blocks by tag name.
 * Uses non-greedy matching — works for typical non-nested usage of
 * semantic elements like nav, header, footer, aside, etc.
 */
function removeBlocks(html: string, tags: string[]): string {
  let result = html;
  for (const tag of tags) {
    result = result.replace(
      new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, "gi"),
      "",
    );
  }
  return result;
}

/**
 * Convert code blocks to Markdown fenced blocks, replacing them with
 * placeholders so decoded entities (< >) aren't mangled by later tag stripping.
 */
function convertCodeBlocks(
  html: string,
  placeholders: string[],
): string {
  const ph = (content: string): string => {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\n\n__KOTA_CODE_${idx}__\n\n`;
  };

  // <pre><code class="language-X">...</code></pre>
  let result = html.replace(
    /<pre[^>]*>\s*<code[^>]*(?:class="[^"]*(?:language-|lang-)(\w+)[^"]*")[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, lang, code) => {
      const decoded = decodeEntities(code.replace(/<[^>]+>/g, "")).trim();
      return ph(`\`\`\`${lang}\n${decoded}\n\`\`\``);
    },
  );
  // <pre><code>...</code></pre> (no language)
  result = result.replace(
    /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, code) => {
      const decoded = decodeEntities(code.replace(/<[^>]+>/g, "")).trim();
      return ph(`\`\`\`\n${decoded}\n\`\`\``);
    },
  );
  // bare <pre>...</pre>
  result = result.replace(
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, code) => {
      const decoded = decodeEntities(code.replace(/<[^>]+>/g, "")).trim();
      return ph(`\`\`\`\n${decoded}\n\`\`\``);
    },
  );
  // Inline <code> — also use placeholder to protect content
  result = result.replace(
    /<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_, code) => {
      const decoded = stripTags(code);
      return ph(`\`${decoded}\``);
    },
  );
  return result;
}

/**
 * Convert HTML tables to Markdown table format.
 * Uses placeholders (like code blocks) to protect content from later stripping.
 */
function convertTables(html: string, placeholders: string[]): string {
  const ph = (content: string): string => {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\n\n__KOTA_CODE_${idx}__\n\n`;
  };

  return html.replace(
    /<table[^>]*>([\s\S]*?)<\/table>/gi,
    (_, tableBody) => {
      const rows: string[][] = [];

      for (const rowMatch of (tableBody as string).matchAll(
        /<tr[^>]*>([\s\S]*?)<\/tr>/gi,
      )) {
        const cells: string[] = [];
        for (const cellMatch of rowMatch[1].matchAll(
          /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi,
        )) {
          cells.push(
            stripTags(cellMatch[1].replace(/<br\s*\/?>/gi, " "))
              .replace(/\|/g, "\\|")
              .replace(/\s+/g, " ")
              .trim(),
          );
        }
        if (cells.length > 0) rows.push(cells);
      }

      if (rows.length === 0) return "";

      const maxCols = Math.max(...rows.map((r) => r.length));
      for (const row of rows) {
        while (row.length < maxCols) row.push("");
      }

      const lines: string[] = [];
      lines.push(`| ${rows[0].join(" | ")} |`);
      lines.push(`| ${rows[0].map(() => "---").join(" | ")} |`);
      for (let i = 1; i < rows.length; i++) {
        lines.push(`| ${rows[i].join(" | ")} |`);
      }

      return ph(lines.join("\n"));
    },
  );
}

/** Convert headings to Markdown # syntax. */
function convertHeadings(html: string): string {
  let result = html;
  for (let i = 1; i <= 6; i++) {
    const prefix = "#".repeat(i);
    result = result.replace(
      new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, "gi"),
      (_, content) => `\n\n${prefix} ${stripTags(content)}\n\n`,
    );
  }
  return result;
}

/** Convert list items, links, emphasis to Markdown equivalents. */
function convertInlineElements(html: string): string {
  let result = html;

  // Ordered list items → numbered
  result = result.replace(
    /<ol[^>]*>([\s\S]*?)<\/ol>/gi,
    (_, content) => {
      let n = 0;
      return (content as string).replace(
        /<li[^>]*>([\s\S]*?)<\/li>/gi,
        (_m: string, text: string) => `\n${++n}. ${stripTags(text)}`,
      );
    },
  );

  // Definition lists → bold term: definition
  result = result.replace(
    /<dl[^>]*>([\s\S]*?)<\/dl>/gi,
    (_, inner) => {
      const pairs: string[] = [];
      const re = /<dt[^>]*>([\s\S]*?)<\/dt>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/gi;
      for (const m of (inner as string).matchAll(re)) {
        pairs.push(`**${stripTags(m[1])}**: ${stripTags(m[2])}`);
      }
      return pairs.length > 0 ? `\n${pairs.join("\n")}\n` : "";
    },
  );

  // Image alt text
  result = result.replace(
    /<img[^>]*\balt="([^"]+)"[^>]*\/?>/gi,
    (_, alt) => `[Image: ${decodeEntities(alt)}]`,
  );

  // List items
  result = result.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_, content) => `\n- ${stripTags(content)}`,
  );

  // Blockquotes
  result = result.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, content) => {
      const text = stripTags(content);
      return `\n${text.split("\n").map((l: string) => `> ${l}`).join("\n")}\n`;
    },
  );

  // Links — keep only absolute HTTP URLs, skip anchors/relative/javascript
  result = result.replace(
    /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_, url, linkText) => {
      const clean = stripTags(linkText);
      return clean ? `[${clean}](${url})` : "";
    },
  );

  // Bold
  result = result.replace(
    /<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, __, content) => `**${stripTags(content)}**`,
  );

  // Italic
  result = result.replace(
    /<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, __, content) => `*${stripTags(content)}*`,
  );

  return result;
}

/** Final cleanup: convert block elements to newlines, strip remaining tags. */
function finalCleanup(html: string, placeholders: string[]): string {
  let text = html;

  // Block elements → newlines
  text = text.replace(
    /<\/(p|div|section|article|main|tr|dd|dt)[^>]*>/gi,
    "\n",
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode entities in non-code content
  text = decodeEntities(text);

  // Restore code block placeholders
  for (let i = 0; i < placeholders.length; i++) {
    text = text.replace(`__KOTA_CODE_${i}__`, placeholders[i]);
  }

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

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
  // Phase 1: Remove boilerplate
  let text = removeBlocks(html, [
    "script", "style", "noscript", "nav", "header", "footer",
    "aside", "menu", "svg", "iframe",
  ]);

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Phase 2: Convert semantic elements to Markdown
  const placeholders: string[] = [];
  text = convertCodeBlocks(text, placeholders);
  text = convertTables(text, placeholders);
  text = convertHeadings(text);
  text = convertInlineElements(text);

  // Phase 3: Final cleanup (restores code block placeholders)
  return finalCleanup(text, placeholders);
}
