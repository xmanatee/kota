/**
 * CSS styles for the KOTA web UI.
 * Assembles section modules into a single WEB_UI_CSS export.
 */

import { STYLES_CHAT_CSS } from "./styles-chat.js";
import { STYLES_LAYOUT_CSS } from "./styles-layout.js";
import { STYLES_PANELS_CSS } from "./styles-panels.js";
import { STYLES_RUNS_CSS } from "./styles-runs.js";

export const WEB_UI_CSS = /* css */ `
${STYLES_LAYOUT_CSS}
${STYLES_CHAT_CSS}
${STYLES_RUNS_CSS}
${STYLES_PANELS_CSS}
`;
