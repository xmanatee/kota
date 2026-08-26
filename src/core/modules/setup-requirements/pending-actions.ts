import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleSetupActionFile, ModuleSetupPendingAction } from "./types.js";

export class ModuleSetupActionStore {
  constructor(private readonly scopeRoot: string) {}

  read(): ModuleSetupActionFile {
    const path = this.path();
    if (!existsSync(path)) return { actions: [] };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ModuleSetupActionFile;
    return { actions: parsed.actions ?? [] };
  }

  write(file: ModuleSetupActionFile): void {
    const path = this.path();
    mkdirSync(join(this.scopeRoot, ".kota"), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
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
