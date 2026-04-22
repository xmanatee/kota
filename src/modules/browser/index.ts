import type { KotaModule, ModuleContext, ToolDef } from "#core/modules/module-types.js";
import {
  type BrowserProfileOptions,
  closeBrowser,
  configureBrowserProfile,
  isPlaywrightAvailable,
} from "./lifecycle.js";
import {
  browserClickTool,
  browserCloseTool,
  browserEvaluateTool,
  browserGetTextTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserTypeTool,
  renderedArticleReadTool,
  runBrowserClick,
  runBrowserClose,
  runBrowserEvaluate,
  runBrowserGetText,
  runBrowserNavigate,
  runBrowserScreenshot,
  runBrowserType,
  runRenderedArticleRead,
  runXPostRead,
  xPostReadTool,
} from "./tools.js";

export type BrowserModuleConfig = {
  /**
   * Path to a Playwright `storageState` JSON file. When present, the
   * browser context is created with this persisted cookie/localStorage
   * snapshot so authenticated sites recognise the session. Relative paths
   * are resolved against the project directory. The file is optional —
   * absence falls back to an ephemeral context.
   */
  storageStatePath?: string;
  /**
   * When true, persist the current context's storage state back to
   * `storageStatePath` on idle close. Operators can use this to capture
   * a fresh login (one-time run) before pinning the file in their
   * secrets/config surface.
   */
  persistProfile?: boolean;
};

function resolveProfile(ctx: ModuleContext): BrowserProfileOptions {
  const raw = ctx.getModuleConfig<BrowserModuleConfig>() ?? {};
  const storageStatePath = typeof raw.storageStatePath === "string" && raw.storageStatePath.length > 0
    ? raw.storageStatePath
    : null;
  const persist = Boolean(raw.persistProfile);
  return { storageStatePath, persist };
}

function buildTools(): ToolDef[] {
  return [
    {
      tool: browserNavigateTool,
      runner: runBrowserNavigate,
      risk: "dangerous",
      kind: "action",
      group: "browser",
    },
    {
      tool: browserClickTool,
      runner: runBrowserClick,
      risk: "dangerous",
      kind: "action",
      group: "browser",
    },
    {
      tool: browserTypeTool,
      runner: runBrowserType,
      risk: "dangerous",
      kind: "action",
      group: "browser",
    },
    {
      tool: browserScreenshotTool,
      runner: runBrowserScreenshot,
      risk: "dangerous",
      kind: "discovery",
      group: "browser",
    },
    {
      tool: browserEvaluateTool,
      runner: runBrowserEvaluate,
      risk: "dangerous",
      kind: "action",
      group: "browser",
    },
    {
      tool: browserGetTextTool,
      runner: runBrowserGetText,
      risk: "dangerous",
      kind: "discovery",
      group: "browser",
    },
    {
      tool: xPostReadTool,
      runner: runXPostRead,
      risk: "dangerous",
      kind: "discovery",
      group: "browser",
    },
    {
      tool: renderedArticleReadTool,
      runner: runRenderedArticleRead,
      risk: "dangerous",
      kind: "discovery",
      group: "browser",
    },
    {
      tool: browserCloseTool,
      runner: runBrowserClose,
      risk: "safe",
      kind: "action",
      group: "browser",
    },
  ];
}

const browserModule: KotaModule = {
  name: "browser",
  version: "1.0.0",
  description:
    "Headless browser automation tools powered by Playwright: navigation, interaction, screenshots, JS evaluation, and scoped content-ingest tools for auth-walled / JS-gated sources",
  tools: buildTools(),

  onLoad(ctx: ModuleContext) {
    if (!isPlaywrightAvailable()) {
      ctx.log.warn(
        "Playwright is not installed — browser tools will fail at runtime. " +
          "Install with: pnpm add playwright",
      );
    }
    const profile = resolveProfile(ctx);
    configureBrowserProfile(profile);
    if (profile.storageStatePath) {
      ctx.log.info(
        `browser: authenticated profile configured at ${profile.storageStatePath}` +
          (profile.persist ? " (persist enabled)" : ""),
      );
    }
    ctx.registerCleanupHook(() => void closeBrowser());
  },

  async onUnload() {
    await closeBrowser();
  },
};

export default browserModule;
