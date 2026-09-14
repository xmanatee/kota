#!/usr/bin/env node

// Native type stripping keeps recovery independent of the package graph. The
// repository's tsx loader is registered only after interrupted installs recover.
import { fileURLToPath } from "node:url";
import { recoverPreparationBeforeCliImports } from "../src/core/workflow/repository-preparation-recovery.ts";

await recoverPreparationBeforeCliImports(fileURLToPath(new URL("../", import.meta.url)));
const { register } = await import("tsx/esm/api");
register();
await import("../src/cli.ts");
