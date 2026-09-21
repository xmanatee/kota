import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { makeCalendarCreateTools } from "./calendar-create.js";
import { CalendarProvider, meeting } from "./calendar-provider.integration.js";

let dir: string;
let provider: CalendarProvider;
let store: IdempotencyStore;
function tools(getToken = async () => "test-token") {
  return makeCalendarCreateTools({ getToken, calendarId: "primary", defaultScopeId: "scope-a", resolveStore: (scope) => scope === "scope-a" ? store : null, http: provider.http });
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "calendar-create-"));
  provider = new CalendarProvider();
  store = new IdempotencyStore(dir, "scope-a");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("reports pre-submission failures without provider writes", async () => {
  const [create] = tools(async () => { throw new Error("Secret credential failure"); });
  const result = await create.runner(meeting());
  expect(result.structuredContent).toMatchObject({ outcome: "not_submitted" });
  expect(result.content).not.toContain("Secret");
  expect(provider.posts).toHaveLength(0);
});

it.each(["invalid-json", "empty-body"] as const)("does not claim success from %s; subsequent reads verify the event", async (mode) => {
  provider.mode = mode;
  const [create, check] = tools();
  const input = meeting();
  expect((await create.runner(input)).structuredContent).toMatchObject({ outcome: "uncertain" });
  expect((await check.runner(input)).structuredContent).toMatchObject({ outcome: "confirmed" });
  expect(provider.posts).toHaveLength(1);
  expect(provider.posts[0].body.attendees).toEqual([{ email: "guest@example.com" }]);
});

it("rejects changed parameters, account and calendar after a no-commit failure across store reopen", async () => {
  const input = meeting();
  provider.mode = "lost-uncommitted";
  await tools()[0].runner(input);
  store = new IdempotencyStore(dir, "scope-a", () => new Date("2040-01-01"));
  const [create] = tools();
  for (const changed of [{ ...input, summary: "Changed" }, { ...input, calendarId: "shared@example.com" }]) {
    expect((await create.runner(changed)).structuredContent).toMatchObject({ outcome: "conflict" });
  }
  provider.account = "different@example.com";
  expect((await create.runner(input)).structuredContent).toMatchObject({ outcome: "conflict" });
  expect(provider.posts).toHaveLength(1);
  expect(store.list()[0].retention).toEqual({ kind: "retain" });
});

it("never confirms a collision or a subsequently changed provider event", async () => {
  provider.mode = "collision";
  const input = meeting();
  const [create, check] = tools();
  expect((await create.runner(input)).structuredContent).toMatchObject({ outcome: "conflict" });
  expect((await check.runner(input)).structuredContent).toMatchObject({ outcome: "conflict" });
  expect(provider.posts).toHaveLength(1);
});

it("does not write when reads are unavailable or the scope store is absent", async () => {
  const [create] = tools();
  provider.readStatus = 503;
  expect((await create.runner(meeting())).structuredContent).toMatchObject({ outcome: "uncertain" });
  expect((await create.runner(meeting(), { scopeId: "scope-b" })).structuredContent).toMatchObject({ outcome: "not_submitted" });
  expect(provider.posts).toHaveLength(0);
});

it("does not accept another scope's event even if the provider returns it", async () => {
  const input = meeting();
  const [create, check] = tools();
  await create.runner(input);
  const event = [...provider.events.values()][0];
  event.extendedProperties.private.kotaOperation = "another-scope";
  expect((await check.runner(input)).structuredContent).toMatchObject({ outcome: "conflict" });
  expect(provider.posts).toHaveLength(1);
});

it("checks current fields and cancelled events instead of replaying local success", async () => {
  const input = meeting();
  const [create, check] = tools();
  await create.runner(input);
  const event = [...provider.events.values()][0];
  event.summary = "Rescheduled by someone else";
  expect((await check.runner(input)).structuredContent).toMatchObject({ outcome: "conflict" });
  event.status = "cancelled";
  expect((await create.runner(input)).structuredContent).toMatchObject({ outcome: "uncertain" });
  expect(provider.posts).toHaveLength(1);
});

it("rejects unkeyed calls, unknown caching keys and invalid time ranges before network access", async () => {
  const [create] = tools();
  for (const input of [{ ...meeting(), operationId: undefined }, { ...meeting(), idempotencyKey: "cached-error" }, { ...meeting(), end: "2020-01-01T00:00:00Z" }]) {
    expect((await create.runner(input)).is_error).toBe(true);
  }
  expect(provider.telemetry).toHaveLength(0);
});

it.each(["creator", "organizer"] as const)("rejects an event attributed to a different %s", async (field) => {
  const input = meeting();
  const [create, check] = tools();
  await create.runner(input);
  [...provider.events.values()][0][field].email = "someone-else@example.com";
  expect((await check.runner(input)).structuredContent).toMatchObject({ outcome: "conflict" });
  expect(provider.posts).toHaveLength(1);
});

it("separates the same operation UUID across real scope stores on a shared calendar", async () => {
  const input = { ...meeting(), calendarId: "shared@example.com" };
  await tools()[0].runner(input);
  const secondStore = new IdempotencyStore(join(dir, "second"), "scope-b");
  const [create, check] = makeCalendarCreateTools({ getToken: async () => "test-token", calendarId: "primary", defaultScopeId: "scope-b", resolveStore: () => secondStore, http: provider.http });
  expect((await check.runner(input)).structuredContent).toMatchObject({ outcome: "absent" });
  expect((await create.runner(input)).structuredContent).toMatchObject({ outcome: "confirmed" });
  expect(provider.events.size).toBe(2);
  expect(provider.posts[0].body.id).not.toBe(provider.posts[1].body.id);
});

it("fails closed on an expiring operation record instead of claiming fresh work", async () => {
  const input = meeting();
  store.record({ scopeId: "scope-a", operation: "provider-write", key: `google-calendar:create:${input.operationId}`, parameterFingerprint: "old", result: {}, retention: { kind: "expire-after-ms", durationMs: 0 } });
  store = new IdempotencyStore(dir, "scope-a");
  expect((await tools()[0].runner(input)).structuredContent).toMatchObject({ outcome: "uncertain" });
  expect(provider.posts).toHaveLength(0);
});

it("verifies a matching event after a conflict response rather than accepting the status alone", async () => {
  provider.mode = "collision-matching";
  const result = await tools()[0].runner(meeting());
  expect(result.structuredContent).toMatchObject({ outcome: "confirmed" });
  expect(provider.posts).toHaveLength(1);
});
