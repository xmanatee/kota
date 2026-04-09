import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Assessment } from "./guardrails.js";
import { AuditStore, getAuditStore, initAuditStore, resetAuditStore } from "./modules/guardrails-audit/store.js";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "audit-test-"));
}

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
	return {
		tool: "shell",
		risk: "moderate",
		policy: "allow",
		reason: "shell execution",
		...overrides,
	};
}

describe("AuditStore", () => {
	let tmpDir: string;
	let store: AuditStore;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		store = new AuditStore(tmpDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates .kota directory and audit.jsonl on first record", () => {
		store.record(makeAssessment());
		const path = store.getPath();
		expect(path).toContain(".kota/audit.jsonl");
		const content = readFileSync(path, "utf-8");
		expect(content.trim()).toBeTruthy();
	});

	it("records assessment as JSONL entry", () => {
		store.record(makeAssessment({ tool: "file_read", risk: "safe", policy: "allow", reason: "read-only tool" }));
		const entries = store.query();
		expect(entries).toHaveLength(1);
		expect(entries[0].tool).toBe("file_read");
		expect(entries[0].risk).toBe("safe");
		expect(entries[0].policy).toBe("allow");
		expect(entries[0].reason).toBe("read-only tool");
		expect(entries[0].ts).toBeTruthy();
	});

	it("records session ID when provided", () => {
		store.record(makeAssessment(), "session-123");
		const entries = store.query();
		expect(entries[0].session).toBe("session-123");
	});

	it("omits session field when not provided", () => {
		store.record(makeAssessment());
		const entries = store.query();
		expect(entries[0].session).toBeUndefined();
	});

	it("appends multiple entries", () => {
		store.record(makeAssessment({ tool: "shell" }));
		store.record(makeAssessment({ tool: "file_read" }));
		store.record(makeAssessment({ tool: "grep" }));
		expect(store.query()).toHaveLength(3);
	});

	it("returns entries most recent first", () => {
		store.record(makeAssessment({ tool: "first" }));
		store.record(makeAssessment({ tool: "second" }));
		store.record(makeAssessment({ tool: "third" }));
		const entries = store.query();
		expect(entries[0].tool).toBe("third");
		expect(entries[2].tool).toBe("first");
	});

	it("filters by tool name", () => {
		store.record(makeAssessment({ tool: "shell" }));
		store.record(makeAssessment({ tool: "file_read" }));
		store.record(makeAssessment({ tool: "shell" }));
		const entries = store.query({ tool: "shell" });
		expect(entries).toHaveLength(2);
		expect(entries.every((e) => e.tool === "shell")).toBe(true);
	});

	it("filters by risk level", () => {
		store.record(makeAssessment({ risk: "safe" }));
		store.record(makeAssessment({ risk: "moderate" }));
		store.record(makeAssessment({ risk: "dangerous" }));
		expect(store.query({ risk: "dangerous" })).toHaveLength(1);
	});

	it("filters by policy", () => {
		store.record(makeAssessment({ policy: "allow" }));
		store.record(makeAssessment({ policy: "deny" }));
		store.record(makeAssessment({ policy: "allow" }));
		expect(store.query({ policy: "deny" })).toHaveLength(1);
	});

	it("filters by since timestamp", () => {
		store.record(makeAssessment({ tool: "old" }));
		const sinceTs = new Date().toISOString();
		store.record(makeAssessment({ tool: "new" }));
		const entries = store.query({ since: sinceTs });
		expect(entries.length).toBeGreaterThanOrEqual(1);
		expect(entries.every((e) => e.ts >= sinceTs)).toBe(true);
	});

	it("filters by session", () => {
		store.record(makeAssessment(), "s1");
		store.record(makeAssessment(), "s2");
		store.record(makeAssessment(), "s1");
		expect(store.query({ session: "s1" })).toHaveLength(2);
	});

	it("limits results", () => {
		for (let i = 0; i < 10; i++) store.record(makeAssessment());
		expect(store.query({ limit: 3 })).toHaveLength(3);
	});

	it("combines multiple filters", () => {
		store.record(makeAssessment({ tool: "shell", risk: "moderate" }));
		store.record(makeAssessment({ tool: "shell", risk: "dangerous" }));
		store.record(makeAssessment({ tool: "grep", risk: "moderate" }));
		const entries = store.query({ tool: "shell", risk: "moderate" });
		expect(entries).toHaveLength(1);
	});

	it("returns empty array for non-existent file", () => {
		expect(store.query()).toEqual([]);
	});

	it("skips malformed JSONL lines", () => {
		const kotaDir = join(tmpDir, ".kota");
		mkdirSync(kotaDir, { recursive: true });
		writeFileSync(
			join(kotaDir, "audit.jsonl"),
			'{"tool":"ok","risk":"safe","policy":"allow","reason":"r","ts":"2024-01-01T00:00:00Z"}\nBAD LINE\n',
		);
		const entries = store.query();
		expect(entries).toHaveLength(1);
		expect(entries[0].tool).toBe("ok");
	});

	describe("summarize", () => {
		it("returns aggregate stats", () => {
			store.record(makeAssessment({ tool: "shell", risk: "moderate", policy: "allow" }));
			store.record(makeAssessment({ tool: "shell", risk: "dangerous", policy: "deny" }));
			store.record(makeAssessment({ tool: "grep", risk: "safe", policy: "allow" }));

			const summary = store.summarize();
			expect(summary.total).toBe(3);
			expect(summary.byTool).toEqual({ shell: 2, grep: 1 });
			expect(summary.byRisk).toEqual({ moderate: 1, dangerous: 1, safe: 1 });
			expect(summary.byPolicy).toEqual({ allow: 2, deny: 1 });
		});

		it("respects filters", () => {
			store.record(makeAssessment({ tool: "shell", policy: "allow" }));
			store.record(makeAssessment({ tool: "shell", policy: "deny" }));
			store.record(makeAssessment({ tool: "grep", policy: "allow" }));

			const summary = store.summarize({ tool: "shell" });
			expect(summary.total).toBe(2);
		});

		it("returns zero totals for empty log", () => {
			const summary = store.summarize();
			expect(summary.total).toBe(0);
			expect(summary.byTool).toEqual({});
		});
	});

	describe("trim", () => {
		it("keeps only last N entries", () => {
			for (let i = 0; i < 20; i++) store.record(makeAssessment({ tool: `tool_${i}` }));
			const trimmed = store.trim(10);
			expect(trimmed).toBe(10);
			const entries = store.query();
			expect(entries).toHaveLength(10);
			// Most recent should be tool_19 (reversed)
			expect(entries[0].tool).toBe("tool_19");
		});

		it("no-ops when under limit", () => {
			store.record(makeAssessment());
			expect(store.trim(100)).toBe(0);
		});

		it("no-ops for non-existent file", () => {
			expect(store.trim()).toBe(0);
		});
	});

	describe("clear", () => {
		it("empties the audit log", () => {
			store.record(makeAssessment());
			store.record(makeAssessment());
			store.clear();
			expect(store.query()).toEqual([]);
		});

		it("no-ops for non-existent file", () => {
			store.clear();
			expect(store.query()).toEqual([]);
		});
	});
});

describe("singleton", () => {
	afterEach(() => resetAuditStore());

	it("getAuditStore returns null before init", () => {
		expect(getAuditStore()).toBeNull();
	});

	it("initAuditStore creates and returns store", () => {
		const tmpDir = makeTmpDir();
		try {
			const store = initAuditStore(tmpDir);
			expect(store).toBeInstanceOf(AuditStore);
			expect(getAuditStore()).toBe(store);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("resetAuditStore clears the singleton", () => {
		const tmpDir = makeTmpDir();
		try {
			initAuditStore(tmpDir);
			resetAuditStore();
			expect(getAuditStore()).toBeNull();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
