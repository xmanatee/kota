import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  type A2AArtifact,
  type A2AMessage,
  type A2AStreamResponse,
  type A2ATask,
  type A2ATaskUpdate,
  agentExecutionFailed,
  daemonProtocolError,
  type JsonObject,
  type SendMessageInput,
  type TaskListFilter,
  type TaskSelector,
  taskNotCancelable,
  taskNotFound,
  terminalTaskSubscription,
  unauthorized,
} from "./protocol.js";

export type A2ABackend = {
  sendMessage(
    input: SendMessageInput,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (update: A2ATaskUpdate) => void;
    },
  ): Promise<A2ATask>;
  getTask(selector: TaskSelector): Promise<A2ATask>;
  listTasks(filter: TaskListFilter): Promise<A2ATask[]>;
  cancelTask(selector: TaskSelector): Promise<A2ATask>;
  subscribeToTask(
    selector: TaskSelector,
    options: {
      signal?: AbortSignal;
      onUpdate: (update: A2ATaskUpdate) => void;
    },
  ): Promise<A2ATask>;
};

type SessionWireEntry = {
  id?: string;
  createdAt?: string;
  lastActive?: number;
  busy?: boolean;
  autonomyMode?: AutonomyMode;
  source?: "daemon" | "serve";
  projectId?: string;
  conversationId?: string;
};

type SessionListWireBody = {
  sessions?: SessionWireEntry[];
};

type CreateSessionWireBody = {
  session_id?: string;
  project_id?: string;
};

type SseEvent = {
  event: string;
  data: string;
};

type CreatedSession = {
  sessionId: string;
  projectId: string | null;
};

export class DaemonA2ABackend implements A2ABackend {
  constructor(
    private readonly transport: DaemonTransport,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async sendMessage(
    input: SendMessageInput,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (update: A2ATaskUpdate) => void;
    },
  ): Promise<A2ATask> {
    let taskId: string;
    let contextId: string;
    if (input.taskId === null) {
      const created = await this.createSession(input.projectId);
      taskId = created.sessionId;
      contextId = input.contextId ?? input.projectId ?? created.projectId ?? taskId;
    } else {
      const session = await this.findSession({
        taskId: input.taskId,
        projectId: input.projectId,
        contextId: input.contextId,
      });
      if (!session) throw taskNotFound(input.taskId);
      taskId = requiredSessionString(session.id, "id");
      contextId = sessionContextId(session);
    }
    const userMessage = makeMessage("ROLE_USER", taskId, contextId, input.text);
    options?.onUpdate?.(
      statusUpdateFromTask(
        makeTask({
          id: taskId,
          contextId,
          state: "TASK_STATE_WORKING",
          messageText: "KOTA is working on the requested turn.",
          history: [userMessage],
          metadata: { kotaSessionId: taskId },
          now: this.now,
        }),
      ),
    );

    const finalText = await this.sendTurn(taskId, contextId, input.text, options);
    const agentMessage = makeMessage("ROLE_AGENT", taskId, contextId, finalText || "Done.");
    const finalTask = makeTask({
      id: taskId,
      contextId,
      state: "TASK_STATE_COMPLETED",
      messageText: "KOTA completed the turn.",
      artifacts: finalText ? [makeArtifact(taskId, finalText)] : [],
      history: [userMessage, agentMessage],
      metadata: { kotaSessionId: taskId },
      now: this.now,
    });
    options?.onUpdate?.({ task: finalTask });
    return finalTask;
  }

  async getTask(selector: TaskSelector): Promise<A2ATask> {
    const session = await this.findSession(selector);
    if (!session) throw taskNotFound(selector.taskId);
    return sessionToTask(session, this.now);
  }

  async listTasks(filter: TaskListFilter): Promise<A2ATask[]> {
    const sessions = await this.listSessions(filter.projectId);
    return sessions
      .filter((session) => session.source === "daemon")
      .filter((session) => sessionMatchesScope(session, filter.projectId, filter.contextId))
      .map((session) => sessionToTask(session, this.now));
  }

  async cancelTask(selector: TaskSelector): Promise<A2ATask> {
    const task = await this.getTask(selector);
    if (task.status.state !== "TASK_STATE_WORKING") throw taskNotCancelable(selector.taskId);
    const res = await this.transport.fetchRaw(
      `/sessions/${encodeURIComponent(selector.taskId)}/cancel`,
      {
        method: "POST",
        headers: this.transport.authHeaders(),
      },
    );
    if (res.status === 401 || res.status === 403) throw unauthorized();
    if (res.status === 404) throw taskNotFound(selector.taskId);
    if (!res.ok && res.status !== 204) {
      throw daemonProtocolError(await responseErrorMessage(res));
    }
    return makeTask({
      id: task.id,
      contextId: task.contextId,
      state: "TASK_STATE_CANCELED",
      messageText: "KOTA canceled the active turn.",
      metadata: task.metadata,
      now: this.now,
    });
  }

  async subscribeToTask(
    selector: TaskSelector,
    options: {
      signal?: AbortSignal;
      onUpdate: (update: A2ATaskUpdate) => void;
    },
  ): Promise<A2ATask> {
    const initial = await this.getTask(selector);
    if (isTerminalTaskState(initial.status.state)) {
      throw terminalTaskSubscription(selector.taskId);
    }
    options.onUpdate({ task: initial });

    const res = await this.transport.fetchRaw(
      `/sessions/${encodeURIComponent(selector.taskId)}/events`,
      {
        method: "GET",
        headers: this.transport.authHeaders(),
        signal: options.signal,
      },
    );
    if (res.status === 401 || res.status === 403) throw unauthorized();
    if (res.status === 404) throw taskNotFound(selector.taskId);
    if (res.status === 409) throw terminalTaskSubscription(selector.taskId);
    if (!res.ok) throw daemonProtocolError(await responseErrorMessage(res));

    const finalText = await this.readTurnEvents(selector.taskId, initial.contextId, res, options);
    if (options.signal?.aborted === true) return initial;

    const finalTask = makeTask({
      id: initial.id,
      contextId: initial.contextId,
      state: "TASK_STATE_COMPLETED",
      messageText: "KOTA completed the active turn.",
      artifacts: finalText ? [makeArtifact(initial.id, finalText)] : initial.artifacts,
      history: initial.history,
      metadata: initial.metadata,
      now: this.now,
    });
    options.onUpdate({ task: finalTask });
    return finalTask;
  }

  private async createSession(projectId: string | null): Promise<CreatedSession> {
    const query = projectId ? `?${new URLSearchParams({ projectId }).toString()}` : "";
    const res = await this.transport.fetchRaw(`/sessions${query}`, {
      method: "POST",
      headers: this.transport.authHeaders(),
    });
    if (res.status === 401 || res.status === 403) throw unauthorized();
    if (!res.ok) throw daemonProtocolError(await responseErrorMessage(res));
    const body = (await res.json()) as CreateSessionWireBody;
    if (!body.session_id) {
      throw daemonProtocolError("Daemon session creation did not return session_id");
    }
    return {
      sessionId: body.session_id,
      projectId: typeof body.project_id === "string" && body.project_id.length > 0 ? body.project_id : null,
    };
  }

  private async sendTurn(
    taskId: string,
    contextId: string,
    text: string,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (update: A2ATaskUpdate) => void;
    },
  ): Promise<string> {
    const res = await this.transport.fetchRaw(
      `/sessions/${encodeURIComponent(taskId)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.transport.authHeaders() },
        body: JSON.stringify({ message: text }),
        signal: options?.signal,
      },
    );
    if (res.status === 401 || res.status === 403) throw unauthorized();
    if (res.status === 404) throw taskNotFound(taskId);
    if (!res.ok) throw daemonProtocolError(await responseErrorMessage(res));

    return await this.readTurnEvents(taskId, contextId, res, options);
  }

  private async readTurnEvents(
    taskId: string,
    contextId: string,
    res: Response,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (update: A2ATaskUpdate) => void;
    },
  ): Promise<string> {
    let accumulated = "";
    for await (const event of readSseEvents(res, options?.signal)) {
      const data = parseSseData(event.data);
      if (event.event === "text") {
        const content = stringFrom(data, "content");
        if (content) {
          accumulated += content;
          options?.onUpdate?.(
            artifactUpdate({
              taskId,
              contextId,
              artifact: makeArtifact(taskId, accumulated),
              lastChunk: false,
            }),
          );
        }
      } else if (event.event === "progress") {
        const content = stringFrom(data, "content");
        if (content) {
          options?.onUpdate?.(
            statusUpdateFromTask(
              makeTask({
                id: taskId,
                contextId,
                state: "TASK_STATE_WORKING",
                messageText: content,
                metadata: { kotaSessionId: taskId },
                now: this.now,
              }),
            ),
          );
        }
      } else if (event.event === "status") {
        const message = stringFrom(data, "message");
        if (message) {
          options?.onUpdate?.(
            statusUpdateFromTask(
              makeTask({
                id: taskId,
                contextId,
                state: "TASK_STATE_WORKING",
                messageText: message,
                metadata: { kotaSessionId: taskId },
                now: this.now,
              }),
            ),
          );
        }
      } else if (event.event === "guardrail") {
        options?.onUpdate?.(
          statusUpdateFromTask(
            makeTask({
              id: taskId,
              contextId,
              state: "TASK_STATE_WORKING",
              messageText: guardrailStatusMessage(data),
              metadata: { kotaSessionId: taskId, guardrail: true },
              now: this.now,
            }),
          ),
        );
      } else if (event.event === "error") {
        throw agentExecutionFailed(stringFrom(data, "message") ?? "KOTA session failed");
      } else if (event.event === "done") {
        const finalText = stringFrom(data, "result") ?? accumulated;
        if (finalText) {
          options?.onUpdate?.(
            artifactUpdate({
              taskId,
              contextId,
              artifact: makeArtifact(taskId, finalText),
              lastChunk: true,
            }),
          );
        }
        return finalText;
      }
    }
    return accumulated;
  }

  private async listSessions(projectId: string | null): Promise<SessionWireEntry[]> {
    const query = projectId ? `?${new URLSearchParams({ projectId }).toString()}` : "";
    const res = await this.transport.fetchRaw(`/sessions${query}`, {
      method: "GET",
      headers: this.transport.authHeaders(),
    });
    if (res.status === 401 || res.status === 403) throw unauthorized();
    if (!res.ok) throw daemonProtocolError(await responseErrorMessage(res));
    const body = (await res.json()) as SessionListWireBody;
    if (!Array.isArray(body.sessions)) {
      throw daemonProtocolError("Daemon session list did not include sessions");
    }
    return body.sessions;
  }

  private async findSession(selector: TaskSelector): Promise<SessionWireEntry | null> {
    const sessions = await this.listSessions(selector.projectId);
    return sessions.find((session) =>
      session.id === selector.taskId &&
      session.source === "daemon" &&
      sessionMatchesScope(session, selector.projectId, selector.contextId)
    ) ?? null;
  }
}

export function makeTask(input: {
  id: string;
  contextId: string;
  state: A2ATask["status"]["state"];
  messageText: string;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata: JsonObject;
  now: () => string;
}): A2ATask {
  return {
    id: input.id,
    contextId: input.contextId,
    status: {
      state: input.state,
      timestamp: input.now(),
      message: makeMessage("ROLE_AGENT", input.id, input.contextId, input.messageText),
    },
    artifacts: input.artifacts ?? [],
    history: input.history ?? [],
    metadata: input.metadata,
  };
}

function sessionToTask(session: SessionWireEntry, now: () => string): A2ATask {
  const id = requiredSessionString(session.id, "id");
  const contextId = sessionContextId(session);
  const state = session.busy === true ? "TASK_STATE_WORKING" : "TASK_STATE_COMPLETED";
  return makeTask({
    id,
    contextId,
    state,
    messageText: session.busy === true ? "KOTA is working on this session." : "KOTA session is idle.",
    metadata: {
      kotaSessionId: id,
      source: session.source ?? "daemon",
      createdAt: session.createdAt ?? "",
      lastActive: typeof session.lastActive === "number" ? session.lastActive : 0,
      autonomyMode: requiredSessionAutonomyMode(session.autonomyMode),
      ...(session.projectId ? { projectId: session.projectId } : {}),
      ...(session.conversationId ? { conversationId: session.conversationId } : {}),
    },
    now,
  });
}

function sessionMatchesScope(
  session: SessionWireEntry,
  projectId: string | null,
  contextId: string | null,
): boolean {
  if (projectId !== null && session.projectId !== projectId) return false;
  if (contextId !== null && sessionContextId(session) !== contextId) return false;
  return true;
}

function sessionContextId(session: SessionWireEntry): string {
  return session.projectId ?? requiredSessionString(session.id, "id");
}

function makeMessage(
  role: A2AMessage["role"],
  taskId: string,
  contextId: string,
  text: string,
): A2AMessage {
  return {
    role,
    messageId: `${taskId}-${role}-${stableTextHash(text)}`,
    taskId,
    contextId,
    parts: [{ text, mediaType: "text/plain" }],
  };
}

function makeArtifact(taskId: string, text: string): A2AArtifact {
  return {
    artifactId: `${taskId}-response`,
    name: "KOTA response",
    parts: [{ text, mediaType: "text/plain" }],
  };
}

function statusUpdateFromTask(task: A2ATask): A2AStreamResponse {
  return {
    statusUpdate: {
      taskId: task.id,
      contextId: task.contextId,
      status: task.status,
      metadata: task.metadata,
    },
  };
}

function artifactUpdate(input: {
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  lastChunk: boolean;
}): A2AStreamResponse {
  return {
    artifactUpdate: {
      taskId: input.taskId,
      contextId: input.contextId,
      artifact: input.artifact,
      append: false,
      lastChunk: input.lastChunk,
    },
  };
}

function isTerminalTaskState(state: A2ATask["status"]["state"]): boolean {
  return state === "TASK_STATE_COMPLETED" ||
    state === "TASK_STATE_FAILED" ||
    state === "TASK_STATE_CANCELED" ||
    state === "TASK_STATE_REJECTED";
}

async function* readSseEvents(
  response: Response,
  signal: AbortSignal | undefined,
): AsyncGenerator<SseEvent> {
  if (!response.body) {
    throw daemonProtocolError("Daemon chat response did not include a body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted === true) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (event) yield event;
      }
    }
    if (buffer.trim().length > 0) {
      const event = parseSseFrame(buffer);
      if (event) yield event;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Stream is already closed.
    }
  }
}

function parseSseFrame(frame: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

function parseSseData(data: string): JsonObject {
  try {
    const parsed = JSON.parse(data) as JsonObject;
    return parsed;
  } catch {
    throw daemonProtocolError("Daemon sent malformed SSE data");
  }
}

function stringFrom(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" ? value : null;
}

function guardrailStatusMessage(data: JsonObject): string {
  const policy = stringFrom(data, "policy") ?? "guardrail";
  const risk = stringFrom(data, "risk") ?? "unknown";
  return `KOTA guardrail applied (${policy}, ${risk}).`;
}

function requiredSessionString(value: string | undefined, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw daemonProtocolError(`Daemon session field ${field} must be a non-empty string`);
}

function requiredSessionAutonomyMode(value: AutonomyMode | undefined): AutonomyMode {
  if (isAutonomyMode(value)) return value;
  throw daemonProtocolError("Daemon session field autonomyMode must be one of: passive, supervised, autonomous");
}

function stableTextHash(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

async function responseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as JsonObject;
    const error = body.error;
    if (typeof error === "string" && error.length > 0) return error;
  } catch {
    // Non-JSON daemon errors collapse to status text.
  }
  return `HTTP ${res.status}`;
}
