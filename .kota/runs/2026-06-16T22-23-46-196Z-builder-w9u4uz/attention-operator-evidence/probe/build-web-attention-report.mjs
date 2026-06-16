import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const repoRoot = resolve(process.cwd());
const evidenceDir = resolve(
  repoRoot,
  ".kota/runs/2026-06-16T22-23-46-196Z-builder-w9u4uz/attention-operator-evidence",
);
const webDir = join(evidenceDir, "web");

function bodyFragment(fileName) {
  const raw = readFileSync(join(webDir, fileName), "utf-8");
  const match = raw.match(/<body>\n([\s\S]*)\n<\/body>/);
  return match ? match[1] : raw;
}

const states = [
  ["loading", "Loading", "loading.html"],
  ["items", "Populated", "items-present.html"],
  ["quiet", "Quiet", "quiet.html"],
  ["error", "Error + retry", "error-retry.html"],
];

const report = `<!doctype html>
<meta charset="utf-8">
<title>Web AttentionPanel Rendered Report</title>
<style>
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: #16181d; }
  body { margin: 0; padding: 28px; }
  main { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: 0; }
  p { margin: 0 0 18px; color: #5a6270; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .state { background: white; border: 1px solid #d8dde6; border-radius: 8px; padding: 14px; box-shadow: 0 1px 2px rgba(17, 24, 39, 0.05); }
  .state h2 { margin: 0 0 10px; font-size: 13px; font-weight: 650; color: #2d3440; }
  .text-xs { font-size: 12px; }
  .text-\\[10px\\] { font-size: 10px; }
  .text-\\[11px\\] { font-size: 11px; }
  .text-muted-foreground { color: #687384; }
  .text-destructive { color: #b42318; }
  .text-foreground { color: #111827; }
  .text-yellow-600 { color: #b45309; }
  .text-green-700 { color: #047857; }
  .inline-flex { display: inline-flex; }
  .items-center { align-items: center; }
  .rounded-full { border-radius: 999px; }
  .border { border: 1px solid #d1d5db; }
  .border-transparent { border-color: transparent; }
  .px-2\\.5 { padding-left: 10px; padding-right: 10px; }
  .py-0\\.5 { padding-top: 2px; padding-bottom: 2px; }
  .font-semibold { font-weight: 650; }
  .bg-yellow-500\\/10 { background: rgba(245, 158, 11, 0.14); }
  .bg-green-500\\/10 { background: rgba(34, 197, 94, 0.14); }
  .bg-muted\\/30 { background: #f3f5f8; }
  .h-5 { min-height: 20px; }
  .h-6 { min-height: 24px; }
  .space-y-1 > * + * { margin-top: 4px; }
  .space-y-1\\.5 > * + * { margin-top: 6px; }
  .flex { display: flex; }
  .gap-1\\.5 { gap: 6px; }
  .rounded { border-radius: 6px; }
  .p-2 { padding: 8px; }
  .font-mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
  .leading-snug { line-height: 1.38; }
  .whitespace-pre-wrap { white-space: pre-wrap; }
  button, .button { border: 1px solid #c9d1dd; background: #fff; border-radius: 6px; padding: 4px 8px; font-size: 12px; }
</style>
<main>
  <h1>Web AttentionPanel Rendered Report</h1>
  <p>Generated from actual AttentionPanel test DOM fragments emitted under KOTA_RUN_DIR.</p>
  <div class="grid">
    ${states
      .map(
        ([id, title, file]) => `<section class="state" id="${id}">
      <h2>${title}</h2>
      ${bodyFragment(file)}
    </section>`,
      )
      .join("\n")}
  </div>
</main>
`;

const reportPath = join(webDir, "attention-panel-rendered-report.html");
const screenshotPath = join(webDir, "attention-panel-rendered-report.png");
writeFileSync(reportPath, report, "utf-8");

try {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 980, height: 760 } });
    await page.goto(pathToFileURL(reportPath).href);
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } finally {
    await browser.close();
  }
  console.log(`wrote ${screenshotPath}`);
} catch (err) {
  const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
  writeFileSync(
    join(webDir, "attention-panel-rendered-report-screenshot-unavailable.txt"),
    [
      "Playwright screenshot capture unavailable in this sandbox.",
      "",
      message,
      "",
      `HTML report remains available at ${reportPath}.`,
      "",
    ].join("\n"),
    "utf-8",
  );
}

console.log(`wrote ${reportPath}`);
