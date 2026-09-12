import { expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import {
	type DaemonSseEvent,
  daemonEventMatchesScope,
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
			payload: { scopeId: "scope-test", source: "workflow.started", workflow: "build" },
		},
		{ type: "workflow.completed", payload: completed },
		{
			type: "queue.changed",
			payload: {
				scopeId: "scope-test",
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


it("rejects foreign and unattributed scoped events without suppressing declared daemon events", () => {
  const events: DaemonSseEvent[] = [
    { type: "session.unregistered", payload: { scopeId: "a", id: "a" } },
    { type: "session.unregistered", payload: { scopeId: "b", id: "b" } },
    // Malformed wire input must not acquire daemon-wide visibility.
    JSON.parse('{"type":"session.unregistered","payload":{"id":"missing"}}'),
    JSON.parse('{"type":"session.unregistered","payload":{"scopeId":null,"id":"null"}}'),
    { type: "queue.changed", payload: { scopeId: "b", source: "workflow.started", workflow: "build" } },
    { type: "scope.lifecycle.changed", payload: { transition: "registered", affectedScopeId: "b", directoryRoot: "/b", displayName: "B" } },
  ];
  expect(events.filter(event => daemonEventMatchesScope(event, "a"))).toEqual([events[0], events[5]]);
  expect(events.filter(event => daemonEventMatchesScope(event, null))).toEqual(events);
});
