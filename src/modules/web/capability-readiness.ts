import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";

const MODULE_NAME = "web";

export function createWebReadinessSource(opts: {
  projectDir: string;
}): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      const distDir = resolve(opts.projectDir, "clients/web/dist");
      const indexExists = existsSync(join(distDir, "index.html"));
      if (!indexExists) {
        return [
          {
            id: "dashboard",
            moduleName: MODULE_NAME,
            status: "unavailable",
            reason: "web_ui_not_built",
            message:
              "Web dashboard is unavailable — run `pnpm --filter @kota/web build` to produce clients/web/dist.",
          },
        ];
      }
      return [
        {
          id: "dashboard",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Embedded web dashboard is built and ready to serve.",
          meta: { distDir },
        },
      ];
    },
  };
}
