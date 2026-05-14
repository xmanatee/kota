import type { ConfiguredProject } from "#core/daemon/project-registry.js";
import type { ModuleStorage } from "#core/modules/module-storage.js";
import type { KotaClient } from "#core/server/kota-client.js";

export type TelegramChatProjectBinding = {
  chatId: number;
  projectId: string;
};

type StoredChatProjectSelections = {
  selections: { chatId: string; projectId: string }[];
};

export type TelegramProjectResolution =
  | { ok: true; project: ConfiguredProject; showProjectLabels: boolean }
  | { ok: false; message: string };

export type TelegramProjectSwitchResult =
  | {
      ok: true;
      project: ConfiguredProject;
      changed: boolean;
      showProjectLabels: boolean;
      message: string;
    }
  | { ok: false; message: string };

type TelegramProjectView =
  | {
      ok: true;
      projects: ConfiguredProject[];
      byId: Map<string, ConfiguredProject>;
      showProjectLabels: boolean;
    }
  | { ok: false; message: string };

type TelegramProjectSource = Pick<KotaClient["projects"], "list">;

type TelegramProjectSelectionOptions = {
  projectSource?: TelegramProjectSource;
};

const STORAGE_KEY = "chat-project-selection";

function chatKey(chatId: number): string {
  return String(chatId);
}

function formatProject(project: ConfiguredProject): string {
  return `${project.displayName} (${project.projectId})`;
}

function renderProjectList(projects: ConfiguredProject[]): string {
  if (projects.length === 1) {
    return `This daemon hosts one project: ${formatProject(projects[0]!)}. /project is only needed when multiple projects are hosted.`;
  }
  return [
    "Projects hosted by this daemon:",
    ...projects.map((project) => `- ${formatProject(project)}`),
    "",
    "Send /project <id> to switch this chat.",
  ].join("\n");
}

function buildBindingMap(bindings: TelegramChatProjectBinding[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const binding of bindings) {
    const key = chatKey(binding.chatId);
    const existing = map.get(key);
    if (existing !== undefined && existing !== binding.projectId) {
      throw new Error(`Duplicate Telegram project binding for chat ${key}`);
    }
    map.set(key, binding.projectId);
  }
  return map;
}

export class TelegramProjectSelection {
  private readonly defaults: Map<string, string>;
  private readonly projectSource: TelegramProjectSource;

  constructor(
    client: KotaClient,
    private readonly storage: ModuleStorage,
    bindings: TelegramChatProjectBinding[],
    options?: TelegramProjectSelectionOptions,
  ) {
    this.defaults = buildBindingMap(bindings);
    this.projectSource = options?.projectSource ?? client.projects;
  }

  async resolveChat(chatId: number): Promise<TelegramProjectResolution> {
    const view = await this.projectView();
    if (!view.ok) return view;
    if (view.projects.length === 1) {
      return {
        ok: true,
        project: view.projects[0]!,
        showProjectLabels: view.showProjectLabels,
      };
    }

    const selected = this.readSelections().get(chatKey(chatId)) ?? this.defaults.get(chatKey(chatId));
    if (selected === undefined) {
      return {
        ok: false,
        message:
          "This Telegram chat is not bound to a KOTA project. Send /project to list projects, then /project <id> to choose one.",
      };
    }
    const project = view.byId.get(selected);
    if (!project) {
      return {
        ok: false,
        message:
          `Telegram project "${selected}" is not hosted by this daemon. Send /project to choose a valid project.`,
      };
    }
    return { ok: true, project, showProjectLabels: view.showProjectLabels };
  }

  async switchChat(chatId: number, projectId: string): Promise<TelegramProjectSwitchResult> {
    const view = await this.projectView();
    if (!view.ok) return view;
    const trimmed = projectId.trim();
    if (trimmed.length === 0) {
      return { ok: false, message: renderProjectList(view.projects) };
    }
    if (view.projects.length === 1) {
      return {
        ok: true,
        project: view.projects[0]!,
        changed: false,
        showProjectLabels: view.showProjectLabels,
        message: renderProjectList(view.projects),
      };
    }
    const next = view.byId.get(trimmed);
    if (!next) {
      return {
        ok: false,
        message:
          `Unknown project "${trimmed}".\n\n${renderProjectList(view.projects)}`,
      };
    }
    const key = chatKey(chatId);
    const previous = this.readSelections().get(key) ?? this.defaults.get(key);
    const selections = this.readSelections();
    selections.set(key, next.projectId);
    this.writeSelections(selections);
    return {
      ok: true,
      project: next,
      changed: previous !== next.projectId,
      showProjectLabels: view.showProjectLabels,
      message: `Telegram chat is now using ${formatProject(next)}.`,
    };
  }

  async renderProjectLabelPrefix(projectId: string): Promise<string> {
    const view = await this.projectView();
    if (!view.ok || !view.showProjectLabels) return "";
    const project = view.byId.get(projectId);
    return `[${project?.displayName ?? projectId}] `;
  }

  private async projectView(): Promise<TelegramProjectView> {
    const result = await this.projectSource.list();
    if (!result.ok) {
      return {
        ok: false,
        message: "Project selection requires a running daemon project registry.",
      };
    }
    return {
      ok: true,
      projects: result.projects,
      byId: new Map(result.projects.map((project) => [project.projectId, project])),
      showProjectLabels: result.projects.length > 1,
    };
  }

  private readSelections(): Map<string, string> {
    const stored = this.storage.getJSON<StoredChatProjectSelections>(STORAGE_KEY);
    const selections = new Map<string, string>();
    if (!stored || !Array.isArray(stored.selections)) return selections;
    for (const entry of stored.selections) {
      if (typeof entry.chatId === "string" && typeof entry.projectId === "string") {
        selections.set(entry.chatId, entry.projectId);
      }
    }
    return selections;
  }

  private writeSelections(selections: Map<string, string>): void {
    this.storage.setJSON(STORAGE_KEY, {
      selections: [...selections.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([chatId, projectId]) => ({ chatId, projectId })),
    } satisfies StoredChatProjectSelections);
  }
}
