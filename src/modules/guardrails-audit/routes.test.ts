import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditFilter } from "#core/tools/audit-store.js";
import { makeListAuditHandler } from "./routes.js";

function mockReqRes(url = "/api/audit") {
	const result = { status: 0, body: null as unknown };
	const req = { url } as IncomingMessage;
	const res = {
		setHeader: vi.fn(),
		writeHead: (s: number) => {
			result.status = s;
		},
		end: (data: string) => {
			result.body = JSON.parse(data);
		},
		on: vi.fn(),
	} as unknown as ServerResponse;
	return { req, res, result };
}

type FakeStore = { query: (filter?: AuditFilter) => AuditEntry[] };

function makeStore(entries: AuditEntry[] = [], spy?: (filter?: AuditFilter) => AuditEntry[]): FakeStore {
	const query = spy ?? ((_filter?: AuditFilter) => entries);
	return { query };
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
	return {
		ts: "2026-01-01T00:00:00Z",
		tool: "bash",
		risk: "safe",
		policy: "allow",
		reason: "Safe read-only command",
		...overrides,
	};
}

describe("audit routes", () => {
	describe("handleListAudit", () => {
		it("returns 200 with empty entries when store is empty", () => {
			const store = makeStore([]);
			const { req, res, result } = mockReqRes();
			makeListAuditHandler(() => store)(req, res, {});
			expect(result.status).toBe(200);
			const body = result.body as { entries: unknown[] };
			expect(body.entries).toEqual([]);
		});

		it("returns entries from the store", () => {
			const entry = makeEntry({ tool: "file_read", risk: "moderate", policy: "confirm" });
			const store = makeStore([entry]);
			const { req, res, result } = mockReqRes();
			makeListAuditHandler(() => store)(req, res, {});
			expect(result.status).toBe(200);
			const body = result.body as { entries: AuditEntry[] };
			expect(body.entries).toHaveLength(1);
			expect(body.entries[0].tool).toBe("file_read");
			expect(body.entries[0].risk).toBe("moderate");
			expect(body.entries[0].policy).toBe("confirm");
		});

		it("passes risk filter from query string to store", () => {
			const calls: Array<AuditFilter | undefined> = [];
			const store: FakeStore = {
				query: (f) => { calls.push(f); return []; },
			};
			const { req, res } = mockReqRes("/api/audit?risk=dangerous");
			makeListAuditHandler(() => store)(req, res, {});
			expect(calls[0]).toMatchObject({ risk: "dangerous" });
		});

		it("passes policy filter from query string to store", () => {
			const calls: Array<AuditFilter | undefined> = [];
			const store: FakeStore = {
				query: (f) => { calls.push(f); return []; },
			};
			const { req, res } = mockReqRes("/api/audit?policy=deny");
			makeListAuditHandler(() => store)(req, res, {});
			expect(calls[0]).toMatchObject({ policy: "deny" });
		});

		it("defaults limit to 200", () => {
			const calls: Array<AuditFilter | undefined> = [];
			const store: FakeStore = {
				query: (f) => { calls.push(f); return []; },
			};
			const { req, res } = mockReqRes("/api/audit");
			makeListAuditHandler(() => store)(req, res, {});
			expect(calls[0]).toMatchObject({ limit: 200 });
		});

		it("accepts custom limit from query string", () => {
			const calls: Array<AuditFilter | undefined> = [];
			const store: FakeStore = {
				query: (f) => { calls.push(f); return []; },
			};
			const { req, res } = mockReqRes("/api/audit?limit=50");
			makeListAuditHandler(() => store)(req, res, {});
			expect(calls[0]).toMatchObject({ limit: 50 });
		});

		it("returns 500 when store throws", () => {
			const store: FakeStore = {
				query: () => { throw new Error("disk error"); },
			};
			const { req, res, result } = mockReqRes();
			makeListAuditHandler(() => store)(req, res, {});
			expect(result.status).toBe(500);
			expect((result.body as { error: string }).error).toBe("disk error");
		});
	});
});
