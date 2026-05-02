/**
 * Strategic vs fan-out classification for explorer-created and builder-closed
 * tasks. Heuristic and intentionally narrow: areas that move the architecture
 * front are "strategic", thin-client surface fan-out is "fan-out", and
 * everything else is "other".
 *
 * Inputs are area + title + summary together because area alone misclassifies
 * surface-parity tasks filed under non-client areas (e.g. an `area: modules`
 * task whose title is "Replace macOS workflow trigger text entry with
 * definitions picker" is fan-out, not strategic). The classification ships in
 * the operator-facing report so an operator can audit and refine it instead
 * of it being hidden inside agent traces.
 */

export type AreaClassification = "strategic" | "fan-out" | "other";

const STRATEGIC_AREAS: ReadonlySet<string> = new Set([
  "architecture",
  "core",
  "modules",
  "autonomy",
]);

const FAN_OUT_AREAS: ReadonlySet<string> = new Set(["client", "channel"]);

/**
 * Surface-parity markers: phrases whose presence in title or summary indicates
 * the task is shaping a user-facing client/channel surface (and is therefore
 * fan-out) even when its `area` field is a strategic bucket. The list is
 * intentionally specific — generic words like "view" or "form" are matched
 * only when paired with a surface qualifier so backend tasks that mention
 * "view" in another sense are not misclassified.
 */
const SURFACE_PARITY_MARKERS: readonly RegExp[] = [
  /\b(macos|ios|swiftui|swift)\b/,
  /\bweb (?:ui|dashboard)\b/,
  /\bdashboard\b/,
  /\btelegram\b/,
  /\bslack\b/,
  /\boperator (?:client|ui|surface)/,
  /\bnative client\b/,
  /\bclient (?:protocol|state|wire|surface|namespace|context|view|form|picker|panel|page|menu)\b/,
  /\bworkflow trigger (?:form|picker|entry|panel|page|view)\b/,
  /\brun comparison\b/,
  /\bui (?:form|view|picker|panel|page|menu|toggle|button|modal|entry)\b/,
  /\b(?:wire|hook) (?:up|into) the (?:macos|ios|web|dashboard|telegram|slack)/,
];

export type TaskShapeInput = {
  area: string;
  title: string;
  summary: string;
};

export function classifyTaskShape(input: TaskShapeInput): AreaClassification {
  const area = input.area.trim().toLowerCase();
  if (FAN_OUT_AREAS.has(area)) return "fan-out";

  const text = `${input.title} ${input.summary}`.toLowerCase();
  if (SURFACE_PARITY_MARKERS.some((re) => re.test(text))) return "fan-out";

  if (STRATEGIC_AREAS.has(area)) return "strategic";
  return "other";
}
