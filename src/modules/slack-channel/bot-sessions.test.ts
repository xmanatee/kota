import { expect, it, vi } from "vitest";
import {
	httpRequests,
	MockWebSocket,
	makeBot,
	sessions,
	setupSlackBotTestHooks,
} from "./bot-test-support.js";

setupSlackBotTestHooks();

// Socket routing must deliver model output to the incoming DM and keep the
// per-user conversation cache separate; durable replacement belongs to the
// shared session-factory continuity journey.
it("delivers repeated DMs, isolates users, and withdraws closed scope sessions", async () => {
	const bot = makeBot();
	const running = bot.start();
	try {
		await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
		const ws = MockWebSocket.instances[0];
		for (const [index, user, channel, text] of [
			[1, "U1", "D1", "Remember cobalt maple"],
			[2, "U1", "D1", "Recall the phrase"],
			[3, "U2", "D2", "A separate conversation"],
		] as const) {
			ws.simulateMessage({
				type: "events_api",
				envelope_id: `env-${index}`,
				payload: {
					team_id: "T-TEST",
					event: { type: "message", text, user, channel, channel_type: "im" },
				},
			});
			await vi.waitFor(() =>
				expect(
					httpRequests.filter(({ body }) => body.text === "Delivered model reply"),
				).toHaveLength(index),
			);
			expect(httpRequests.at(-1)?.body).toMatchObject({ channel, text: "Delivered model reply" });
			const messages = JSON.stringify(sessions.modelRequests.at(-1)?.messages);
			expect(messages).toContain(text);
			if (index === 2) expect(messages).toContain("cobalt maple");
			if (index === 3) expect(messages).not.toContain("cobalt maple");
		}
		expect(bot.listScopeSessionIds("test-scope")).toEqual([
			"slack:U1:test-scope",
			"slack:U2:test-scope",
		]);
		bot.closeScopeSessions("test-scope");
		expect(bot.listScopeSessionIds("test-scope")).toEqual([]);
	} finally {
		bot.stop();
		await running;
	}
});
