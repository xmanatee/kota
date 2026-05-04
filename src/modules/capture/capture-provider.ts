/**
 * CaptureProviderImpl — routes one natural-language note to one
 * registered contributor.
 *
 * Routing rules:
 *
 * - Caller passes `target` → dispatch verbatim. If the named contributor
 *   is not registered, surface `no_contributors` with that one
 *   contributor's slot empty (treated the same as the seam being
 *   unconfigured for that target).
 * - No `target`, no classifier → surface `ambiguous` with the registered
 *   contributors as suggestions.
 * - No `target`, classifier present → ask the classifier; promote a
 *   confident pick to a contributor call, surface `ambiguous` otherwise.
 *
 * The seam never silently retries into a different contributor on a
 * thrown writer. A contributor that throws becomes a typed
 * `contributor_failed` arm so the operator surface can decide whether
 * to re-issue the call against a different store.
 */

import {
  CAPTURE_TARGET_ORDER,
  type CaptureClassifier,
  type CaptureContributor,
  type CaptureProvider,
  type CaptureTarget,
} from "./capture-types.js";
import type { CaptureFilter, CaptureResult } from "./client.js";

export type CaptureProviderOptions = {
  /**
   * Optional classifier the seam consults when no `target` is given. When
   * absent, an unguided capture surfaces `ambiguous` immediately.
   */
  classifier?: CaptureClassifier;
};

export class CaptureProviderImpl implements CaptureProvider {
  private readonly byTarget = new Map<CaptureTarget, CaptureContributor>();
  private readonly order: CaptureTarget[] = [];
  private readonly classifier?: CaptureClassifier;

  constructor(options: CaptureProviderOptions = {}) {
    if (options.classifier) this.classifier = options.classifier;
  }

  register(contributor: CaptureContributor): void {
    if (!this.byTarget.has(contributor.target)) {
      this.order.push(contributor.target);
    }
    this.byTarget.set(contributor.target, contributor);
  }

  contributors(): ReadonlyArray<CaptureTarget> {
    return this.order.slice();
  }

  async capture(text: string, filter?: CaptureFilter): Promise<CaptureResult> {
    const trimmed = text.trim();
    if (this.order.length === 0) {
      return { ok: false, reason: "no_contributors" };
    }
    if (trimmed === "") {
      return {
        ok: false,
        reason: "ambiguous",
        suggestions: this.suggestionList(),
      };
    }

    if (filter?.target) {
      const contributor = this.byTarget.get(filter.target);
      if (!contributor) {
        return { ok: false, reason: "no_contributors" };
      }
      return this.runContributor(contributor, trimmed, filter.hint);
    }

    if (!this.classifier) {
      return {
        ok: false,
        reason: "ambiguous",
        suggestions: this.suggestionList(),
      };
    }

    const classification = await this.classifier.classify({
      text: trimmed,
      ...(filter?.hint !== undefined && { hint: filter.hint }),
      available: this.suggestionList(),
    });
    if (classification.kind === "ambiguous") {
      return {
        ok: false,
        reason: "ambiguous",
        suggestions: this.suggestionList(),
      };
    }
    const contributor = this.byTarget.get(classification.target);
    if (!contributor) {
      return {
        ok: false,
        reason: "ambiguous",
        suggestions: this.suggestionList(),
      };
    }
    return this.runContributor(contributor, trimmed, filter?.hint);
  }

  private async runContributor(
    contributor: CaptureContributor,
    text: string,
    hint?: string,
  ): Promise<CaptureResult> {
    try {
      const record = await contributor.capture({
        text,
        ...(hint !== undefined && { hint }),
      });
      return { ok: true, record };
    } catch (err) {
      return {
        ok: false,
        reason: "contributor_failed",
        target: contributor.target,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private suggestionList(): ReadonlyArray<CaptureTarget> {
    const seen = new Set(this.order);
    const ordered: CaptureTarget[] = [];
    for (const target of CAPTURE_TARGET_ORDER) {
      if (seen.has(target)) ordered.push(target);
    }
    for (const target of this.order) {
      if (!ordered.includes(target)) ordered.push(target);
    }
    return ordered;
  }
}
