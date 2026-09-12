import { beforeEach, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { clearSessions } from "./handler.js";
import {
	type CreatedWebhookSession,
	invokeHandler,
	makeSessionFactory,
	makeStubCtx,
} from "./handler-test-support.integration.js";

const config = { sources: { github: { agent: "builder" }, ci: { agent: "reviewer" } } };
beforeEach(clearSessions);

it.each([
	{ path: "/api/channels/webhook/github", header: "ci", source: "ci", expected: "github" },
	{ path: undefined, header: "ci", source: "github", expected: "ci" },
	{ path: undefined, header: undefined, source: "github", expected: "github" },
])("routes source inputs with path/header/payload precedence: $expected", async ({
	path,
	header,
	source,
	expected,
}) => {
	const created: CreatedWebhookSession[] = [];
	const res = await invokeHandler(
		makeStubCtx(undefined, config),
		JSON.stringify({ message: "Build passed", source }),
		header ? { "x-webhook-source": header } : {},
		path,
		makeSessionFactory(created),
	);
	expect(res.statusCode).toBe(201);
	expect(JSON.parse(res.body!)).toMatchObject({
		source: expected,
		response: "agent response text",
	});
	expect(created[0]).toMatchObject({
		label: `webhook:${expected}:${config.sources[expected as keyof typeof config.sources].agent}`,
		autonomyMode: "supervised",
	});
	expect(created[0].send).toHaveBeenCalledWith(expect.stringContaining("Build passed"));
});

it("reuses a source across input forms, isolates another source, and reports the resulting sessions", async () => {
	const bus = new EventBus();
	const events: Record<string, unknown>[] = [];
	bus.on("webhook-channel.session", (payload) => events.push(payload));
	const ctx = makeStubCtx(bus, config);
	const first = await invokeHandler(
		ctx,
		JSON.stringify({ message: "First" }),
		{},
		"/api/channels/webhook/github",
	);
	const next = await invokeHandler(ctx, JSON.stringify({ message: "Second" }), {
		"x-webhook-source": "github",
	});
	const other = await invokeHandler(
		ctx,
		JSON.stringify({ message: "Another source", source: "ci" }),
	);
	expect([first.statusCode, next.statusCode, other.statusCode]).toEqual([201, 200, 201]);
	const firstId = JSON.parse(first.body!).sessionId;
	expect(firstId).toBeTruthy();
	expect(JSON.parse(next.body!).sessionId).toBe(firstId);
	expect(JSON.parse(other.body!).sessionId).not.toBe(firstId);
	expect(events).toMatchObject([
		{ source: "github", resumed: false },
		{ source: "github", resumed: true },
		{ source: "ci", resumed: false },
	]);
});

it.each([
	{ path: "/api/channels/webhook/unknown", header: undefined, source: "github" },
	{ path: undefined, header: "unknown", source: "github" },
	{ path: undefined, header: undefined, source: "unknown" },
])("rejects an unknown selected source without opening a session: $path $source", async ({
	path,
	header,
	source,
}) => {
	const created: CreatedWebhookSession[] = [];
	const res = await invokeHandler(
		makeStubCtx(undefined, config),
		JSON.stringify({ message: "Unknown", source }),
		header ? { "x-webhook-source": header } : {},
		path,
		makeSessionFactory(created),
	);
	expect(res.statusCode).toBe(404);
	expect(JSON.parse(res.body!).error).toContain("Unknown source");
	expect(created).toEqual([]);
});

it.each([
	false,
	true,
])("accepts direct requests without source configuration (source hints: %s)", async (withHints) => {
	const res = await invokeHandler(
		makeStubCtx(),
		JSON.stringify({ message: "Direct request", ...(withHints ? { source: "github" } : {}) }),
		withHints ? { "x-webhook-source": "ci" } : {},
	);
	expect(res.statusCode).toBe(201);
	expect(JSON.parse(res.body!).sessionId).toBeTruthy();
	expect(JSON.parse(res.body!).source).toBeUndefined();
});
