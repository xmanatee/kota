const { createServer } = require("node:http");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = process.cwd();

function assetFor(pathname) {
  if (pathname === "/") return "index.html";
  const withoutSlash = pathname.replace(/^\//, "");
  if (withoutSlash.includes("..")) return null;
  return withoutSlash;
}

function contentType(pathname) {
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

const server = createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const asset = assetFor(requestUrl.pathname);
  if (!asset) {
    res.writeHead(400);
    res.end("bad path");
    return;
  }

  try {
    const body = readFileSync(join(root, asset), "utf8");
    res.writeHead(200, { "content-type": contentType(asset) });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer() {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function statusBannerRule(css) {
  const match = css.match(/\.status-banner\s*\{([\s\S]*?)\}/);
  return match ? match[1] : "";
}

function buildPreviewHtml(html, css) {
  return html.replace(
    '<link rel="stylesheet" href="./styles.css">',
    `<style>\n${css}\n</style>`,
  );
}

async function loadViaLoopback() {
  try {
    await listen();
  } catch (err) {
    return loadViaFilesystemFallback(err);
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("preview server did not expose a loopback port");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const [htmlResponse, cssResponse] = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/styles.css`),
  ]);
  return {
    html: await htmlResponse.text(),
    css: await cssResponse.text(),
    url: `${baseUrl}/`,
    transport: "loopback",
    htmlServed: htmlResponse.ok,
    cssServed: cssResponse.ok,
  };
}

function loadViaFilesystemFallback(err) {
  return {
    html: readFileSync(join(root, "index.html"), "utf8"),
    css: readFileSync(join(root, "styles.css"), "utf8"),
    url: "file://preview/index.html",
    transport: "filesystem-fallback",
    fallbackReason: err instanceof Error ? err.message : String(err),
    htmlServed: true,
    cssServed: true,
  };
}

async function main() {
  try {
    const preview = await loadViaLoopback();
    const { html, css } = preview;
    const rule = statusBannerRule(css);
    const checks = [
      { name: "index served", passed: preview.htmlServed },
      { name: "styles served", passed: preview.cssServed },
      {
        name: "status banner markup present",
        passed:
          html.includes('class="status-banner"') &&
          html.includes('data-preview-state="ready"') &&
          html.includes("Sync complete"),
      },
      { name: "status banner css rule present", passed: rule.length > 0 },
      {
        name: "status banner rendered as flex",
        passed: /\bdisplay\s*:\s*flex\b/i.test(rule),
      },
      {
        name: "status banner not display none",
        passed: !/\bdisplay\s*:\s*none\b/i.test(rule),
      },
      {
        name: "status banner not visibility hidden",
        passed: !/\bvisibility\s*:\s*hidden\b/i.test(rule),
      },
      {
        name: "status banner not opacity zero",
        passed: !/\bopacity\s*:\s*0\b/i.test(rule),
      },
    ];
    const passed = checks.every((check) => check.passed);
    writeFileSync("preview.html", buildPreviewHtml(html, css));
    writeFileSync(
      "preview-check.json",
      JSON.stringify(
        {
          url: preview.url,
          transport: preview.transport,
          fallbackReason: preview.fallbackReason,
          passed,
          checks,
        },
        null,
        2,
      ),
    );
    if (!passed) {
      for (const check of checks.filter((item) => !item.passed)) {
        console.error(`preview check failed: ${check.name}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log("ok");
  } finally {
    if (server.listening) await closeServer();
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    if (server.listening) await closeServer();
  } finally {
    process.exit(1);
  }
});
