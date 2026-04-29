/**
 * Mechanical guard against raw-string provider registrations.
 *
 * The typed `ProviderToken` protocol already rejects raw `string` ids at
 * compile time, but TypeScript-clean refactors can still slip a string
 * literal back into a typed seam (e.g. a typed token whose value type is
 * `unknown` or `Record<string, unknown>` loses some of the brand pressure).
 * This test scans repo source for the call shapes the protocol replaces and
 * fails when a new raw-string registration appears outside the small
 * approved list.
 *
 * If a new genuine call site needs to register or look up by raw string id
 * (today only the `module-loader.ts` config-driven activation path and the
 * registry's own diagnostic `introspect` accessor), add it here with a
 * short rationale rather than relaxing the regex.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_SRC = fileURLToPath(new URL("../../", import.meta.url));

const REGISTER_STRING_LITERAL =
	/(?:ctx\.registerProvider|registry\.register|\.registerProvider|reg\.register|reg2\.register|registry\.get|registry\.getByName|registry\.setActive|registry\.list)\s*\(\s*"[^"]+"/g;

/**
 * Files allowed to use raw string ids on the registry surface. Add a new
 * entry only with rationale.
 */
const ALLOWED_FILES = new Set<string>([
	// The registry implementation itself maintains string-keyed maps.
	"core/modules/provider-registry.ts",
	// The token module shows the brand cast literally.
	"core/modules/provider-token.ts",
	// This guard test exercises both shapes intentionally.
	"core/modules/provider-registration-guard.test.ts",
	// Type-mismatch fixture intentionally exercises a string id with
	// `@ts-expect-error` to prove the brand rejects it.
	"core/modules/provider-token.test.ts",
]);

function walkSource(dir: string, into: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			if (entry === "node_modules" || entry === "dist") continue;
			walkSource(full, into);
			continue;
		}
		const ext = extname(entry);
		if (ext === ".ts" || ext === ".tsx") into.push(full);
	}
	return into;
}

/**
 * Strip `// line` comments and `/* block *​/` comments before scanning so
 * docstring examples ("modules contribute X via `ctx.registerProvider(...)`")
 * do not register as violations. Strings are not preserved, but the regex
 * we run against the result keys on the call shape, so quoted strings inside
 * other code are still matched if present.
 */
function stripComments(source: string): string {
	let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
	out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	return out;
}

describe("provider registration guard", () => {
	it("no raw string-literal registry calls outside the approved list", () => {
		const violations: string[] = [];
		for (const file of walkSource(REPO_SRC)) {
			const rel = relative(REPO_SRC, file).replaceAll("\\", "/");
			if (ALLOWED_FILES.has(rel)) continue;
			const content = stripComments(readFileSync(file, "utf8"));
			REGISTER_STRING_LITERAL.lastIndex = 0;
			const matches = content.match(REGISTER_STRING_LITERAL);
			if (matches) {
				for (const match of matches) {
					violations.push(`${rel}: ${match}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});
});
