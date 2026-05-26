import { AsyncLocalStorage } from "node:async_hooks";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";

export const DEFAULT_DELEGATE_MAX_DEPTH = 2;
export const DEFAULT_DELEGATE_MAX_ACTIVE_CHILDREN = 4;

export type DelegateBudgetLimits = {
  maxDepth: number;
  maxActiveChildren: number;
};

export type DelegateBudgetLimitName = "depth" | "active_children";

export type DelegateBudgetSnapshot = {
  depth: number;
  requestedDepth: number;
  maxDepth: number;
  activeChildren: number;
  maxActiveChildren: number;
};

export type DelegateBudgetFailure = {
  limit: DelegateBudgetLimitName;
  snapshot: DelegateBudgetSnapshot;
  message: string;
};

export type DelegateBudgetLease = {
  depth: number;
  snapshot(): DelegateBudgetSnapshot;
  run<T>(fn: () => Promise<T>): Promise<T>;
  release(): void;
};

type DelegateBudgetContext = {
  depth: number;
};

const DEFAULT_LIMITS: DelegateBudgetLimits = {
  maxDepth: DEFAULT_DELEGATE_MAX_DEPTH,
  maxActiveChildren: DEFAULT_DELEGATE_MAX_ACTIVE_CHILDREN,
};

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Delegate budget ${name} must be a positive integer, got ${value}.`);
  }
}

function normalizeLimits(limits: DelegateBudgetLimits): DelegateBudgetLimits {
  assertPositiveInteger("maxDepth", limits.maxDepth);
  assertPositiveInteger("maxActiveChildren", limits.maxActiveChildren);
  return {
    maxDepth: limits.maxDepth,
    maxActiveChildren: limits.maxActiveChildren,
  };
}

export class DelegateBudget {
  private readonly storage = new AsyncLocalStorage<DelegateBudgetContext>();
  private activeChildren = 0;
  readonly limits: DelegateBudgetLimits;

  constructor(limits: DelegateBudgetLimits = DEFAULT_LIMITS) {
    this.limits = normalizeLimits(limits);
  }

  tryStart():
    | { ok: true; lease: DelegateBudgetLease }
    | { ok: false; failure: DelegateBudgetFailure } {
    const currentDepth = this.storage.getStore()?.depth ?? 0;
    const requestedDepth = currentDepth + 1;

    if (requestedDepth > this.limits.maxDepth) {
      const snapshot = this.snapshot(currentDepth, requestedDepth);
      return {
        ok: false,
        failure: {
          limit: "depth",
          snapshot,
          message:
            `maximum recursive depth ${this.limits.maxDepth} exceeded ` +
            `(current depth ${currentDepth}/${this.limits.maxDepth}, requested depth ${requestedDepth})`,
        },
      };
    }

    if (this.activeChildren >= this.limits.maxActiveChildren) {
      const snapshot = this.snapshot(currentDepth, requestedDepth);
      return {
        ok: false,
        failure: {
          limit: "active_children",
          snapshot,
          message:
            `active child delegate limit ${this.limits.maxActiveChildren} exceeded ` +
            `(active ${this.activeChildren}/${this.limits.maxActiveChildren})`,
        },
      };
    }

    this.activeChildren += 1;
    let released = false;

    return {
      ok: true,
      lease: {
        depth: requestedDepth,
        snapshot: () => this.snapshot(requestedDepth, requestedDepth),
        run: (fn) => this.storage.run({ depth: requestedDepth }, fn),
        release: () => {
          if (released) return;
          released = true;
          this.activeChildren -= 1;
        },
      },
    };
  }

  isAtDepthLimit(depth: number): boolean {
    return depth >= this.limits.maxDepth;
  }

  private snapshot(depth: number, requestedDepth: number): DelegateBudgetSnapshot {
    return {
      depth,
      requestedDepth,
      maxDepth: this.limits.maxDepth,
      activeChildren: this.activeChildren,
      maxActiveChildren: this.limits.maxActiveChildren,
    };
  }
}

export function createDelegateBudget(limits?: DelegateBudgetLimits): DelegateBudget {
  return new DelegateBudget(limits ?? DEFAULT_LIMITS);
}

export function formatDelegateBudgetSnapshot(snapshot: DelegateBudgetSnapshot): string {
  return `depth ${snapshot.depth}/${snapshot.maxDepth}, active ${snapshot.activeChildren}/${snapshot.maxActiveChildren}`;
}

export function serializeDelegateBudgetFailure(
  failure: DelegateBudgetFailure,
): KotaJsonObject {
  return {
    limit: failure.limit,
    depth: failure.snapshot.depth,
    requestedDepth: failure.snapshot.requestedDepth,
    maxDepth: failure.snapshot.maxDepth,
    activeChildren: failure.snapshot.activeChildren,
    maxActiveChildren: failure.snapshot.maxActiveChildren,
  };
}
