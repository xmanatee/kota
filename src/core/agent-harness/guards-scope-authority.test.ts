import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scopeAuthorityOperatorTokenPath } from "#core/daemon/scope-authority-operator-token.js";
import { createWorkflowAgentGuards } from "./guards.js";

const options = {
  signal: new AbortController().signal,
  toolUseId: "scope-authority-test",
};

const tempDirectories: string[] = [];

afterEach(() => {
  for (const path of tempDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("workflow agent machine-authority guard", () => {
  it("denies authority mutations through the CLI and direct control route", async () => {
    const guard = createWorkflowAgentGuards();
    for (const command of [
      "pnpm kota project authority set scope-1 --trust trusted --reason unsafe",
      "kota project authority set scope-1 --clear-policy --reason unsafe",
      "node dist/cli.js project authority set scope-1 --trust trusted --reason unsafe",
      "curl -X PUT http://127.0.0.1:4310/scopes/scope-1/authority -d '{}';",
      "fetch('http://127.0.0.1:4310/scopes/scope-1/authority', { method: 'PUT' })",
    ]) {
      const result = await guard("Bash", { command }, options);
      expect(result).toMatchObject({
        behavior: "deny",
        decisionAttribution: "operator-deny",
      });
      if (result.behavior === "deny") {
        expect(result.message).toMatch(/interactive operator client/);
      }
    }
  });

  it("denies authority-token access through read and arbitrary-code tools", async () => {
    const guard = createWorkflowAgentGuards();
    for (const [toolName, input] of [
      ["Read", { file_path: scopeAuthorityOperatorTokenPath() }],
      ["code_exec", { code: `readFileSync('${scopeAuthorityOperatorTokenPath()}')` }],
      ["Bash", { command: `cat '${scopeAuthorityOperatorTokenPath()}'` }],
    ] as const) {
      const result = await guard(toolName, input, options);
      expect(result).toMatchObject({
        behavior: "deny",
        decisionAttribution: "operator-deny",
      });
      if (result.behavior === "deny") {
        expect(result.message).toMatch(/operator token/);
      }
    }
  });

  it("denies shell-expanded operator-token paths", async () => {
    const guard = createWorkflowAgentGuards(join(homedir(), ".kota/config.json"));
    for (const command of [
      "cat ~/.kota/scope-authority-token.json",
      "cat $HOME/.kota/scope-authority-token.json",
      "cat ${HOME}/.kota/scope-authority-token.json",
    ]) {
      const result = await guard("Bash", { command }, options);
      expect(result).toMatchObject({
        behavior: "deny",
        decisionAttribution: "operator-deny",
      });
    }
  });

  it("denies token access through absolute and relative symlink aliases", async () => {
    const priorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
    const root = mkdtempSync(join(tmpdir(), "kota-workflow-authority-guard-"));
    tempDirectories.push(root);
    const operatorDir = join(root, "operator");
    const workspaceDir = join(root, "workspace");
    mkdirSync(operatorDir);
    mkdirSync(workspaceDir);
    const tokenPath = join(operatorDir, "machine-proof.dat");
    const aliasPath = join(workspaceDir, "credential-alias");
    symlinkSync(tokenPath, aliasPath);
    process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = tokenPath;

    try {
      const guard = createWorkflowAgentGuards(join(operatorDir, "config.json"));
      for (const command of [
        `cat '${aliasPath}'`,
        "cat ./credential-alias",
      ]) {
        const result = await guard("Bash", { command, cwd: workspaceDir }, options);
        expect(result).toMatchObject({
          behavior: "deny",
          decisionAttribution: "operator-deny",
        });
      }
    } finally {
      if (priorTokenPath === undefined) {
        delete process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
      } else {
        process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = priorTokenPath;
      }
    }
  });

  it("denies the configured arbitrary operator-token path", async () => {
    const priorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
    const tokenPath = "/operator/credentials/machine-proof.dat";
    process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = tokenPath;
    try {
      const guard = createWorkflowAgentGuards("/operator/config.json");
      const result = await guard("Read", { file_path: tokenPath }, options);

      expect(result).toMatchObject({
        behavior: "deny",
        decisionAttribution: "operator-deny",
      });
      if (result.behavior === "deny") {
        expect(result.message).toMatch(/operator token/);
      }
    } finally {
      if (priorTokenPath === undefined) {
        delete process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
      } else {
        process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = priorTokenPath;
      }
    }
  });
});
