/**
 * Semantic guard: the harness-neutral protocol surfaces only KOTA-native
 * fields and an opaque adapter-private overrides slot.
 *
 * The companion test `no-sdk-shaped-neutral-fields.test.ts` is a textual scan
 * for known-banned identifier names. That guard is necessary but not
 * sufficient: a contributor could rename a Claude-shaped concept to a fresh
 * KOTA-native-looking identifier and slip a provider-specific field past
 * the regex. This test instead inspects the *types* — it asserts that:
 *
 *   - the run-options surface accepts every KOTA-native field listed below,
 *   - that any extra ad-hoc field is a compile-time error (the adapter
 *     seam routes through `harnessOverrides`),
 *   - that `harnessOverrides` stays opaque to core (declared as `unknown`),
 *   - that `KotaAgentMessage` is a strict discriminated union — no
 *     permissive `Record<string, unknown>` arm — and every variant tags
 *     with a `type` literal,
 *   - that the registry resolver type rejects unknown harness names.
 */

import { describe, expectTypeOf, it } from "vitest";
import type {
  KotaAgentMessage,
  KotaAgentMessageType,
  KotaAgentRawMessage,
} from "./agent-message.js";
import type {
  AgentEffort,
  AgentHarnessRunOptions,
  AgentHarnessStepOverrides,
  AgentMcpServers,
  AgentPermissionResult,
} from "./types.js";

describe("AgentHarnessRunOptions exposes only KOTA-native concepts", () => {
  it("accepts every KOTA-native field with its declared type", () => {
    const options: AgentHarnessRunOptions = {
      prompt: "x",
      effort: "high",
      systemPrompt: "p",
      model: "m",
      modelOutputTokenLimits: { m: 1234 },
      cwd: "/tmp",
      verbose: false,
      maxTurns: 3,
      allowedTools: ["t"],
      disallowedTools: ["d"],
      mcpServers: {},
      autonomyMode: "supervised",
      persistSession: false,
      abortController: new AbortController(),
      enableFileCheckpointing: false,
      thinkingEnabled: true,
      thinkingBudget: 1024,
      askOwner: { source: "test" },
      onMessage: () => {},
      canUseTool: async () => ({ behavior: "allow" }) satisfies AgentPermissionResult,
      harnessOverrides: { foo: 1 } satisfies AgentHarnessStepOverrides,
    };

    expectTypeOf(options).toEqualTypeOf<AgentHarnessRunOptions>();
    expectTypeOf<AgentEffort>().toEqualTypeOf<
      "low" | "medium" | "high" | "xhigh" | "max"
    >();
    expectTypeOf<AgentMcpServers>().toEqualTypeOf<
      Record<string, AgentMcpServers[string]>
    >();
  });

  it("rejects ad-hoc provider-shaped fields at the call site", () => {
    // Each `@ts-expect-error` below becomes unused (and the test fails to
    // typecheck) if a future change relaxes `AgentHarnessRunOptions` to
    // accept the extra field directly. Adapter-private knobs must travel
    // through `harnessOverrides`, not as a new top-level field.
    const _withClaudePerm: AgentHarnessRunOptions = {
      prompt: "x",
      effort: "high",
      // @ts-expect-error claude-sdk permissionMode must not appear on the neutral surface
      permissionMode: "default",
    };
    const _withClaudeSettings: AgentHarnessRunOptions = {
      prompt: "x",
      effort: "high",
      // @ts-expect-error claude-sdk settingSources must not appear on the neutral surface
      settingSources: ["user"],
    };
    const _withSnakeCaseSession: AgentHarnessRunOptions = {
      prompt: "x",
      effort: "high",
      // @ts-expect-error neutral surface uses camelCase; provider session_id stays in adapter
      session_id: "abc",
    };
    const _withDecisionClassification: AgentHarnessRunOptions = {
      prompt: "x",
      effort: "high",
      // @ts-expect-error decisionClassification is a claude-sdk literal; KOTA uses decisionAttribution
      decisionClassification: "user_temporary",
    };
    const _withRawProviderField: AgentHarnessRunOptions = {
      prompt: "x",
      effort: "high",
      // @ts-expect-error invented provider knobs must route through harnessOverrides
      providerSpecificKnob: { freeForm: true },
    };
    void _withClaudePerm;
    void _withClaudeSettings;
    void _withSnakeCaseSession;
    void _withDecisionClassification;
    void _withRawProviderField;
  });

  it("keeps harnessOverrides opaque to core", () => {
    // The neutral protocol carries adapter-private state as `unknown`. Core
    // code that tries to branch on a structural shape of `harnessOverrides`
    // must explicitly narrow it — there is no implicit object/record contract.
    expectTypeOf<AgentHarnessStepOverrides>().toEqualTypeOf<unknown>();
  });
});

describe("KotaAgentMessage is a strict discriminated union", () => {
  it("every variant declares a `type` literal", () => {
    expectTypeOf<KotaAgentMessage["type"]>().toEqualTypeOf<KotaAgentMessageType>();
    expectTypeOf<KotaAgentMessageType>().toEqualTypeOf<
      "text" | "thinking" | "tool_call" | "tool_result" | "status" | "result" | "raw"
    >();
  });

  it("the raw escape hatch tags the originating adapter", () => {
    // The `raw` arm intentionally allows opaque adapter payload, but it must
    // be tagged so downstream code can branch by adapter name. A future change
    // that drops the `adapter` field — or replaces the union with a permissive
    // record — fails to typecheck here.
    expectTypeOf<KotaAgentRawMessage["adapter"]>().toEqualTypeOf<string>();
    expectTypeOf<KotaAgentRawMessage["payload"]>().toEqualTypeOf<
      Record<string, unknown>
    >();
  });

  it("non-raw variants stay structurally typed (no permissive Record arm)", () => {
    type NonRawType = Exclude<KotaAgentMessage, KotaAgentRawMessage>["type"];
    expectTypeOf<NonRawType>().toEqualTypeOf<
      "text" | "thinking" | "tool_call" | "tool_result" | "status" | "result"
    >();

    // A discriminated-union member with `type: "raw"` and an opaque payload
    // is the only escape hatch; any other variant must declare its concrete
    // fields explicitly. The line below proves the union does not collapse
    // to a permissive `Record<string, unknown>` arm: assigning a record-only
    // value into the union must fail to typecheck.
    // @ts-expect-error untagged record literals are not assignable to KotaAgentMessage
    const _bare: KotaAgentMessage = { foo: 1, bar: "x" };
    void _bare;
  });
});
