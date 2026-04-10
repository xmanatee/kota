const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&apos;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–",
  "&laquo;": "«", "&raquo;": "»", "&copy;": "©", "&reg;": "®",
  "&hellip;": "…", "&trade;": "™", "&bull;": "•", "&middot;": "·",
};

function safeFromCodePoint(cp: number): string | null {
  if (!Number.isFinite(cp) || cp < 0) return null;
  if (cp === 0) return "\uFFFD";
  if (cp >= 0xD800 && cp <= 0xDFFF) return null;
  if (cp > 0x10FFFF) return null;
  return String.fromCodePoint(cp);
}

export function decodeEntities(text: string): string {
  let result = text;
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    result = result.replaceAll(entity, char);
  }
  result = result.replace(/&#(\d+);/g, (match, n) => {
    const ch = safeFromCodePoint(Number(n));
    return ch ?? match;
  });
  result = result.replace(/&#x([0-9a-f]+);/gi, (match, h) => {
    const ch = safeFromCodePoint(Number.parseInt(h, 16));
    return ch ?? match;
  });
  return result;
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

export function removeBlocks(html: string, tags: string[]): string {
  let result = html;
  for (const tag of tags) {
    result = result.replace(
      new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, "gi"),
      "",
    );
  }
  return result;
}

export function convertCodeBlocks(
  html: string,
  placeholders: string[],
): string {
  const ph = (content: string): string => {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\n\n__KOTA_CODE_${idx}__\n\n`;
  };

  let result = html.replace(
    /<pre[^>]*>\s*<code[^>]*(?:class="[^"]*(?:language-|lang-)(\w+)[^"]*")[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, lang, code) => {
      const decoded = decodeEntities(code.replace(/<[^>]+>/g, "")).trim();
      return ph(`\`\`\`${lang}\n${decoded}\n\`\`\``);
    },
  );
  result = result.replace(
    /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, code) => {
      const decoded = decodeEntities(code.replace(/<[^>]+>/g, "")).trim();
      return ph(`\`\`\`\n${decoded}\n\`\`\``);
    },
  );
  result = result.replace(
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, code) => {
      const decoded = decodeEntities(code.replace(/<[^>]+>/g, "")).trim();
      return ph(`\`\`\`\n${decoded}\n\`\`\``);
    },
  );
  result = result.replace(
    /<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_, code) => {
      const decoded = stripTags(code);
      return ph(`\`${decoded}\``);
    },
  );
  return result;
}

export function convertTables(html: string, placeholders: string[]): string {
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

export function convertHeadings(html: string): string {
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

export function convertInlineElements(html: string): string {
  let result = html;

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

  result = result.replace(
    /<img[^>]*\balt="([^"]+)"[^>]*\/?>/gi,
    (_, alt) => `[Image: ${decodeEntities(alt)}]`,
  );

  result = result.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_, content) => `\n- ${stripTags(content)}`,
  );

  result = result.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, content) => {
      const text = stripTags(content);
      return `\n${text.split("\n").map((l: string) => `> ${l}`).join("\n")}\n`;
    },
  );

  result = result.replace(
    /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_, url, linkText) => {
      const clean = stripTags(linkText);
      return clean ? `[${clean}](${url})` : "";
    },
  );

  result = result.replace(
    /<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, __, content) => `**${stripTags(content)}**`,
  );

  result = result.replace(
    /<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, __, content) => `*${stripTags(content)}*`,
  );

  return result;
}

export function finalCleanup(html: string, placeholders: string[]): string {
  let text = html;

  text = text.replace(
    /<\/(p|div|section|article|main|tr|dd|dt)[^>]*>/gi,
    "\n",
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  text = text.replace(/<[^>]+>/g, "");

  text = decodeEntities(text);

  for (let i = 0; i < placeholders.length; i++) {
    text = text.replace(`__KOTA_CODE_${i}__`, placeholders[i]);
  }

  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
