/**
 * Composition E2E tests — verify that individually-tested capabilities
 * compose into working multi-step workflows.
 *
 * Each scenario exercises a realistic user workflow through the full
 * AgentSession.send() path using the mock Anthropic client. The LLM
 * responses are pre-configured, but all tool execution is real — files
 * are created, edited, read, and searched on disk.
 *
 * Why these tests matter: SWE-EVO (arXiv 2512.18470) shows that
 * single-task evaluation overstates capability 3x for compositional
 * work. These tests prove the agent's capabilities work together.
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { TaskStore } from "#core/daemon/task-store.js";
import { AgentSession } from "#core/loop/loop.js";
import { BufferTransport } from "#core/loop/transport.js";
import {
	createMockClient,
	type MockApiCall,
} from "#core/model/mock-client.js";
import { TASK_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import { setSkipConfirmations } from "#core/util/confirm.js";

vi.spyOn(console, "error").mockImplementation(() => {});

// The sandbox boundary has its own focused launch tests. Keep these composition
// tests exercising the real shell while avoiding a sandbox nested inside the
// host test runner's sandbox, which macOS rejects before the command can start.
vi.mock("#core/agent-harness/machine-authority-sandbox.js", () => ({
	buildMachineAuthoritySandboxLaunch: (
		executable: string,
		args: readonly string[],
	) => ({ ok: true, command: executable, args: [...args] }),
	buildShellMachineAuthoritySandboxLaunch: (command: string) => ({
		ok: true,
		command: "sh",
		args: ["-c", command],
	}),
}));

// Tests write files to /tmp which is outside the scope directory.
// Skip confirmations so the confirm gate doesn't auto-reject those writes.
beforeEach(() => setSkipConfirmations(true));
afterEach(() => setSkipConfirmations(false));

export function createTestSession(
	responses: Parameters<typeof createMockClient>[0],
	opts?: { verbose?: boolean },
): { session: AgentSession; transport: BufferTransport; calls: MockApiCall[] } {
	const [client, calls] = createMockClient(responses);
	const transport = new BufferTransport();
	const session = new AgentSession({
		autonomyMode: "autonomous",
		client,
		transport,
		model: "test-model",
		noHistory: true,
		reflectionEnabled: false,
		verbose: opts?.verbose ?? false,
	});
	const registry = session.moduleLoader.getProviderRegistry();
	const taskStore = new TaskStore(process.cwd(), null);
	registry.register(TASK_PROVIDER_TOKEN, "composition-test", {
		collection: taskStore.collection,
		mutations: {
			add: async (task, options) => taskStore.add(task, options),
			update: async (id, changes) => taskStore.update(id, changes),
		},
		maintenance: {
			clear: async () => taskStore.clear(),
			archiveCompleted: async () => taskStore.archiveCompleted(),
		},
	});
	registry.setActive(TASK_PROVIDER_TOKEN, "composition-test");
	return { session, transport, calls };
}

export function makeTempDir(suffix: string): string {
	const dir = join(tmpdir(), `kota-comp-${suffix}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}
