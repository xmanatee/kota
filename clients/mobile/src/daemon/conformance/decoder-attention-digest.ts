import { asArray, asBool, asInt, asObject, asString, fail } from './decoder-common';

// MARK: - Attention

export type AttentionItem = { label: string; detail: string };

export type AttentionResponse = {
  data: { items: AttentionItem[] };
  text: string;
};

export function parseAttentionResponse(raw: unknown): AttentionResponse {
  const obj = asObject(raw, "attention");
  const data = asObject(obj.data, "attention.data");
  const items = asArray(data.items, "attention.data.items").map((entry) => {
    const e = asObject(entry, "attentionItem");
    return {
      label: asString(e.label, "attentionItem.label"),
      detail: asString(e.detail, "attentionItem.detail"),
    };
  });
  return {
    data: { items },
    text: asString(obj.text, "attention.text"),
  };
}

// MARK: - Digest

export type DigestQueueCounts = {
  backlog: number;
  ready: number;
  doing: number;
  blocked: number;
};

export type DigestQueueDelta = {
  current: DigestQueueCounts;
  previous: DigestQueueCounts | null;
  delta: { backlog: number | null; ready: number | null; doing: number | null; blocked: number | null };
};

function parseDigestQueueCounts(raw: unknown, field: string): DigestQueueCounts {
  const o = asObject(raw, field);
  return {
    backlog: asInt(o.backlog, `${field}.backlog`),
    ready: asInt(o.ready, `${field}.ready`),
    doing: asInt(o.doing, `${field}.doing`),
    blocked: asInt(o.blocked, `${field}.blocked`),
  };
}

function parseDigestQueueDelta(raw: unknown): DigestQueueDelta {
  const o = asObject(raw, "digest.data.queueDelta");
  const current = parseDigestQueueCounts(o.current, "queueDelta.current");
  const previousRaw = o.previous;
  const previous = previousRaw === null
    ? null
    : parseDigestQueueCounts(previousRaw, "queueDelta.previous");
  const deltaObj = asObject(o.delta, "queueDelta.delta");
  const readField = (key: keyof DigestQueueCounts): number | null => {
    const v = deltaObj[key];
    if (v === null) return null;
    return asInt(v, `queueDelta.delta.${key}`);
  };
  return {
    current,
    previous,
    delta: {
      backlog: readField("backlog"),
      ready: readField("ready"),
      doing: readField("doing"),
      blocked: readField("blocked"),
    },
  };
}

export type DigestData = {
  windowStartedAt: string;
  windowEndedAt: string;
  builderCommits: Array<{
    runId: string;
    taskId: string | null;
    taskTitle: string | null;
    commitSubject: string;
    durationMs: number | null;
  }>;
  explorerAdditions: Array<{
    runId: string;
    taskCount: number;
    watchlistAdds: number;
  }>;
  decomposerSplits: Array<{
    runId: string;
    parentTaskId: string | null;
    childTaskCount: number;
  }>;
  blockedPromoterMoves: Array<{
    runId: string;
    promotedTaskIds: string[];
    toReady: string[];
    toBacklog: string[];
  }>;
  failedMonitoredRuns: Array<{
    runId: string;
    workflow: string;
    status: "failed" | "interrupted";
    startedAt: string;
  }>;
  pendingOwnerQuestions: Array<{
    id: string;
    question: string;
    source: string;
    ageDays: number;
  }>;
  agingOperatorCaptures: Array<{
    taskId: string;
    ageDays: number;
    path: string;
  }>;
  queueDelta: DigestQueueDelta;
  quiet: boolean;
};

export type DigestResponse = { data: DigestData; text: string };

export function parseDigestResponse(raw: unknown): DigestResponse {
  const top = asObject(raw, "digest");
  const data = asObject(top.data, "digest.data");
  const builderCommits = asArray(
    data.builderCommits,
    "digest.data.builderCommits",
  ).map((entry) => {
    const e = asObject(entry, "builderCommit");
    return {
      runId: asString(e.runId, "builderCommit.runId"),
      taskId: e.taskId === null ? null : asString(e.taskId, "builderCommit.taskId"),
      taskTitle:
        e.taskTitle === null ? null : asString(e.taskTitle, "builderCommit.taskTitle"),
      commitSubject: asString(e.commitSubject, "builderCommit.commitSubject"),
      durationMs:
        e.durationMs === null
          ? null
          : asInt(e.durationMs, "builderCommit.durationMs"),
    };
  });
  const explorerAdditions = asArray(
    data.explorerAdditions,
    "digest.data.explorerAdditions",
  ).map((entry) => {
    const e = asObject(entry, "explorerAddition");
    return {
      runId: asString(e.runId, "explorerAddition.runId"),
      taskCount: asInt(e.taskCount, "explorerAddition.taskCount"),
      watchlistAdds: asInt(e.watchlistAdds, "explorerAddition.watchlistAdds"),
    };
  });
  const decomposerSplits = asArray(
    data.decomposerSplits,
    "digest.data.decomposerSplits",
  ).map((entry) => {
    const e = asObject(entry, "decomposerSplit");
    return {
      runId: asString(e.runId, "decomposerSplit.runId"),
      parentTaskId:
        e.parentTaskId === null
          ? null
          : asString(e.parentTaskId, "decomposerSplit.parentTaskId"),
      childTaskCount: asInt(
        e.childTaskCount,
        "decomposerSplit.childTaskCount",
      ),
    };
  });
  const blockedPromoterMoves = asArray(
    data.blockedPromoterMoves,
    "digest.data.blockedPromoterMoves",
  ).map((entry) => {
    const e = asObject(entry, "blockedPromoterMove");
    return {
      runId: asString(e.runId, "blockedPromoterMove.runId"),
      promotedTaskIds: asArray(
        e.promotedTaskIds,
        "blockedPromoterMove.promotedTaskIds",
      ).map((s, i) =>
        asString(s, `blockedPromoterMove.promotedTaskIds[${i}]`),
      ),
      toReady: asArray(e.toReady, "blockedPromoterMove.toReady").map((s, i) =>
        asString(s, `blockedPromoterMove.toReady[${i}]`),
      ),
      toBacklog: asArray(
        e.toBacklog,
        "blockedPromoterMove.toBacklog",
      ).map((s, i) => asString(s, `blockedPromoterMove.toBacklog[${i}]`)),
    };
  });
  const failedMonitoredRuns = asArray(
    data.failedMonitoredRuns,
    "digest.data.failedMonitoredRuns",
  ).map((entry): {
    runId: string;
    workflow: string;
    status: "failed" | "interrupted";
    startedAt: string;
  } => {
    const e = asObject(entry, "failedMonitoredRun");
    const status = asString(e.status, "failedMonitoredRun.status");
    if (status !== "failed" && status !== "interrupted") {
      return fail(`unknown failed-run status: ${status}`);
    }
    return {
      runId: asString(e.runId, "failedMonitoredRun.runId"),
      workflow: asString(e.workflow, "failedMonitoredRun.workflow"),
      status,
      startedAt: asString(e.startedAt, "failedMonitoredRun.startedAt"),
    };
  });
  const pendingOwnerQuestions = asArray(
    data.pendingOwnerQuestions,
    "digest.data.pendingOwnerQuestions",
  ).map((entry) => {
    const e = asObject(entry, "pendingOwnerQuestion");
    return {
      id: asString(e.id, "pendingOwnerQuestion.id"),
      question: asString(e.question, "pendingOwnerQuestion.question"),
      source: asString(e.source, "pendingOwnerQuestion.source"),
      ageDays: asInt(e.ageDays, "pendingOwnerQuestion.ageDays"),
    };
  });
  const agingOperatorCaptures = asArray(
    data.agingOperatorCaptures,
    "digest.data.agingOperatorCaptures",
  ).map((entry) => {
    const e = asObject(entry, "agingOperatorCapture");
    return {
      taskId: asString(e.taskId, "agingOperatorCapture.taskId"),
      ageDays: asInt(e.ageDays, "agingOperatorCapture.ageDays"),
      path: asString(e.path, "agingOperatorCapture.path"),
    };
  });
  return {
    data: {
      windowStartedAt: asString(
        data.windowStartedAt,
        "digest.data.windowStartedAt",
      ),
      windowEndedAt: asString(data.windowEndedAt, "digest.data.windowEndedAt"),
      builderCommits,
      explorerAdditions,
      decomposerSplits,
      blockedPromoterMoves,
      failedMonitoredRuns,
      pendingOwnerQuestions,
      agingOperatorCaptures,
      queueDelta: parseDigestQueueDelta(data.queueDelta),
      quiet: asBool(data.quiet, "digest.data.quiet"),
    },
    text: asString(top.text, "digest.text"),
  };
}
