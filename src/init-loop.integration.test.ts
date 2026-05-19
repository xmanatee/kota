import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cross-module integration tests: init.ts → loop.ts (AgentSession) → context.ts → system-prompt.ts
// Verifies environment/project detection flows through session startup into the system prompt.

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));

vi.mock("./core/mcp/manager.js", () => ({
  McpManager: { loadConfig: () => null },
}));
vi.mock("./core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: { messages: { stream: vi.fn(), create: vi.fn() } },
    model: "claude-sonnet-4-6",
    providerName: "anthropic",
  })),
  registerModelClientFactory: vi.fn(),
}));
vi.mock("./core/modules/project-discovery.js", () => ({
  discoverProjectModules: vi.fn(async () => []),
}));
vi.mock("./core/modules/module-discovery.js", () => ({
  discoverModules: vi.fn(async () => []),
}));

async function closeSessionAfterInit(session: {
  initPromise: Promise<void>;
  close: () => void;
}): Promise<void> {
  await session.initPromise;
  session.close();
}

// Suppress console.error during tests
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("init → loop → context: session startup pipeline", () => {
  it("system prompt includes SYSTEM_PROMPT base content", async () => {
    const { AgentSession } = await import("./core/loop/loop.js");
    const { SYSTEM_PROMPT } = await import("./core/agents/system-prompt.js");

    const session = new AgentSession({ autonomyMode: "autonomous" });
    // Access the static prompt through the public close path — verify via context
    // The system prompt must start with SYSTEM_PROMPT
    // We test indirectly: the context stores the combined prompt
    const ctx = (session as any).context;
    const staticPrompt: string = ctx.getStaticPrompt();
    expect(staticPrompt.startsWith(SYSTEM_PROMPT)).toBe(true);
    await closeSessionAfterInit(session);
  });

  it("warmup section appears in the static prompt", async () => {
    const { AgentSession } = await import("./core/loop/loop.js");

    const session = new AgentSession({ autonomyMode: "autonomous" });
    const staticPrompt: string = (session as any).context.getStaticPrompt();
    // buildSessionWarmup always includes working directory
    expect(staticPrompt).toContain("**Working directory**:");
    expect(staticPrompt).toContain("## Session Context (auto-detected)");
    await closeSessionAfterInit(session);
  });

  it("system info (date, platform) appears in static prompt", async () => {
    const { AgentSession } = await import("./core/loop/loop.js");

    const session = new AgentSession({ autonomyMode: "autonomous" });
    const staticPrompt: string = (session as any).context.getStaticPrompt();
    expect(staticPrompt).toContain("**System**:");
    expect(staticPrompt).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    expect(staticPrompt).toMatch(/Platform: (macOS|Linux|Windows)/);
    await closeSessionAfterInit(session);
  });

  it("project detection flows into static prompt for code directories", async () => {
    // Current directory is a Node.js project (has package.json)
    const { AgentSession } = await import("./core/loop/loop.js");

    const session = new AgentSession({ autonomyMode: "autonomous" });
    const staticPrompt: string = (session as any).context.getStaticPrompt();
    expect(staticPrompt).toContain("**Project**:");
    expect(staticPrompt).toContain("Node.js project");
    await closeSessionAfterInit(session);
  });
});

describe("init → loop: environment detection for non-code workspaces (cross-module)", () => {
  it("detectEnvironment output appears in warmup when no project detected", async () => {
    const { buildSessionWarmup } = await import("./init.js");
    const { detectEnvironment } = await import("#core/util/project-detection.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    // Create a temp dir with data files (no project files)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-env-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "sales.csv"), "product,revenue\nA,100");
      fs.writeFileSync(path.join(tmpDir, "notes.txt"), "Some notes");
      fs.writeFileSync(path.join(tmpDir, "logo.png"), "fake-png");

      // detectEnvironment should find data + documents + images
      const env = detectEnvironment(tmpDir);
      expect(env).toContain("data file");
      expect(env).toContain("document");
      expect(env).toContain("image");

      // buildSessionWarmup should include **Environment** (not **Project**)
      const warmup = buildSessionWarmup(tmpDir);
      expect(warmup).toContain("**Environment**:");
      expect(warmup).not.toContain("**Project**:");
      expect(warmup).toContain("data");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("warmup format produces valid system prompt when concatenated", async () => {
    const { buildSessionWarmup } = await import("./init.js");
    const { SYSTEM_PROMPT } = await import("./core/agents/system-prompt.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-concat-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "data.json"), "{}");

      const warmup = buildSessionWarmup(tmpDir);
      const combined = SYSTEM_PROMPT + warmup;

      // Combined prompt should not have doubled section headers
      const sessionHeaders = combined.match(/## Session Context/g);
      expect(sessionHeaders?.length || 0).toBeLessThanOrEqual(1);

      // Warmup should start with newlines for clean separation
      expect(warmup).toMatch(/^\n\n/);

      // Combined should end cleanly (no trailing garbage)
      expect(combined.trim().length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("project detection takes priority over environment detection in warmup", async () => {
    const { buildSessionWarmup } = await import("./init.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-prio-test-"));
    try {
      // Dir has both a project file AND data files
      fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"test"}');
      fs.writeFileSync(path.join(tmpDir, "data.csv"), "a,b\n1,2");

      const warmup = buildSessionWarmup(tmpDir);
      // Project should win, Environment should not appear
      expect(warmup).toContain("**Project**:");
      expect(warmup).not.toContain("**Environment**:");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("system prompt capability guidance coverage", () => {
  it("base system prompt stays focused on core rails", async () => {
    const { SYSTEM_PROMPT } = await import("./core/agents/system-prompt.js");

    expect(SYSTEM_PROMPT).toContain("## Approach");
    expect(SYSTEM_PROMPT).toContain("## Tool Use");
    expect(SYSTEM_PROMPT).toContain("## Delegation");
    expect(SYSTEM_PROMPT).not.toContain("Workflow Patterns");
  });

  it("loaded capability details come from resolved tool metadata", async () => {
    const { formatResolvedToolGuidance } = await import(
      "./core/agents/tool-guidance.js"
    );
    const { codeExecTool } = await import("./modules/execution/code-exec.js");
    const { webFetchTool } = await import("./modules/web-access/web-fetch.js");

    const guidance = formatResolvedToolGuidance([codeExecTool, webFetchTool]);

    expect(guidance).toContain("code_exec");
    expect(guidance).toContain("language");
    expect(guidance).toContain("web_fetch");
    expect(guidance).toContain("save_to");
  });
});
