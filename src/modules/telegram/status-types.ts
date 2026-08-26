import type { KotaClient } from "#core/server/kota-client.js";
import type { WorkflowRuntimeSnapshot } from "#core/workflow/run-types.js";
import type { AnswerClient } from "#modules/answer/client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { HistoryClient } from "#modules/history/client.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RecallClient } from "#modules/recall/client.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import type { TelegramProjectSelection } from "./project-selection.js";

export type StatusInfo = {
  runtimeState: WorkflowRuntimeSnapshot;
  dispatchPaused: boolean;
  runsDir: string;
};

export type TelegramStatusPollProjectRouting = {
  client: KotaClient;
  selection: TelegramProjectSelection;
};

export type TelegramStatusScope = {
  projectDir: string;
  getStatusInfo: () => StatusInfo | Promise<StatusInfo>;
  knowledge: KnowledgeClient;
  memory: MemoryClient;
  history: HistoryClient;
  tasks: RepoTasksClient;
  recall: RecallClient;
  answer: AnswerClient;
  capture: CaptureClient;
  retract: RetractClient;
};

export type TelegramStatusScopeResolution =
  | { ok: true; scope: TelegramStatusScope }
  | { ok: false; message: string };

export type TelegramStatusCommandOptions = {
  token: string;
  messageChatId: number;
  text: string;
  defaultScope: TelegramStatusScope;
  projectRouting?: TelegramStatusPollProjectRouting;
};

export type TelegramStatusSenders = {
  sendPlain: (body: string) => Promise<void>;
  sendMarkdown: (body: string) => Promise<void>;
};
