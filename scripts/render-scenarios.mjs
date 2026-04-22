#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { SCENARIOS } from "../src/modules/rendering/scenarios.ts";
import { render, renderContext } from "../src/modules/rendering/render.ts";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "../src/modules/rendering/theme.ts";

const [, , outPath] = process.argv;
if (!outPath) {
  console.error("usage: render-scenarios.mjs <output>");
  process.exit(1);
}

const lines = [];
lines.push("# Rendering Scenarios");
lines.push("");
lines.push(
  "Each scenario renders through the rendering module in three themes so",
);
lines.push(
  "reviewers can see the pipe-safe form (no-color), the default TTY form,",
);
lines.push(
  "and the ascii-only fallback used by terminals that cannot paint the",
);
lines.push(
  "default Unicode glyphs. These samples exist to anchor the primitive",
);
lines.push(
  "vocabulary against concrete output while more surfaces migrate onto it.",
);
lines.push("");

for (const scenario of SCENARIOS) {
  lines.push(`## ${scenario.name}`);
  lines.push("");
  lines.push(scenario.description);
  lines.push("");
  lines.push("### default theme (80 columns)");
  lines.push("");
  lines.push("```");
  lines.push(render(scenario.node, renderContext({ theme: DEFAULT_THEME, width: 80 })));
  lines.push("```");
  lines.push("");
  lines.push("### no-color theme (100 columns, pipe/CI)");
  lines.push("");
  lines.push("```");
  lines.push(render(scenario.node, renderContext({ theme: NO_COLOR_THEME, width: 100 })));
  lines.push("```");
  lines.push("");
  lines.push("### ascii theme (60 columns)");
  lines.push("");
  lines.push("```");
  lines.push(render(scenario.node, renderContext({ theme: ASCII_THEME, width: 60 })));
  lines.push("```");
  lines.push("");
}

writeFileSync(outPath, lines.join("\n"));
console.log(`wrote ${lines.length} lines to ${outPath}`);
