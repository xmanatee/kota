import type { KotaModule, ModuleContext, ModuleRuntimeContext, ToolDef } from "#core/modules/module-types.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import { daemonWriteEffect, networkDestructiveEffect } from "#core/tools/effect.js";
import { buildBrowserCommand } from "./cli.js";
import {
  type BrowserModuleConfig,
  resolveBrowserProfileConfig,
} from "./config.js";
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

export type { BrowserModuleConfig } from "./config.js";

function resolveProfile(ctx: ModuleContext): BrowserProfileOptions {
  const raw = ctx.getModuleConfig<BrowserModuleConfig>() ?? {};
  return resolveBrowserProfileConfig(raw);
}

function buildTools(): ToolDef[] {
  return [
    {
      tool: browserNavigateTool,
      runner: runBrowserNavigate,
      effect: networkDestructiveEffect(),
      group: "browser",
    },
    {
      tool: browserClickTool,
      runner: runBrowserClick,
      effect: networkDestructiveEffect(),
      group: "browser",
    },
    {
      tool: browserTypeTool,
      runner: runBrowserType,
      effect: networkDestructiveEffect(),
      group: "browser",
    },
    {
      tool: browserScreenshotTool,
      runner: runBrowserScreenshot,
      effect: networkDestructiveEffect(),
      group: "browser",
    },
    {
      tool: browserEvaluateTool,
      runner: runBrowserEvaluate,
      effect: networkDestructiveEffect(),
      group: "browser",
    },
    {
      tool: browserGetTextTool,
      runner: runBrowserGetText,
      effect: networkDestructiveEffect(),
      group: "browser",
    },
    {
      tool: xPostReadTool,
      runner: runXPostRead,
      effect: networkDestructiveEffect(),
      group: "browser",
    },
    {
      tool: renderedArticleReadTool,
      runner: runRenderedArticleRead,
      effect: networkDestructiveEffect(),
      group: "browser",
    },
    {
      tool: browserCloseTool,
      runner: runBrowserClose,
      effect: daemonWriteEffect(),
      group: "browser",
    },
  ];
}

const browserSetupRequirements: ModuleSetupRequirement[] = [
  {
    id: "auth-profile",
    kind: "browser-profile",
    title: "Authenticated browser profile",
    description:
      "Playwright storage-state file used for auth-walled and JavaScript-gated sources.",
    required: false,
    scope: "project",
    owner: "browser",
    sensitivity: "browser-profile",
    storageStateConfigPath: "modules.browser.storageStatePath",
    setup: {
      mode: "form",
      fields: [
        {
          id: "storage-state-path",
          label: "Storage state path",
          type: "string",
          configPath: "modules.browser.storageStatePath",
          required: true,
          placeholder: "browser/storage-state.json",
        },
        {
          id: "persist-profile",
          label: "Persist profile",
          type: "boolean",
          configPath: "modules.browser.persistProfile",
          required: false,
        },
      ],
    },
  },
];

const browserModule: KotaModule = {
  name: "browser",
  version: "1.0.0",
  description:
    "Headless browser automation tools powered by Playwright: navigation, interaction, screenshots, JS evaluation, and scoped content-ingest tools for auth-walled / JS-gated sources",
  setupRequirements: browserSetupRequirements,
  tools: buildTools(),
  commands: (ctx: ModuleContext) => [buildBrowserCommand(ctx)],

  onLoad(ctx: ModuleRuntimeContext) {
    if (!isPlaywrightAvailable(ctx.cwd)) {
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
