import { afterEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
	localDestructiveEffect,
	localWriteEffect,
	networkWriteEffect,
} from "./effect.js";
import {
	captureLocalToolApprovalDeclaration,
	deregisterLocalToolApprovalBinding,
  executeLocalToolLease,
	leaseLocalToolForApproval,
	registerLocalToolApprovalBinding,
} from "./local-tool-approval-binding.js";
import type { ToolEffectMetadata } from "./tool-effect-registry.js";

const TOOL_NAME = "local_approval_binding_test";
const tool: KotaTool = {
	name: TOOL_NAME,
	description: "A local approval binding test tool",
	input_schema: {
		type: "object",
		properties: { operation: { type: "string" } },
		required: ["operation"],
	},
};

afterEach(() => {
	deregisterLocalToolApprovalBinding(TOOL_NAME);
	tool.description = "A local approval binding test tool";
});

describe("local tool approval binding", () => {
  it("retains unresolved effects in approval leases and rejects later resolution drift", () => {
    let resolved = false;
    registerLocalToolApprovalBinding(tool, vi.fn(), {
      effect: networkWriteEffect(),
      resolveEffect: () => resolved ? networkWriteEffect() : undefined,
    });
    const input = { operation: "unresolved" };
    const reviewed = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
    if (!reviewed) throw new Error("Expected declaration");
    const leased = leaseLocalToolForApproval(TOOL_NAME, input, reviewed);
    if (!leased.ok) throw new Error("Expected lease");
    expect(leased.lease.effect).toBeUndefined();
    resolved = true;
    expect(leaseLocalToolForApproval(TOOL_NAME, input, reviewed)).toMatchObject({ ok: false });
    expect(leased.lease.matches(input)).toBe(false);
  });

  it("binds the implicit working directory when no execution context is supplied", () => {
    registerLocalToolApprovalBinding(tool, vi.fn(), { effect: localWriteEffect() });
    const input = { operation: "write" };
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/reviewed");
    try {
      const reviewed = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
      if (!reviewed) throw new Error("Expected declaration");
      expect(leaseLocalToolForApproval(TOOL_NAME, input, reviewed, { cwd: "/reviewed" })).toMatchObject({ ok: true });
      cwd.mockReturnValue("/changed");
      expect(leaseLocalToolForApproval(TOOL_NAME, input, reviewed)).toMatchObject({ ok: false });
    } finally {
      cwd.mockRestore();
    }
  });

  it("keeps reviewed inputs stable while an approved runner is awaiting work", async () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    registerLocalToolApprovalBinding(tool, async (input) => {
      await promise;
      return { content: String(input.operation) };
    }, { effect: localWriteEffect() });
    const input = { operation: "reviewed" };
    const declaration = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
    if (!declaration) throw new Error("Expected declaration");
    const leased = leaseLocalToolForApproval(TOOL_NAME, input, declaration);
    if (!leased.ok) throw new Error("Expected lease");
    const execution = executeLocalToolLease(leased.lease, input);
    input.operation = "substituted";
    release();
    expect(await execution).toEqual({ content: "reviewed" });
  });

  it("binds the static risk floor even when the resolved operation stays unchanged", () => {
    const metadata: ToolEffectMetadata = { effect: localWriteEffect(), resolveEffect: () => localWriteEffect() };
    registerLocalToolApprovalBinding(tool, vi.fn(), metadata);
    const input = { operation: "write" };
    const reviewed = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
    if (!reviewed) throw new Error("Expected declaration");
    metadata.effect = localDestructiveEffect();
    expect(leaseLocalToolForApproval(TOOL_NAME, input, reviewed)).toMatchObject({ ok: false });
  });

  it("binds target declarations, including unknown targets, across review and execution", async () => {
    let destination = "/allowed/report";
    const runner = vi.fn(async () => ({ content: "written" }));
    const metadata: ToolEffectMetadata = {
      effect: localWriteEffect(),
      resolveFilesystemTargets: () => ({ kind: "unknown" }),
    };
    registerLocalToolApprovalBinding(tool, runner, metadata);
    const input = { operation: "write", path: "/allowed/decoy" };
    const unknown = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
    if (!unknown) throw new Error("Expected declaration");
    metadata.resolveFilesystemTargets = () => ({ kind: "known", paths: [destination] });
    expect(leaseLocalToolForApproval(TOOL_NAME, input, unknown)).toMatchObject({ ok: false });
    const reviewed = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
    if (!reviewed) throw new Error("Expected declaration");
    // Replacing a resolver is declaration drift even when it reports the same targets.
    metadata.resolveFilesystemTargets = () => ({ kind: "known", paths: [destination] });
    expect(leaseLocalToolForApproval(TOOL_NAME, input, reviewed)).toMatchObject({ ok: false });
    const current = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
    if (!current) throw new Error("Expected declaration");
    const leased = leaseLocalToolForApproval(TOOL_NAME, input, current);
    if (!leased.ok) throw new Error("Expected lease");
    destination = "/outside/report";
    expect(await executeLocalToolLease(leased.lease, input)).toMatchObject({ is_error: true });
    expect(runner).not.toHaveBeenCalled();
  });

	it("fingerprints both the declaration and resolved effect metadata", () => {
		const metadata: ToolEffectMetadata = { effect: localWriteEffect() };
		registerLocalToolApprovalBinding(
			tool,
			vi.fn(async () => ({ content: "ok" })),
			metadata,
		);
		const input = { operation: "deploy" };
		const reviewed = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
		if (reviewed === undefined) throw new Error("expected reviewed declaration");

		metadata.effect = localDestructiveEffect();
		expect(leaseLocalToolForApproval(
			TOOL_NAME,
			input,
			reviewed,
		)).toMatchObject({
			ok: false,
			reason: "declaration_effect_changed",
		});

		metadata.effect = localWriteEffect();
		tool.description = "A changed local approval binding test tool";
		expect(leaseLocalToolForApproval(
			TOOL_NAME,
			input,
			reviewed,
		)).toMatchObject({
			ok: false,
			reason: "declaration_effect_changed",
		});
	});
});
