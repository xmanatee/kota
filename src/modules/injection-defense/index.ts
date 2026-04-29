/**
 * Injection-defense module — input-side defense for externally authored
 * content on autonomous runs.
 *
 * Registers middleware that screens output from content-ingest tools
 * (`web_fetch`, `web_search`, `http_request`, `read_document`) against a
 * cheap structural detector. Suspicious payloads receive a warning banner
 * before they reach agent context; every screened call emits an
 * `injection.defense.assessed` bus event so operators can audit both
 * false positives and missed attacks.
 *
 * Policy is opinionated:
 *   - screens autonomous runs by default (the task contract)
 *   - annotates rather than drops (false positives do not break work)
 *   - does not downgrade or bypass tool-risk gating
 *
 * Config under `modules.injection-defense`:
 *   {
 *     enabled?: boolean;               // default true
 *     targetTools?: string[];          // default: web_fetch, web_search,
 *                                      //          http_request, read_document
 *     targetModes?: AutonomyMode[];    // default: ["autonomous"]
 *   }
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { AUTONOMY_MODES, type AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  createInjectionDefenseMiddleware,
  DEFAULT_TARGET_MODES,
  DEFAULT_TARGET_TOOLS,
  type InjectionAssessmentPayload,
} from "./defense-middleware.js";
import { injectionDefenseAssessed } from "./events.js";

const MIDDLEWARE_NAME = "injection-defense";
// Priority 40 — runs after the retry middleware (20) so retried responses are
// still screened, and before the default third-party middleware band (100+).
const PRIORITY = 40;

export type InjectionDefenseConfig = {
  enabled?: boolean;
  targetTools?: string[];
  targetModes?: AutonomyMode[];
};

function resolveConfig(ctx: ModuleContext): {
  enabled: boolean;
  targetTools: Set<string>;
  targetModes: Set<AutonomyMode>;
} {
  const raw = ctx.getModuleConfig<InjectionDefenseConfig>() ?? {};
  const enabled = raw.enabled ?? true;
  const targetTools = new Set(raw.targetTools ?? DEFAULT_TARGET_TOOLS);
  const requested = raw.targetModes ?? DEFAULT_TARGET_MODES;
  const targetModes = new Set<AutonomyMode>();
  for (const mode of requested) {
    if (!AUTONOMY_MODES.includes(mode)) {
      ctx.log.warn(
        `injection-defense: ignoring unknown autonomy mode "${mode}"`,
      );
      continue;
    }
    targetModes.add(mode);
  }
  return { enabled, targetTools, targetModes };
}

const injectionDefenseModule: KotaModule = {
  name: "injection-defense",
  version: "1.0.0",
  description:
    "Input-side injection defense for externally ingested content on autonomous runs",
  events: [injectionDefenseAssessed],

  onLoad: (ctx) => {
    const { enabled, targetTools, targetModes } = resolveConfig(ctx);
    if (!enabled || targetTools.size === 0 || targetModes.size === 0) {
      ctx.log.info("injection-defense: disabled by configuration");
      return;
    }

    const emit = (payload: InjectionAssessmentPayload) => {
      ctx.events.emit(injectionDefenseAssessed, payload);
    };
    const mw = createInjectionDefenseMiddleware({
      targetTools,
      targetModes,
      emit,
    });
    ctx.registerMiddleware(MIDDLEWARE_NAME, mw, PRIORITY);
    ctx.log.info(
      `injection-defense: screening ${targetTools.size} tool(s) on modes: ${[...targetModes].join(", ")}`,
    );
  },
};

export default injectionDefenseModule;
