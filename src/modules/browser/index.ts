import type { KotaModule, ModuleContext, ToolDef } from "#core/modules/module-types.js";
import { closeBrowser, isPlaywrightAvailable } from "./lifecycle.js";
import {
  browserClickTool,
  browserCloseTool,
  browserEvaluateTool,
  browserGetTextTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserTypeTool,
  runBrowserClick,
  runBrowserClose,
  runBrowserEvaluate,
  runBrowserGetText,
  runBrowserNavigate,
  runBrowserScreenshot,
  runBrowserType,
} from "./tools.js";

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
    "Headless browser automation tools powered by Playwright: navigation, interaction, screenshots, JS evaluation",
  tools: buildTools(),

  onLoad(ctx: ModuleContext) {
    if (!isPlaywrightAvailable()) {
      ctx.log.warn(
        "Playwright is not installed — browser tools will fail at runtime. " +
          "Install with: pnpm add playwright",
      );
    }
    ctx.registerCleanupHook(() => void closeBrowser());
  },

  async onUnload() {
    await closeBrowser();
  },
};

export default browserModule;
