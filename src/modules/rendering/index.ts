/**
 * Rendering module — one typed vocabulary, one pure renderer, one
 * terminal transport. Every KOTA surface that produces operator-facing
 * output routes through this module instead of writing raw ANSI or
 * padding to the stream itself.
 *
 * Primitives, theme, and transport are exported from their files so
 * call sites import the small surface they need rather than pulling a
 * monolithic facade. The module also contributes a `RenderingProvider`
 * during `onLoad` so `src/core/loop/loop-constructor.ts` and the
 * `repl` module resolve the default CLI transport and REPL chrome
 * through the provider registry instead of importing
 * `#modules/rendering/*` directly.
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { RENDERING_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";

export { CliTransport } from "./cli-transport.js";
export * from "./primitives.js";
export * from "./render.js";
export { createRenderingProvider } from "./rendering-provider.js";
export * from "./theme.js";
export * from "./transport.js";

const renderingModule: KotaModule = {
  name: "rendering",
  version: "1.0.0",
  description:
    "Typed terminal rendering: primitive vocabulary, pure renderer, and theme/width-aware transport.",
  onLoad: async (ctx: ModuleContext) => {
    const { createRenderingProvider } = await import("./rendering-provider.js");
    ctx.registerProvider(RENDERING_PROVIDER_TOKEN, createRenderingProvider());
  },
};

export default renderingModule;
