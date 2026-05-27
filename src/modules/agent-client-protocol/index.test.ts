import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { DaemonSseStreamEvent } from "#core/daemon/daemon-control.js";
import type {
  DaemonRequestInit,
  DaemonTransport,
} from "#core/server/daemon-transport.js";
import {
  type AcpDaemonClient,
  type AcpProject,
  type AcpProjectList,
  HttpAcpDaemonClient,
  type PromptSessionArgs,
  type PromptSessionResult,
} from "./daemon-adapter.js";
import { agentMessageUpdate } from "./protocol.js";
import { AgentClientProtocolServer } from "./server.js";
import { runAgentClientProtocolStdio } from "./stdio.js";

const PROJECT_DIR = "/Users/example/project";
const SECOND_PROJECT_DIR = "/Users/example/other-project";

class CaptureStream {
  readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  text(): string {
    return this.chunks.join("");
  }

  messages(): any[] {
    return this.text()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

class FakeDaemon implements AcpDaemonClient {
  projectList: AcpProjectList = {
    projects: [
      {
        projectId: "proj-1",
        projectDir: PROJECT_DIR,
        displayName: "project",
      },
    ],
    defaultProjectId: "proj-1",
    activeProjectId: null,
  };
  listProjectsCalls = 0;
  createSessionCalls: AcpProject[] = [];
  promptCalls: PromptSessionArgs[] = [];
  cancelCalls: string[] = [];
  closeCalls: string[] = [];
  nextSessionId = "kota-session-1";
  promptStarted: Promise<void> = Promise.resolve();
  resolvePromptStarted: () => void = () => {};
  promptMode: "stream" | "hang" = "stream";

  constructor() {
    this.resetPromptStarted();
  }

  async listProjects() {
    this.listProjectsCalls++;
    return this.projectList;
  }

  async createSession(project: AcpProject) {
    this.createSessionCalls.push(project);
    return { sessionId: this.nextSessionId };
  }

  async promptSession(args: PromptSessionArgs): Promise<PromptSessionResult> {
    this.promptCalls.push(args);
    this.resolvePromptStarted();
    if (this.promptMode === "hang") {
      await new Promise((_resolve, reject) => {
        args.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    }
    args.onUpdate(agentMessageUpdate(args.sessionId, "streamed response"));
    return { stopReason: "end_turn" };
  }

  async cancelSession(sessionId: string): Promise<void> {
    this.cancelCalls.push(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    this.closeCalls.push(sessionId);
  }

  resetPromptStarted(): void {
    this.promptStarted = new Promise((resolve) => {
      this.resolvePromptStarted = resolve;
    });
  }
}

class FakeTransport implements DaemonTransport {
  readonly baseUrl = "http://127.0.0.1:1234";
  readonly calls: Array<{ path: string; init?: RequestInit }> = [];

  authHeaders(): Record<string, string> {
    return {};
  }

  async request<T>(
    _method: string,
    _path: string,
    _body?: unknown,
    _init?: DaemonRequestInit,
  ): Promise<T | null> {
    return null;
  }

  async requestStrict<T>(
    _method: string,
    _path: string,
    _body?: unknown,
    _init?: DaemonRequestInit,
  ): Promise<T> {
    throw new Error("not implemented");
  }

  async *events(): AsyncGenerator<DaemonSseStreamEvent> {}

  async fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    this.calls.push({ path, init });
    if (path === "/sessions?projectId=proj-1") {
      return new Response(JSON.stringify({ session_id: "created-session" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/sessions/s1/chat") {
      return new Response(
        [
          'event: text\ndata: {"type":"text","content":"hello"}',
          'event: done\ndata: {"session_id":"s1","result":"hello"}',
          "",
        ].join("\n\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }
    if (path === "/sessions/s1/cancel") {
      return new Response(null, { status: 204 });
    }
    if (path === "/sessions/s1") {
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 404 });
  }
}

function request(id: number, method: string, params?: object): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params ? { params } : {}),
  });
}

function notification(method: string, params?: object): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method,
    ...(params ? { params } : {}),
  });
}

async function initializedServer(fake = new FakeDaemon()) {
  const output = new CaptureStream();
  const error = new CaptureStream();
  const server = new AgentClientProtocolServer({
    output,
    error,
    daemonFactory: () => fake,
  });
  await server.handleLine(request(0, "initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
  }));
  return { server, fake, output, error };
}

describe("agent-client-protocol module", () => {
  it("responds to initialize with honest KOTA ACP capabilities", async () => {
    const output = new CaptureStream();
    const server = new AgentClientProtocolServer({
      output,
      error: new CaptureStream(),
      daemonFactory: () => new FakeDaemon(),
    });

    await server.handleLine(request(0, "initialize", {
      protocolVersion: 1,
      clientCapabilities: { terminal: true },
    }));

    const [message] = output.messages();
    expect(message.result.protocolVersion).toBe(1);
    expect(message.result.agentInfo.name).toBe("kota");
    expect(message.result.agentCapabilities.loadSession).toBe(false);
    expect(message.result.agentCapabilities.promptCapabilities).toEqual({
      image: false,
      audio: false,
      embeddedContext: false,
    });
    expect(message.result.agentCapabilities.mcpCapabilities).toEqual({
      http: false,
      sse: false,
    });
  });

  it("does not initialize a mismatched protocol version", async () => {
    const fake = new FakeDaemon();
    const output = new CaptureStream();
    const server = new AgentClientProtocolServer({
      output,
      error: new CaptureStream(),
      daemonFactory: () => fake,
    });

    await server.handleLine(request(0, "initialize", { protocolVersion: 2 }));
    await server.handleLine(request(1, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [],
    }));

    const messages = output.messages();
    expect(messages[0].result.protocolVersion).toBe(1);
    expect(messages[1].error.data.code).toBe("not_initialized");
    expect(fake.createSessionCalls).toEqual([]);
  });

  it("creates a daemon-backed ACP session for the selected project root", async () => {
    const { server, fake, output } = await initializedServer();

    await server.handleLine(request(1, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [],
    }));

    const messages = output.messages();
    expect(messages[1].result).toEqual({ sessionId: "kota-session-1" });
    expect(fake.listProjectsCalls).toBe(1);
    expect(fake.createSessionCalls).toEqual([
      {
        projectId: "proj-1",
        projectDir: PROJECT_DIR,
        displayName: "project",
      },
    ]);
  });

  it("creates an ACP session for a configured non-active project root", async () => {
    const fake = new FakeDaemon();
    fake.projectList = {
      projects: [
        {
          projectId: "proj-1",
          projectDir: PROJECT_DIR,
          displayName: "project",
        },
        {
          projectId: "proj-2",
          projectDir: SECOND_PROJECT_DIR,
          displayName: "other project",
        },
      ],
      defaultProjectId: "proj-1",
      activeProjectId: "proj-1",
    };
    const { server, output } = await initializedServer(fake);

    await server.handleLine(request(1, "session/new", {
      cwd: SECOND_PROJECT_DIR,
      mcpServers: [],
    }));

    const messages = output.messages();
    expect(messages[1].result).toEqual({ sessionId: "kota-session-1" });
    expect(fake.createSessionCalls).toEqual([
      {
        projectId: "proj-2",
        projectDir: SECOND_PROJECT_DIR,
        displayName: "other project",
      },
    ]);
  });

  it("streams ACP session/update notifications before the prompt response", async () => {
    const { server, output } = await initializedServer();
    await server.handleLine(request(1, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [],
    }));

    await server.handleLine(request(2, "session/prompt", {
      sessionId: "kota-session-1",
      prompt: [{ type: "text", text: "hello" }],
    }));

    const messages = output.messages();
    expect(messages[2]).toMatchObject({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "kota-session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "streamed response" },
        },
      },
    });
    expect(messages[3]).toMatchObject({
      id: 2,
      result: { stopReason: "end_turn" },
    });
  });

  it("cancels an active prompt and returns the cancelled stop reason", async () => {
    const fake = new FakeDaemon();
    fake.promptMode = "hang";
    const { server, output } = await initializedServer(fake);
    await server.handleLine(request(1, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [],
    }));

    const prompt = server.handleLine(request(2, "session/prompt", {
      sessionId: "kota-session-1",
      prompt: [{ type: "text", text: "keep working" }],
    }));
    await fake.promptStarted;
    await server.handleLine(notification("session/cancel", {
      sessionId: "kota-session-1",
    }));
    await prompt;

    const messages = output.messages();
    expect(fake.cancelCalls).toEqual(["kota-session-1"]);
    expect(messages.at(-1)).toMatchObject({
      id: 2,
      result: { stopReason: "cancelled" },
    });
  });

  it("reports malformed JSON-RPC as a parse error", async () => {
    const output = new CaptureStream();
    const server = new AgentClientProtocolServer({
      output,
      error: new CaptureStream(),
      daemonFactory: () => new FakeDaemon(),
    });

    await server.handleLine("{not-json");

    const [message] = output.messages();
    expect(message.id).toBeNull();
    expect(message.error.code).toBe(-32700);
    expect(message.error.data.code).toBe("parse_error");
  });

  it("rejects unsupported ACP methods without daemon side effects", async () => {
    const { server, fake, output } = await initializedServer();

    await server.handleLine(request(1, "session/load", {
      cwd: PROJECT_DIR,
      sessionId: "old",
      mcpServers: [],
    }));

    const messages = output.messages();
    expect(messages[1].error.code).toBe(-32601);
    expect(messages[1].error.data.code).toBe("unsupported_method");
    expect(fake.listProjectsCalls).toBe(0);
    expect(fake.createSessionCalls).toEqual([]);
    expect(fake.promptCalls).toEqual([]);
  });

  it("rejects unsupported MCP handoff without creating a session", async () => {
    const { server, fake, output } = await initializedServer();

    await server.handleLine(request(1, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [{ type: "stdio", name: "fs", command: "mcp", args: [], env: [] }],
    }));

    const messages = output.messages();
    expect(messages[1].error.data).toMatchObject({
      code: "unsupported_feature",
      feature: "mcpServers",
    });
    expect(fake.listProjectsCalls).toBe(0);
    expect(fake.createSessionCalls).toEqual([]);
  });

  it("parses daemon SSE chat into ACP streamed updates", async () => {
    const transport = new FakeTransport();
    const client = new HttpAcpDaemonClient(transport);
    const updates: object[] = [];

    const result = await client.promptSession({
      sessionId: "s1",
      prompt: "hello",
      signal: new AbortController().signal,
      onUpdate: (update) => updates.push(update),
    });

    expect(result).toEqual({ stopReason: "end_turn" });
    expect(updates).toEqual([
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
        },
      },
    ]);
    expect(transport.calls[0]?.path).toBe("/sessions/s1/chat");
  });

  it("creates HTTP daemon sessions with the selected project id", async () => {
    const transport = new FakeTransport();
    const client = new HttpAcpDaemonClient(transport);

    const session = await client.createSession({
      projectId: "proj-1",
      projectDir: PROJECT_DIR,
      displayName: "project",
    });

    expect(session).toEqual({ sessionId: "created-session" });
    expect(transport.calls[0]?.path).toBe("/sessions?projectId=proj-1");
    expect(transport.calls[0]?.init?.method).toBe("POST");
  });

  it("cancels HTTP daemon turns without deleting the session", async () => {
    const transport = new FakeTransport();
    const client = new HttpAcpDaemonClient(transport);

    await client.cancelSession("s1");
    await client.closeSession("s1");

    expect(transport.calls.map((call) => [call.path, call.init?.method])).toEqual([
      ["/sessions/s1/cancel", "POST"],
      ["/sessions/s1", "DELETE"],
    ]);
  });

  it("keeps stdout as JSON-RPC only and writes diagnostics to stderr", async () => {
    const output = new CaptureStream();
    const error = new CaptureStream();
    const input = Readable.from([
      `${request(0, "initialize", { protocolVersion: 1 })}\n`,
      `${notification("session/cancel", { sessionId: 42 })}\n`,
    ]);

    await runAgentClientProtocolStdio({
      input,
      output,
      error,
      daemonFactory: () => new FakeDaemon(),
    });

    const stdoutLines = output.text().trim().split("\n").filter(Boolean);
    expect(stdoutLines.length).toBe(1);
    for (const line of stdoutLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(error.text()).toContain("ACP notification ignored");
  });
});
