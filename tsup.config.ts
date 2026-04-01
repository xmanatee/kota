import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/cli.ts", "src/validate-queue.ts"],
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    clean: true,
    sourcemap: true,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: ["src/extension-api.ts"],
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    clean: false,
    sourcemap: true,
    dts: true,
  },
  {
    entry: ["src/workflow-testing/testing-api.ts"],
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    clean: false,
    sourcemap: true,
    dts: true,
  },
]);
