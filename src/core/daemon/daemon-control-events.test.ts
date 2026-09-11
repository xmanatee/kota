import { expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import {
	type DaemonSseEvent,
	subscribeToDaemonEvents,
} from "./daemon-control-events.js";

it("forwards workflow events before queue invalidation and releases the subscription", () => {
	const bus = new EventBus();
	const received: DaemonSseEvent[] = [];
	const stop = subscribeToDaemonEvents(bus, (event) => received.push(event));
	const started: BusEvents["workflow.started"] = {
		scopeId: "scope-test",
		workflow: "build",
		runId: "run-1",
		triggerEvent: "manual",
		definitionPath: "workflow.ts",
		runDir: "runs/run-1",
		startedAt: "2026-09-11T00:00:00Z",
	};
	const completed: BusEvents["workflow.completed"] = {
		scopeId: started.scopeId,
		workflow: started.workflow,
		runId: started.runId,
		triggerEvent: started.triggerEvent,
		definitionPath: started.definitionPath,
		runDir: started.runDir,
		status: "success",
		durationMs: 10,
		tags: [],
	};

	bus.emit("workflow.started", started);
	bus.emit("workflow.completed", completed);
	expect(received).toEqual([
		{ type: "workflow.started", payload: started },
		{
			type: "queue.changed",
			payload: { source: "workflow.started", workflow: "build" },
		},
		{ type: "workflow.completed", payload: completed },
		{
			type: "queue.changed",
			payload: {
				source: "workflow.completed",
				workflow: "build",
				status: "success",
			},
		},
	]);

	stop();
	bus.emit("workflow.started", started);
	bus.emit("workflow.completed", completed);
	expect(received).toHaveLength(4);
});
