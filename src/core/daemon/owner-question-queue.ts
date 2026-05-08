/**
 * OwnerQuestionQueue — file-backed queue of structured questions agents
 * escalate to the repo owner when they face a high-stakes decision they
 * cannot responsibly resolve alone.
 *
 * Each question carries brief context, a concrete question, the reason the
 * owner needs to weigh in, and optional proposed answers. A review gate runs
 * before enqueue to keep the bar high: malformed or frivolous questions are
 * rejected outright and never reach the owner.
 *
 * Questions resolve by answer or dismissal. Stale entries expire after the
 * configured TTL with the question's `defaultResolution`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";

export type OwnerQuestionStatus = "pending" | "answered" | "dismissed" | "expired";

export type OwnerQuestionEnqueueInput = {
  context: string;
  question: string;
  reason: string;
  source: string;
  proposedAnswers?: string[];
  timeoutMs?: number;
  defaultResolution?: "dismiss" | "answer";
  defaultAnswer?: string;
};

export type PendingOwnerQuestion = {
  id: string;
  seq: number;
  context: string;
  question: string;
  reason: string;
  source: string;
  createdAt: string;
  status: OwnerQuestionStatus;
  proposedAnswers?: string[];
  resolvedAt?: string;
  answer?: string;
  dismissalReason?: string;
  timeoutMs?: number;
  defaultResolution?: "dismiss" | "answer";
  defaultAnswer?: string;
  resolutionSource?: string;
};

let _enqueueSeq = 0;

export class OwnerQuestionQueue {
  private pbus: ProjectScopedEventBus | null;

  constructor(private dir: string, pbus?: ProjectScopedEventBus | null) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.pbus = pbus ?? null;
  }

  enqueue(input: OwnerQuestionEnqueueInput): PendingOwnerQuestion {
    const item: PendingOwnerQuestion = {
      id: randomUUID().slice(0, 8),
      seq: _enqueueSeq++,
      context: input.context,
      question: input.question,
      reason: input.reason,
      source: input.source,
      createdAt: new Date().toISOString(),
      status: "pending",
      ...(input.proposedAnswers && input.proposedAnswers.length > 0 && { proposedAnswers: input.proposedAnswers }),
      ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
      ...(input.defaultResolution !== undefined && { defaultResolution: input.defaultResolution }),
      ...(input.defaultAnswer !== undefined && { defaultAnswer: input.defaultAnswer }),
    };
    this.write(item);
    if (this.pbus) {
      this.pbus.emit("owner.question.asked", {
        id: item.id,
        question: item.question,
        reason: item.reason,
        source: item.source,
      });
      this.pbus.emit("owner.question.changed", { id: item.id, pendingCount: this.count("pending") });
    }
    return item;
  }

  get(id: string): PendingOwnerQuestion | null {
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  list(status?: OwnerQuestionStatus): PendingOwnerQuestion[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as PendingOwnerQuestion)
      .filter((item) => !status || item.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq);
  }

  answer(id: string, answer: string, resolutionSource?: string): PendingOwnerQuestion | null {
    const item = this.get(id);
    if (!item || item.status !== "pending") return null;
    item.status = "answered";
    item.resolvedAt = new Date().toISOString();
    item.answer = answer;
    if (resolutionSource) item.resolutionSource = resolutionSource;
    this.write(item);
    if (this.pbus) {
      this.pbus.emit("owner.question.resolved", { id, answered: true, answer });
      this.pbus.emit("owner.question.changed", { id, pendingCount: this.count("pending") });
    }
    return item;
  }

  dismiss(id: string, reason?: string, resolutionSource?: string): PendingOwnerQuestion | null {
    const item = this.get(id);
    if (!item || item.status !== "pending") return null;
    item.status = "dismissed";
    item.resolvedAt = new Date().toISOString();
    if (reason) item.dismissalReason = reason;
    if (resolutionSource) item.resolutionSource = resolutionSource;
    this.write(item);
    if (this.pbus) {
      this.pbus.emit("owner.question.resolved", { id, answered: false, answer: "" });
      this.pbus.emit("owner.question.dismissed", { id, reason: reason ?? "" });
      this.pbus.emit("owner.question.changed", { id, pendingCount: this.count("pending") });
    }
    return item;
  }

  expire(id: string, resolutionSource?: string): PendingOwnerQuestion | null {
    const item = this.get(id);
    if (!item || item.status !== "pending") return null;
    item.resolvedAt = new Date().toISOString();
    item.resolutionSource = resolutionSource ?? "timeout";
    const resolution = item.defaultResolution ?? "dismiss";
    if (resolution === "answer") {
      item.status = "answered";
      item.answer = item.defaultAnswer ?? "(no response — proceed with your best judgment)";
    } else {
      item.status = "expired";
      item.dismissalReason = "expired";
    }
    this.write(item);
    if (this.pbus) {
      this.pbus.emit("owner.question.expired", { id: item.id, defaultResolution: resolution });
      this.pbus.emit("owner.question.resolved", {
        id: item.id,
        answered: resolution === "answer",
        answer: item.answer ?? "",
      });
      this.pbus.emit("owner.question.changed", { id: item.id, pendingCount: this.count("pending") });
    }
    return item;
  }

  expireStale(defaultTtlMs?: number): PendingOwnerQuestion[] {
    const now = Date.now();
    const expired: PendingOwnerQuestion[] = [];
    for (const item of this.list("pending")) {
      const ttl = item.timeoutMs ?? defaultTtlMs;
      if (!ttl) continue;
      if (now < new Date(item.createdAt).getTime() + ttl) continue;
      item.resolvedAt = new Date().toISOString();
      item.resolutionSource = "timeout";
      const resolution = item.defaultResolution ?? "dismiss";
      if (resolution === "answer") {
        item.status = "answered";
        item.answer = item.defaultAnswer ?? "(no response — proceed with your best judgment)";
      } else {
        item.status = "expired";
        item.dismissalReason = "expired";
      }
      this.write(item);
      if (this.pbus) {
        this.pbus.emit("owner.question.expired", { id: item.id, defaultResolution: resolution });
        this.pbus.emit("owner.question.resolved", {
          id: item.id,
          answered: resolution === "answer",
          answer: item.answer ?? "",
        });
        this.pbus.emit("owner.question.changed", { id: item.id, pendingCount: this.count("pending") });
      }
      expired.push(item);
    }
    return expired;
  }

  count(status?: OwnerQuestionStatus): number {
    return this.list(status).length;
  }

  clear(): void {
    if (!existsSync(this.dir)) return;
    for (const f of readdirSync(this.dir).filter((f) => f.endsWith(".json"))) {
      unlinkSync(join(this.dir, f));
    }
  }

  private write(item: PendingOwnerQuestion): void {
    writeFileSync(join(this.dir, `${item.id}.json`), JSON.stringify(item, null, 2));
  }
}

let _queue: OwnerQuestionQueue | null = null;

export function getOwnerQuestionQueue(dir?: string): OwnerQuestionQueue {
  if (!_queue) _queue = new OwnerQuestionQueue(dir ?? join(process.cwd(), ".kota", "owner-questions"));
  return _queue;
}

/**
 * Install a pre-built {@link OwnerQuestionQueue} as the module-level
 * singleton. Used by the per-project runtime bundle factory to register the
 * default project's instance without re-binding the queue directory outside
 * the bundle.
 */
export function setOwnerQuestionQueueInstance(queue: OwnerQuestionQueue): void {
  _queue = queue;
}

export function resetOwnerQuestionQueue(): void {
  _queue = null;
}
