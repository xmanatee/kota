import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { DaemonSseStreamEvent } from "#core/daemon/daemon-control.js";
import type {
  DaemonRequestInit,
  DaemonTransport,
} from "#core/server/daemon-transport.js";
import {
  type AcpDaemonClient,
  type AcpDaemonSession,
  type AcpProject,
  type AcpProjectList,
  HttpAcpDaemonClient,
  type PromptSessionArgs,
  type PromptSessionResult,
} from "./daemon-adapter.js";
import { type AcpMcpServers, agentMessageUpdate } from "./protocol.js";
import { AgentClientProtocolServer } from "./server.js";
import { runAgentClientProtocolStdio } from "./stdio.js";

const PROJECT_DIR = "/Users/example/project";
const SECOND_PROJECT_DIR = "/Users/example/other-project";
const ACP_STDIO_MCP_SERVER = {
  name: "fs",
  command: "/usr/bin/env",
  args: ["node"],
  env: [{ name: "API_KEY", value: "secret-token" }],
};
const NORMALIZED_STDIO_MCP_SERVERS: AcpMcpServers = {
  fs: {
    type: "stdio",
    command: "/usr/bin/env",
    args: ["node"],
    env: { API_KEY: "secret-token" },
  },
};

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
  createSessionCalls: Array<{ project: AcpProject; mcpServers: AcpMcpServers }> = [];
  listSessionsCalls: AcpProject[] = [];
  resumeSessionCalls: Array<{ project: AcpProject; sessionId: string; mcpServers: AcpMcpServers }> = [];
  promptCalls: PromptSessionArgs[] = [];
  cancelCalls: string[] = [];
  closeCalls: string[] = [];
  knownSessions: AcpDaemonSession[] = [];
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

  async createSession(project: AcpProject, mcpServers: AcpMcpServers) {
    this.createSessionCalls.push({ project, mcpServers });
    return { sessionId: this.nextSessionId };
  }

  async listSessions(project: AcpProject) {
    this.listSessionsCalls.push(project);
    return this.knownSessions.filter((session) => session.metadata.projectId === project.projectId);
  }

  async resumeSession(project: AcpProject, sessionId: string, mcpServers: AcpMcpServers) {
    this.resumeSessionCalls.push({ project, sessionId, mcpServers });
    const session = this.knownSessions.find((entry) => entry.sessionId === sessionId);
    if (!session) throw new Error(`unknown session ${sessionId}`);
    session.live = true;
    session.metadata.source = "daemon";
    return { sessionId };
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
    if (path === "/sessions?projectId=proj-1" && init?.method === "GET") {
      return new Response(JSON.stringify({
        sessions: [
          {
            id: "s1",
            createdAt: "2026-05-27T05:00:00.000Z",
            lastActive: Date.parse("2026-05-27T05:05:00.000Z"),
            source: "daemon",
            busy: false,
            projectId: "proj-1",
            conversationId: "conv-live",
          },
          {
            id: "serve-session",
            createdAt: "2026-05-27T05:00:00.000Z",
            lastActive: Date.parse("2026-05-27T05:05:00.000Z"),
            source: "serve",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/sessions/bindings?projectId=proj-1") {
      return new Response(JSON.stringify({
        bindings: [
          {
            sessionId: "s1",
            projectId: "proj-1",
            conversationId: "conv-live",
            createdAt: "2026-05-27T05:00:00.000Z",
            lastActiveAt: "2026-05-27T05:05:00.000Z",
          },
          {
            sessionId: "stored-session",
            projectId: "proj-1",
            conversationId: "conv-stored",
            createdAt: "2026-05-27T04:00:00.000Z",
            lastActiveAt: "2026-05-27T04:05:00.000Z",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/sessions?projectId=proj-1" && init?.method === "POST") {
      const body = typeof init.body === "string"
        ? JSON.parse(init.body) as { session_id?: string; mcp_servers?: Record<string, object> }
        : {};
      if (body.mcp_servers && Object.hasOwn(body.mcp_servers, "unsupported")) {
        return new Response(JSON.stringify({
          error: 'The "thin" agent harness is text-only; drop mcpServers or run a tool-capable harness.',
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ session_id: body.session_id ?? "created-session" }), {
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
    expect(message.result.agentCapabilities.sessionCapabilities).toEqual({
      close: {},
      list: {},
      resume: {},
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
        project: {
          projectId: "proj-1",
          projectDir: PROJECT_DIR,
          displayName: "project",
        },
        mcpServers: {},
      },
    ]);
  });

  it("normalizes stdio MCP servers on session/new without leaking secrets", async () => {
    const { server, fake, output } = await initializedServer();

    await server.handleLine(request(1, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [ACP_STDIO_MCP_SERVER],
    }));

    expect(output.text()).not.toContain("secret-token");
    expect(output.messages()[1].result).toEqual({ sessionId: "kota-session-1" });
    expect(fake.createSessionCalls).toEqual([
      {
        project: {
          projectId: "proj-1",
          projectDir: PROJECT_DIR,
          displayName: "project",
        },
        mcpServers: NORMALIZED_STDIO_MCP_SERVERS,
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
        project: {
          projectId: "proj-2",
          projectDir: SECOND_PROJECT_DIR,
          displayName: "other project",
        },
        mcpServers: {},
      },
    ]);
  });

  it("lists daemon-owned ACP sessions for the requested project root", async () => {
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
      activeProjectId: null,
    };
    fake.knownSessions = [
      {
        sessionId: "session-proj-1",
        cwd: PROJECT_DIR,
        title: "KOTA session session-proj-1",
        updatedAt: "2026-05-27T05:02:00.000Z",
        live: true,
        metadata: {
          source: "daemon",
          projectId: "proj-1",
          conversationId: "conv-1",
          busy: false,
        },
      },
      {
        sessionId: "session-proj-2",
        cwd: SECOND_PROJECT_DIR,
        title: "KOTA session session-proj-2",
        updatedAt: "2026-05-27T05:01:00.000Z",
        live: true,
        metadata: {
          source: "daemon",
          projectId: "proj-2",
          conversationId: "conv-2",
          busy: false,
        },
      },
    ];
    const { server, output } = await initializedServer(fake);

    await server.handleLine(request(1, "session/list", {
      cwd: PROJECT_DIR,
    }));

    const messages = output.messages();
    expect(messages[1].result.sessions).toEqual([
      {
        sessionId: "session-proj-1",
        cwd: PROJECT_DIR,
        title: "KOTA session session-proj-1",
        updatedAt: "2026-05-27T05:02:00.000Z",
        _meta: {
          source: "daemon",
          projectId: "proj-1",
          conversationId: "conv-1",
          busy: false,
        },
      },
    ]);
    expect(fake.listSessionsCalls).toEqual([
      {
        projectId: "proj-1",
        projectDir: PROJECT_DIR,
        displayName: "project",
      },
    ]);
  });

  it("resumes a persisted daemon session and prompts through the resumed binding", async () => {
    const fake = new FakeDaemon();
    fake.knownSessions = [
      {
        sessionId: "stored-session",
        cwd: PROJECT_DIR,
        title: "KOTA session stored-session",
        updatedAt: "2026-05-27T05:02:00.000Z",
        live: false,
        metadata: {
          source: "daemon-binding",
          projectId: "proj-1",
          conversationId: "conv-stored",
          resumable: true,
        },
      },
    ];
    const { server, output } = await initializedServer(fake);

    await server.handleLine(request(1, "session/resume", {
      cwd: PROJECT_DIR,
      sessionId: "stored-session",
      mcpServers: [ACP_STDIO_MCP_SERVER],
    }));
    await server.handleLine(request(2, "session/prompt", {
      sessionId: "stored-session",
      prompt: [{ type: "text", text: "continue" }],
    }));

    const messages = output.messages();
    expect(messages[1].result).toEqual({});
    expect(fake.resumeSessionCalls).toEqual([
      {
        project: {
          projectId: "proj-1",
          projectDir: PROJECT_DIR,
          displayName: "project",
        },
        sessionId: "stored-session",
        mcpServers: NORMALIZED_STDIO_MCP_SERVERS,
      },
    ]);
    expect(fake.promptCalls[0]?.sessionId).toBe("stored-session");
    expect(messages.at(-1)).toMatchObject({
      id: 2,
      result: { stopReason: "end_turn" },
    });
  });

  it("attaches to a live daemon session after an ACP adapter restart", async () => {
    const fake = new FakeDaemon();
    fake.knownSessions = [
      {
        sessionId: "live-session",
        cwd: PROJECT_DIR,
        title: "KOTA session live-session",
        updatedAt: "2026-05-27T05:02:00.000Z",
        live: true,
        metadata: {
          source: "daemon",
          projectId: "proj-1",
          conversationId: "conv-live",
          busy: false,
        },
      },
    ];
    const first = await initializedServer(fake);
    await first.server.handleLine(request(1, "session/resume", {
      cwd: PROJECT_DIR,
      sessionId: "live-session",
      mcpServers: [],
    }));

    const second = await initializedServer(fake);
    await second.server.handleLine(request(1, "session/resume", {
      cwd: PROJECT_DIR,
      sessionId: "live-session",
      mcpServers: [],
    }));
    await second.server.handleLine(request(2, "session/prompt", {
      sessionId: "live-session",
      prompt: [{ type: "text", text: "after reconnect" }],
    }));

    expect(fake.resumeSessionCalls).toEqual([]);
    expect(second.output.messages()[1].result).toEqual({});
    expect(fake.promptCalls.at(-1)?.sessionId).toBe("live-session");
  });

  it("rejects resume for an already-active ACP connection session", async () => {
    const fake = new FakeDaemon();
    fake.knownSessions = [
      {
        sessionId: "live-session",
        cwd: PROJECT_DIR,
        title: "KOTA session live-session",
        updatedAt: "2026-05-27T05:02:00.000Z",
        live: true,
        metadata: {
          source: "daemon",
          projectId: "proj-1",
          conversationId: "conv-live",
          busy: false,
        },
      },
    ];
    const { server, output } = await initializedServer(fake);

    await server.handleLine(request(1, "session/resume", {
      cwd: PROJECT_DIR,
      sessionId: "live-session",
      mcpServers: [],
    }));
    await server.handleLine(request(2, "session/resume", {
      cwd: PROJECT_DIR,
      sessionId: "live-session",
      mcpServers: [],
    }));

    const messages = output.messages();
    expect(messages[2].error.data).toMatchObject({
      code: "session_already_live",
      sessionId: "live-session",
    });
  });

  it("rejects resume for unknown sessions after decoding valid MCP servers", async () => {
    const { server, fake, output } = await initializedServer();

    await server.handleLine(request(1, "session/resume", {
      cwd: PROJECT_DIR,
      sessionId: "missing-session",
      mcpServers: [ACP_STDIO_MCP_SERVER],
    }));

    const messages = output.messages();
    expect(messages[1].error.data).toMatchObject({
      code: "session_not_found",
      sessionId: "missing-session",
    });
    expect(fake.resumeSessionCalls).toEqual([]);
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

  it("rejects malformed MCP handoff without creating a session or leaking secrets", async () => {
    const { server, fake, output } = await initializedServer();

    await server.handleLine(request(1, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [{
        name: "fs",
        command: "mcp",
        args: [],
        env: [{ name: "API_KEY", value: "secret-token" }],
      }],
    }));

    const messages = output.messages();
    expect(messages[1].error.data).toMatchObject({
      code: "invalid_params",
    });
    expect(messages[1].error.message).toContain("absolute path");
    expect(output.text()).not.toContain("secret-token");
    expect(fake.listProjectsCalls).toBe(0);
    expect(fake.createSessionCalls).toEqual([]);
  });

  it("rejects duplicate MCP server names and unsupported transports before daemon side effects", async () => {
    const { server, fake, output } = await initializedServer();

    await server.handleLine(request(1, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [
        { name: "fs", command: "/usr/bin/env", args: [], env: [] },
        { name: "fs", command: "/usr/bin/env", args: [], env: [] },
      ],
    }));
    await server.handleLine(request(2, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [{
        type: "http",
        name: "api",
        url: "https://example.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer secret-token" }],
      }],
    }));
    await server.handleLine(request(3, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [{
        type: "sse",
        name: "events",
        url: "https://example.com/sse",
        headers: [],
      }],
    }));
    await server.handleLine(request(4, "session/new", {
      cwd: PROJECT_DIR,
      mcpServers: [{
        type: "http",
        name: "api2",
        url: "not-a-url",
        headers: [{ name: "Authorization", value: "Bearer secret-token" }],
      }],
    }));

    const messages = output.messages();
    expect(messages[1].error.data).toMatchObject({
      code: "invalid_params",
    });
    expect(messages[2].error.data).toMatchObject({
      code: "unsupported_feature",
      feature: "mcpServers.http",
    });
    expect(messages[3].error.data).toMatchObject({
      code: "unsupported_feature",
      feature: "mcpServers.sse",
    });
    expect(messages[4].error.data).toMatchObject({
      code: "invalid_params",
    });
    expect(output.text()).not.toContain("secret-token");
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
    }, NORMALIZED_STDIO_MCP_SERVERS);

    expect(session).toEqual({ sessionId: "created-session" });
    expect(transport.calls[0]?.path).toBe("/sessions?projectId=proj-1");
    expect(transport.calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(transport.calls[0]?.init?.body))).toMatchObject({
      autonomy_mode: "supervised",
      mcp_servers: NORMALIZED_STDIO_MCP_SERVERS,
    });
  });

  it("surfaces daemon mcpServers capability rejection without leaking secrets", async () => {
    const transport = new FakeTransport();
    const client = new HttpAcpDaemonClient(transport);

    await expect(client.createSession({
      projectId: "proj-1",
      projectDir: PROJECT_DIR,
      displayName: "project",
    }, {
      unsupported: {
        type: "stdio",
        command: "/usr/bin/env",
        env: { API_KEY: "secret-token" },
      },
    })).rejects.toThrow(/drop mcpServers/);
    await expect(client.createSession({
      projectId: "proj-1",
      projectDir: PROJECT_DIR,
      displayName: "project",
    }, {
      unsupported: {
        type: "stdio",
        command: "/usr/bin/env",
        env: { API_KEY: "secret-token" },
      },
    })).rejects.not.toThrow(/secret-token/);
  });

  it("lists HTTP daemon live sessions and persisted bindings for ACP discovery", async () => {
    const transport = new FakeTransport();
    const client = new HttpAcpDaemonClient(transport);

    const sessions = await client.listSessions({
      projectId: "proj-1",
      projectDir: PROJECT_DIR,
      displayName: "project",
    });

    expect(sessions.map((session) => [session.sessionId, session.live])).toEqual([
      ["s1", true],
      ["stored-session", false],
    ]);
    expect(sessions[0]).toMatchObject({
      cwd: PROJECT_DIR,
      updatedAt: "2026-05-27T05:05:00.000Z",
      metadata: {
        source: "daemon",
        projectId: "proj-1",
        conversationId: "conv-live",
      },
    });
    expect(transport.calls.map((call) => call.path)).toEqual([
      "/sessions?projectId=proj-1",
      "/sessions/bindings?projectId=proj-1",
    ]);
  });

  it("wakes HTTP daemon sessions by prior session id", async () => {
    const transport = new FakeTransport();
    const client = new HttpAcpDaemonClient(transport);

    const session = await client.resumeSession({
      projectId: "proj-1",
      projectDir: PROJECT_DIR,
      displayName: "project",
    }, "stored-session", NORMALIZED_STDIO_MCP_SERVERS);

    expect(session).toEqual({ sessionId: "stored-session" });
    expect(transport.calls[0]?.path).toBe("/sessions?projectId=proj-1");
    expect(transport.calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(transport.calls[0]?.init?.body))).toMatchObject({
      autonomy_mode: "supervised",
      session_id: "stored-session",
      mcp_servers: NORMALIZED_STDIO_MCP_SERVERS,
    });
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
