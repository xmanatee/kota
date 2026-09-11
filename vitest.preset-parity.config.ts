import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: undefined,
    include: ["src/preset-parity.live.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
