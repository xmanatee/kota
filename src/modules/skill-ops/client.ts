/**
 * Skill-ops client contracts.
 *
 * The skill-ops module owns the `skills` KotaClient namespace end-to-end:
 * the per-skill summary shape, the list/import result envelopes, the
 * import options, and the `SkillsClient` interface itself. The aggregate
 * `KotaClient` interface in `src/core/server/kota-client.ts` composes this
 * contract by importing `SkillsClient` from this module instead of
 * declaring the shapes inline.
 *
 * The local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) both realize
 * `SkillsClient`; the `kota skill` CLI consumes them through
 * `ctx.client.skills`.
 */

/**
 * A registered skill as the CLI surfaces it. `source` is the contributing
 * module name, or the literal string `"imported"` for skills installed under
 * `.kota/skills/` via `kota skill import`.
 */
export type SkillSummary = {
  name: string;
  source: string;
  description?: string;
  promptPath: string;
  roles?: string[];
};

export type SkillsListResult = {
  skills: SkillSummary[];
};

export type SkillImportOptions = {
  /** Override the skill name (and on-disk filename) declared in frontmatter. */
  name?: string;
};

/**
 * Result of `skills.import`.
 *
 * `fetch_failed` covers HTTP and missing-local-file errors uniformly;
 * `missing_name` fires when the skill source has no `name` frontmatter and
 * the caller passed no override. The CLI maps both to a single error
 * message regardless of which transport answered.
 */
export type SkillImportResult =
  | { ok: true; name: string; path: string }
  | {
      ok: false;
      reason: "fetch_failed" | "missing_name";
      message: string;
    };

/**
 * Skill operations.
 *
 * `list` enumerates every registered skill — module-contributed plus
 * imported — with the contributor name. `import` fetches a skill from a URL
 * or local file and writes it under `.kota/skills/`.
 */
export interface SkillsClient {
  list(): Promise<SkillsListResult>;
  import(source: string, options?: SkillImportOptions): Promise<SkillImportResult>;
}
