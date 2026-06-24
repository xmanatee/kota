import { NO_COLOR_THEME, renderToString } from "#modules/rendering/index.js";
import type { AutonomyReportData } from "./aggregate.js";
import { renderAutonomyReport } from "./render.js";

export function renderReport(data: AutonomyReportData): string {
  return renderToString(renderAutonomyReport(data), {
    width: 100,
    theme: NO_COLOR_THEME,
  });
}

export function section(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return text.slice(startIndex, endIndex);
}
