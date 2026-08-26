import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { projectModuleSetupPendingActionForClient } from "./status-utils.js";
import type { ModuleSetupActionFile, ModuleSetupPendingAction } from "./types.js";

export class ModuleSetupActionStore {
  constructor(private readonly scopeRoot: string) {}

  read(): ModuleSetupActionFile {
    const path = this.path();
    if (!existsSync(path)) return { actions: [] };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ModuleSetupActionFile;
    const rawActions = parsed.actions ?? [];
    const actions = rawActions.map((action) =>
      projectModuleSetupPendingActionForClient(action)
    );
    if (rawActions.some((action) => Object.hasOwn(action, "url"))) {
      this.write({ actions });
    }
    return { actions };
  }

  write(file: ModuleSetupActionFile): void {
    const path = this.path();
    writeJsonFileAtomic(
      path,
      {
        actions: file.actions.map((action) =>
          projectModuleSetupPendingActionForClient(action)
        ),
      },
      undefined,
      { mode: 0o600 },
    );
  }

  latest(
    moduleName: string,
    requirementId: string,
  ): ModuleSetupPendingAction | undefined {
    return this.read().actions
      .filter((action) => action.moduleName === moduleName && action.requirementId === requirementId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  private path(): string {
    return join(this.scopeRoot, ".kota", "setup-actions.json");
  }
}
