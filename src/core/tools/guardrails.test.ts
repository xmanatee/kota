import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { legacyEffect, riskFromEffect } from "./effect.js";
import {
  assess,
  classifyRisk,
  type GuardrailsConfig,
  getDefaultConfig,
  nonInteractiveConfig,
  resolvePolicy,
  sanitizeGuardrailsConfig,
} from "./guardrails.js";
import { clearCustomTools, getCoreRegistrations, registerTool } from "./index.js";

describe("classifyRisk", () => {
  afterEach(() => clearCustomTools());

  it("classifies read-only core tools as safe", () => {
    // Core tools with risk: "safe" in their ToolRegistration
    for (const tool of ["todo", "ask_user"]) {
      const { risk } = classifyRisk(tool, {});
      expect(risk).toBe("safe");
    }
    // Module tools (file_read, grep, glob, repo_map, notify, memory, etc.) are safe when their
    // module is loaded and registers risk: "safe" metadata via registerTool.
    // Without the module loaded, they fall through to "unclassified tool" → moderate.
  });

  it("classifies module-declared safe tool as safe", () => {
    registerTool(
      { name: "ext_readonly", description: "read-only ext tool", input_schema: { type: "object", properties: {} } },
      async () => ({ content: "ok" }),
      "test-module",
      { effect: legacyEffect({ risk: "safe", kind: "discovery" }), },
    );
    const { risk } = classifyRisk("ext_readonly", {});
    expect(risk).toBe("safe");
  });

  it("classifies module-declared dangerous tool as dangerous", () => {
    registerTool(
      { name: "ext_mutate", description: "mutating ext tool", input_schema: { type: "object", properties: {} } },
      async () => ({ content: "ok" }),
      "test-module",
      { effect: legacyEffect({ risk: "dangerous", kind: "action" }), },
    );
    const { risk } = classifyRisk("ext_mutate", {});
    expect(risk).toBe("dangerous");
  });

  it("falls back to moderate for module tool with no risk annotation", () => {
    registerTool(
      { name: "ext_unannotated", description: "unannotated ext tool", input_schema: { type: "object", properties: {} } },
      async () => ({ content: "ok" }),
      "test-module",
    );
    const { risk } = classifyRisk("ext_unannotated", {});
    expect(risk).toBe("moderate");
  });

  it("classifies file modification tools as moderate", () => {
    for (const tool of ["file_edit", "file_write", "multi_edit", "find_replace"]) {
      const { risk } = classifyRisk(tool, { path: "./src/foo.ts" });
      expect(risk).toBe("moderate");
    }
  });

  it("classifies shell with safe command as moderate", () => {
    const { risk } = classifyRisk("shell", { command: "ls -la" });
    expect(risk).toBe("moderate");
  });

  it("classifies shell with rm as dangerous", () => {
    const { risk } = classifyRisk("shell", { command: "rm -rf /tmp/stuff" });
    expect(risk).toBe("dangerous");
  });

  it("classifies shell with git push as dangerous", () => {
    const { risk } = classifyRisk("shell", { command: "git push origin main" });
    expect(risk).toBe("dangerous");
  });

  it("classifies shell with sudo as dangerous", () => {
    const { risk } = classifyRisk("shell", { command: "sudo apt install foo" });
    expect(risk).toBe("dangerous");
  });

  it("classifies shell with npm publish as dangerous", () => {
    const { risk } = classifyRisk("shell", { command: "npm publish --access public" });
    expect(risk).toBe("dangerous");
  });

  it("classifies absolute shell cwd outside the project as dangerous without echoing the path", () => {
    const result = classifyRisk("shell", { command: "pwd", cwd: "/tmp" });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("project/root working directory override");
    expect(result.reason).not.toContain("/tmp");
  });

  it("classifies resolved shell cwd outside the project as dangerous", () => {
    const result = classifyRisk("shell", { command: "pwd", cwd: ".." });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("project/root working directory override");
  });

  it("keeps shell cwd inside the project at the baseline shell risk", () => {
    const result = classifyRisk("shell", { command: "pwd", cwd: "src/core" });
    expect(result.risk).toBe("moderate");
    expect(result.reason).toBe("shell execution");
  });

  it("classifies leading cd prefixes outside the project as dangerous without echoing the path", () => {
    const result = classifyRisk("shell", { command: "cd /tmp && pwd" });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("project/root directory-changing command");
    expect(result.reason).not.toContain("/tmp");
  });

  it("classifies leading cd prefixes with POSIX options outside the project as dangerous", () => {
    const result = classifyRisk("shell", { command: "cd -P /tmp && pwd" });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("project/root directory-changing command");
    expect(result.reason).not.toContain("/tmp");
  });

  it("classifies leading pushd prefixes outside the project as dangerous", () => {
    const result = classifyRisk("shell", { command: "pushd .. && pwd" });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("project/root directory-changing command");
  });

  it("resolves leading cd prefixes against an explicit shell cwd", () => {
    const inside = classifyRisk("shell", {
      command: "cd .. && pwd",
      cwd: "src/core",
    });
    expect(inside.risk).toBe("moderate");
    expect(inside.reason).toBe("shell execution");

    const outside = classifyRisk("shell", {
      command: "cd ../../.. && pwd",
      cwd: "src/core",
    });
    expect(outside.risk).toBe("dangerous");
    expect(outside.reason).toContain("project/root directory-changing command");
  });

  it("keeps leading cd prefixes inside the project at the baseline shell risk", () => {
    const result = classifyRisk("shell", { command: "cd src && pwd" });
    expect(result.risk).toBe("moderate");
    expect(result.reason).toBe("shell execution");
  });

  it.each(["shell", "process"] as const)(
    "classifies %s credential environment overrides as dangerous without echoing values",
    (tool) => {
      const result = classifyRisk(tool, {
        command: "GITHUB_TOKEN=super-secret-do-not-log gh auth status",
      });
      expect(result.risk).toBe("dangerous");
      expect(result.reason).toContain("credential/token");
      expect(result.reason).toContain("GITHUB_TOKEN");
      expect(result.reason).not.toContain("super-secret-do-not-log");
    },
  );

  it("classifies provider profile environment overrides as dangerous", () => {
    const result = classifyRisk("shell", {
      command: "AWS_PROFILE=production aws sts get-caller-identity",
    });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("provider/profile");
    expect(result.reason).toContain("AWS_PROFILE");
    expect(result.reason).not.toContain("production");
  });

  it("classifies KOTA control environment overrides as dangerous", () => {
    const result = classifyRisk("shell", {
      command: "KOTA_PROJECT_DIR=/private/tmp/other pnpm test",
    });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("KOTA control");
    expect(result.reason).toContain("KOTA_PROJECT_DIR");
    expect(result.reason).not.toContain("/private/tmp/other");
  });

  it("classifies telemetry endpoint environment overrides as dangerous", () => {
    const result = classifyRisk("process", {
      command: "OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example/v1/traces pnpm test",
    });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("telemetry routing");
    expect(result.reason).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(result.reason).not.toContain("collector.example");
  });

  it("preserves narrow benign presentation and test environment overrides", () => {
    const result = classifyRisk("shell", {
      command: "NO_COLOR=1 FORCE_COLOR=0 CI=1 KOTA_RENDERER_THEME=ascii pnpm test",
    });
    expect(result.risk).toBe("moderate");
    expect(result.reason).toBe("shell execution");
  });

  it("keeps env override, working-directory, and destructive command detection active together", () => {
    const result = classifyRisk("shell", {
      command: "GITHUB_TOKEN=fake-token cd /tmp && rm -rf stuff",
    });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("credential/token");
    expect(result.reason).toContain("project/root directory-changing command");
    expect(result.reason).toContain("destructive command pattern detected");
    expect(result.reason).not.toContain("fake-token");
    expect(result.reason).not.toContain("/tmp");
  });

  it("classifies unknown leading environment overrides as dangerous", () => {
    const result = classifyRisk("process", {
      command: "NODE_OPTIONS=--require=./hook node server.js",
    });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("unclassified environment override");
    expect(result.reason).toContain("NODE_OPTIONS");
    expect(result.reason).not.toContain("./hook");
  });

  it("does not classify non-leading assignment-looking arguments as environment overrides", () => {
    const result = classifyRisk("shell", {
      command: "printf %s GITHUB_TOKEN=super-secret-do-not-log",
    });
    expect(result.risk).toBe("moderate");
    expect(result.reason).not.toContain("super-secret-do-not-log");
  });

  it("classifies code_exec as moderate for normal code", () => {
    const { risk } = classifyRisk("code_exec", { code: "print('hello')" });
    expect(risk).toBe("moderate");
  });

  it("classifies code_exec with os.system as dangerous", () => {
    const { risk } = classifyRisk("code_exec", { code: "import os; os.system('rm -rf /')" });
    expect(risk).toBe("dangerous");
  });

  it("classifies code_exec with subprocess as dangerous", () => {
    const { risk } = classifyRisk("code_exec", { code: "import subprocess; subprocess.run(['ls'])" });
    expect(risk).toBe("dangerous");
  });

  it("classifies code_exec with shutil.rmtree as dangerous", () => {
    const { risk } = classifyRisk("code_exec", { code: "import shutil; shutil.rmtree('/tmp')" });
    expect(risk).toBe("dangerous");
  });

  it("classifies http_request GET as open-world network access", () => {
    const result = classifyRisk("http_request", { url: "https://example.com", method: "GET" });
    expect(result.risk).toBe("moderate");
    expect(result.reason).toContain("open-world network request");
  });

  it("classifies http_request default GET as open-world network access", () => {
    const result = classifyRisk("http_request", { url: "https://example.com" });
    expect(result.risk).toBe("moderate");
    expect(result.reason).toContain("HTTP GET");
  });

  it("classifies http_request GET with save_to as a local filesystem write", () => {
    const result = classifyRisk("http_request", {
      url: "https://example.com",
      method: "GET",
      save_to: "data/http-response.txt",
    });
    expect(result.risk).toBe("moderate");
    expect(result.reason).toContain("local filesystem write");
  });

  it("classifies http_request GET with outside-project save_to as dangerous", () => {
    const result = classifyRisk("http_request", {
      url: "https://example.com",
      method: "GET",
      save_to: "/tmp/http-response.txt",
    });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("outside project directory");
    expect(result.reason).not.toContain("/tmp");
  });

  it("classifies http_request GET with dangling outside-project save_to symlink as dangerous", () => {
    const baseDir = join(process.cwd(), ".kota", "test-tmp");
    mkdirSync(baseDir, { recursive: true });
    const projectDir = mkdtempSync(join(baseDir, "guardrails-save-to-link-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "guardrails-save-to-outside-"));
    const link = join(projectDir, "response.txt");
    symlinkSync(join(outsideDir, "response.txt"), link);

    try {
      const result = classifyRisk("http_request", {
        url: "https://example.com",
        method: "GET",
        save_to: link,
      });

      expect(result.risk).toBe("dangerous");
      expect(result.reason).toContain("outside project directory");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("classifies web_fetch with save_to as a local filesystem write", () => {
    const result = classifyRisk("web_fetch", {
      url: "https://example.com",
      save_to: "data/page.md",
    });
    expect(result.risk).toBe("moderate");
    expect(result.reason).toContain("local filesystem write");
  });

  it("classifies web_fetch with outside-project save_to as dangerous", () => {
    const result = classifyRisk("web_fetch", {
      url: "https://example.com",
      save_to: "/tmp/page.md",
    });
    expect(result.risk).toBe("dangerous");
    expect(result.reason).toContain("outside project directory");
    expect(result.reason).not.toContain("/tmp");
  });

  it("classifies http_request POST as moderate", () => {
    const { risk } = classifyRisk("http_request", { url: "https://api.example.com", method: "POST" });
    expect(risk).toBe("moderate");
  });

  it("classifies http_request DELETE as moderate", () => {
    const { risk } = classifyRisk("http_request", { url: "https://api.example.com/item/1", method: "DELETE" });
    expect(risk).toBe("moderate");
  });

  it("classifies file_write outside project as dangerous", () => {
    const { risk } = classifyRisk("file_write", { path: "/etc/passwd" });
    expect(risk).toBe("dangerous");
  });

  it("classifies file_edit within project as moderate", () => {
    const { risk } = classifyRisk("file_edit", { path: "src/foo.ts" });
    expect(risk).toBe("moderate");
  });

  it("classifies unknown tools as moderate", () => {
    const { risk } = classifyRisk("mcp__some_tool", {});
    expect(risk).toBe("moderate");
  });

  it("classifies delegate as moderate", () => {
    const { risk } = classifyRisk("delegate", { task: "research something" });
    expect(risk).toBe("moderate");
  });

  it("classifies schedule as moderate", () => {
    const { risk } = classifyRisk("schedule", { description: "check email" });
    expect(risk).toBe("moderate");
  });

  it("classifies process with safe command as moderate", () => {
    const { risk } = classifyRisk("process", { command: "node server.js" });
    expect(risk).toBe("moderate");
  });

  it("classifies process with kill as dangerous", () => {
    const { risk } = classifyRisk("process", { command: "kill -9 1234" });
    expect(risk).toBe("dangerous");
  });
});

describe("resolvePolicy", () => {
  it("returns policy for risk level from config", () => {
    const config: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
    };
    expect(resolvePolicy("shell", "dangerous", config)).toBe("confirm");
    expect(resolvePolicy("grep", "safe", config)).toBe("allow");
  });

  it("applies tool-level overrides", () => {
    const config: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
      toolOverrides: { shell: "deny" },
    };
    expect(resolvePolicy("shell", "moderate", config)).toBe("deny");
    expect(resolvePolicy("grep", "safe", config)).toBe("allow");
  });

  it("tool override takes precedence over risk policy", () => {
    const config: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
      toolOverrides: { file_read: "deny" },
    };
    expect(resolvePolicy("file_read", "safe", config)).toBe("deny");
  });
});

describe("assess", () => {
  it("combines classification and policy resolution", () => {
    const result = assess("shell", { command: "rm -rf /tmp" });
    expect(result.tool).toBe("shell");
    expect(result.risk).toBe("dangerous");
    expect(result.policy).toBe("confirm");
    expect(result.reason).toContain("destructive");
  });

  it("allows safe tools by default", () => {
    // Use a core tool (ask_user) to avoid needing module loaded
    const result = assess("ask_user", {});
    expect(result.risk).toBe("safe");
    expect(result.policy).toBe("allow");
  });

  it("allows moderate tools by default", () => {
    const result = assess("file_edit", { path: "src/foo.ts" });
    expect(result.risk).toBe("moderate");
    expect(result.policy).toBe("allow");
  });

  it("respects custom config", () => {
    const config: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "confirm", dangerous: "deny" },
    };
    const result = assess("file_edit", { path: "src/foo.ts" }, config);
    expect(result.policy).toBe("confirm");
  });
});

describe("nonInteractiveConfig", () => {
  it("queues dangerous operations for approval by default", () => {
    const config = nonInteractiveConfig();
    expect(config.policies.dangerous).toBe("queue");
    expect(config.policies.safe).toBe("allow");
    expect(config.policies.moderate).toBe("allow");
  });

  it("preserves tool overrides from base config", () => {
    const base: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
      toolOverrides: { shell: "allow" },
    };
    const config = nonInteractiveConfig(base);
    expect(config.policies.dangerous).toBe("queue");
    expect(config.toolOverrides?.shell).toBe("allow");
  });
});

describe("sanitizeGuardrailsConfig", () => {
  it("returns default policies for empty object", () => {
    const config = sanitizeGuardrailsConfig({});
    expect(config).not.toBeNull();
    expect(config!.policies.safe).toBe("allow");
    expect(config!.policies.moderate).toBe("allow");
    expect(config!.policies.dangerous).toBe("confirm");
  });

  it("accepts valid policy values", () => {
    const config = sanitizeGuardrailsConfig({
      policies: { safe: "allow", moderate: "confirm", dangerous: "deny" },
    });
    expect(config!.policies.moderate).toBe("confirm");
    expect(config!.policies.dangerous).toBe("deny");
  });

  it("accepts queue policy value", () => {
    const config = sanitizeGuardrailsConfig({
      policies: { dangerous: "queue" },
    });
    expect(config!.policies.dangerous).toBe("queue");
  });

  it("ignores invalid policy values", () => {
    const config = sanitizeGuardrailsConfig({
      policies: { safe: "invalid", moderate: "allow" },
    });
    expect(config!.policies.safe).toBe("allow"); // default kept
    expect(config!.policies.moderate).toBe("allow");
  });

  it("parses valid tool overrides", () => {
    const config = sanitizeGuardrailsConfig({
      toolOverrides: { shell: "deny", grep: "allow", bad: "invalid" },
    });
    expect(config!.toolOverrides?.shell).toBe("deny");
    expect(config!.toolOverrides?.grep).toBe("allow");
    expect(config!.toolOverrides?.bad).toBeUndefined();
  });

  it("returns null for non-object input", () => {
    expect(sanitizeGuardrailsConfig(null as never)).toBeNull();
  });
});

describe("registry-derived risk", () => {
  it("safe registrations are classified as safe by guardrails", () => {
    const safeRegs = getCoreRegistrations().filter((r) => riskFromEffect(r.effect) === "safe");
    expect(safeRegs.length).toBeGreaterThan(0);
    for (const reg of safeRegs) {
      const { risk } = classifyRisk(reg.tool.name, {});
      expect(risk).toBe("safe");
    }
  });

  it("moderate registrations are classified as moderate by guardrails (with benign input)", () => {
    const moderateRegs = getCoreRegistrations().filter((r) => riskFromEffect(r.effect) === "moderate");
    expect(moderateRegs.length).toBeGreaterThan(0);
    for (const reg of moderateRegs) {
      // Use benign input that won't trigger dangerous-content patterns
      const { risk } = classifyRisk(reg.tool.name, { command: "echo hello", code: "print(1)", path: "./foo.ts", method: "GET" });
      // shell/process/file ops may be "safe" for HTTP GET or "moderate" for benign commands
      expect(["safe", "moderate"]).toContain(risk);
    }
  });
});

describe("getDefaultConfig", () => {
  it("returns a fresh default config", () => {
    const config = getDefaultConfig();
    expect(config.policies.safe).toBe("allow");
    expect(config.policies.moderate).toBe("allow");
    expect(config.policies.dangerous).toBe("confirm");
    expect(config.toolOverrides).toBeUndefined();
  });
});
