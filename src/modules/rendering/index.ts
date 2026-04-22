/**
 * Rendering module — one typed vocabulary, one pure renderer, one
 * terminal transport. Every KOTA surface that produces operator-facing
 * output routes through this module instead of writing raw ANSI or
 * padding to the stream itself.
 *
 * Primitives, theme, and transport are exported from their files so
 * call sites import the small surface they need rather than pulling a
 * monolithic facade.
 */

import type { KotaModule } from "#core/modules/module-types.js";

export * from "./primitives.js";
export * from "./render.js";
export * from "./theme.js";
export * from "./transport.js";

const renderingModule: KotaModule = {
  name: "rendering",
  version: "1.0.0",
  description:
    "Typed terminal rendering: primitive vocabulary, pure renderer, and theme/width-aware transport.",
};

export default renderingModule;
