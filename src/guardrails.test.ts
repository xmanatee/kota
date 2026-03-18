import { describe, expect, it } from "vitest";
import {
  assess,
  classifyRisk,
  type GuardrailsConfig,
  getDefaultConfig,
  nonInteractiveConfig,
  resolvePolicy,
  sanitizeGuardrailsConfig,
} from "./guardrails.js";
import { getCoreRegistrations } from "./tools/index.js";

describe("classifyRisk", () => {
  it("classifies read-only tools as safe", () => {
    for (const tool of ["file_read", "grep", "glob", "repo_map", "todo", "ask_user", "web_search", "memory"]) {
      const { risk } = classifyRisk(tool, {});
      expect(risk).toBe("safe");
    }
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

  it("classifies http_request GET as safe", () => {
    const { risk } = classifyRisk("http_request", { url: "https://example.com", method: "GET" });
    expect(risk).toBe("safe");
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
    const result = assess("grep", { pattern: "foo" });
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
    const safeRegs = getCoreRegistrations().filter((r) => r.risk === "safe");
    expect(safeRegs.length).toBeGreaterThan(0);
    for (const reg of safeRegs) {
      const { risk } = classifyRisk(reg.tool.name, {});
      expect(risk).toBe("safe");
    }
  });

  it("moderate registrations are classified as moderate by guardrails (with benign input)", () => {
    const moderateRegs = getCoreRegistrations().filter((r) => r.risk === "moderate");
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
