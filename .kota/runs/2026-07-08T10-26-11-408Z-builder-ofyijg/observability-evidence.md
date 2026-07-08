## Observability Evidence

The progress-review finding cited:

- event:evtj-000000158780
- task:task-security-review-queued-mcp-approvals-only-pin-the-
- git:commit:bcf3e436f856

Resolution evidence:

- `observability-obligation-recheck.json` replays commit `bcf3e436f856` with this follow-up's focused metadata assertion diff. It reports `outcome: "ok"`, `missingFiles: []`, and maps all four cited files to focused test assertions.
- `src/core/daemon/approval-queue-mcp.test.ts` now asserts stored MCP approval metadata, including `serverTransportIdentityFingerprint`, after queue persistence.
- `src/core/tools/tool-runner-mcp-approval.test.ts` now asserts the queued MCP approval metadata object passed through the tool-runner approval path, including the transport identity fingerprint.
- `src/modules/autonomy/observability-obligation.test.ts` now models the MCP approval transport identity change and asserts the diagnostic accepts the focused metadata evidence for every cited core file.
