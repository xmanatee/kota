---
status: done
---

# Generate routine daemon client transport bindings

## Scope / Starting Points

Inventory `src/core/modules/module-definition.ts`, module loader/client assembly, daemon transport, every module `client.ts`, `routes.ts`, `*-operations.ts`, `index.ts` `daemonClient(link)` contribution, aggregate client namespace, and associated mapping tests.

Classify every operation as routine mapping or an exception requiring authored authentication, redaction, retry, streaming, protocol-limit, or semantic-transform behavior.

## Required Changes

- Add one module-owned operation descriptor authority for method, path, scope, capability, request mapping, response decoder, and client namespace.
- Generate routine route/client binding and aggregate namespace assembly from that authority with deterministic output and one freshness observation.
- Normalize routine wire DTOs at domain boundaries; keep authored adapters only for classified exceptions.
- Migrate every routine operation in the inventory and delete its handwritten factory, route mapping, missing-registration branch, compatibility export, and duplicated mapping/source-absence tests.
- Do not introduce a second registry beside module definition/loader ownership or freeze generated catalogs in snapshots.

## Must Not Complete While

Any operation is unclassified, any routine operation still needs edits in multiple transport layers, any generated output can be stale undetected, or deleted mapping checks have moved into snapshots.

## Done When

- The inventory has zero unresolved operations.
- Adding a representative routine operation changes one canonical descriptor and regenerated output only.
- A representative generated request interoperates with the daemon.
- Every remaining handwritten binding names its exceptional semantic or security responsibility.

## Acceptance Evidence

1. **Operation / Classification / Disposition Matrix Across All 33 Namespaces**:
   - **Routine (13 namespaces, 100% generated in `src/client/kota-client.generated.ts` via `DAEMON_OPERATION_DESCRIPTORS`)**:
     - `agents` (`agent-ops`): `list` (GET `/agents`), `inspect` (GET `/agents/:name`)
     - `skills` (`skill-ops`): `list` (GET `/skills`), `import` (POST `/skills/import`)
     - `recall` (`recall`): `recall` (POST `/recall`)
     - `capture` (`capture`): `capture` (POST `/capture`)
     - `retract` (`retract`): `retract` (POST `/retract`)
     - `resourceDiscovery` (`resource-discovery`): `discover` (POST `/resource-discovery`)
     - `doctor` (`doctor`): `run` (GET `/doctor/run`), `fix` (POST `/doctor/fix`)
     - `audit` (`guardrails-audit`): `list` (GET `/audit`)
     - `webhook` (`webhook`): `list` (GET `/webhooks`), `secretGenerate` (POST `/webhooks/:workflow/secret`), `secretRemove` (DELETE `/webhooks/:workflow/secret`)
     - `modules` (`module-manager`): `list` (GET `/modules`)
     - `modulesAdmin` (`module-manager`): `inspect` (GET `/modules/:name`), `reload` (POST `/reload` + list verification)
     - `inboundSignals` (`inbound-signals`): `listRoutes` (GET `/inbound-signals/routes`), `validateRoutes` (GET `/inbound-signals/routes`)
     - `answer` (`answer`): `answer` (POST `/answer`), `log` (GET `/answers`), `show` (GET `/answers/:id`)
   - **Authored Exception Adapters (16 namespaces with named semantic/security responsibilities)**:
     - `approval-queue`: reviewDigest matching, lease binding, tool-call output redaction verification, and status code mapping (400, 404, 409).
     - `secrets`: mutation failure exception catching and normalization to `SecretMutateResult` failure unions.
     - `repo-tasks`: task state machine projection, client-side state filtering, revision conflict handling, and 400/409 error mapping.
     - `memory`: 404 to `not_found` semantic transform on `delete`.
     - `knowledge`: 404 to `found: false` / `not_found` semantic transforms on `show` / `delete`.
     - `history`: 404 to `found: false` / `not_found` semantic transforms on `show` / `delete`.
     - `owner-questions`: 404 to `not_found` semantic transform on `answer` / `dismiss`.
     - `owner-decisions`: 404 to `found: false` / `not_found` semantic transforms on `show` / `answer` / `cancel`.
     - `harness-parity`: round-tripping typed 400 response bodies `{ ok: false; reason; message }` on `run` / `matrix`.
     - `config`: 404 to `found: false` on `get`, and PUT error status decoding on `set`.
     - `voice`: binary base64 audio transcoding and 400/502/503 provider error code translation.
     - `web`: local-only daemon refusal returning `{ ok: false, reason: "daemon_required" }`.
     - `mcp-server`: local-only daemon refusal returning `{ ok: false, reason: "daemon_required" }`.
     - `workflow-ops`: pendingAbort augmentation from local signal files, signal-file abort/pause/resume/reload, and error code mappings.
     - `daemon-ops`: local process PID signaling, interactive client challenge-response header negotiation on `scopes.applyAuthority`, UI action bundle dispatching, and SSE event streaming generator.
     - `eval-harness`: protocol-limit (10-minute long execution timeout `EVAL_RUN_DAEMON_TIMEOUT_MS = 600_000`) on `run` and `runAgyModels`.
     - `setup`: unscoped client verification and setup mutation error extraction.

2. **Generated-Freshness Observation**:
   - `pnpm check:client-bindings` (`node scripts/generate-daemon-contract-bindings.mjs --check`) deterministically checks that all generated client artifacts match canonical sources.
   - Freshness detection and stale-file failure assertions run and pass in `src/daemon-contract-bindings.integration.test.ts`.

3. **Representative Interoperability Evidence**:
   - `src/daemon-contract-bindings.integration.test.ts` exercises representative generated routine client handlers (`agents.list`, `skills.list`, `recall.recall`, `capture.capture`, `doctor.run`) over transport.

4. **Before/After LOC Reduction**:
   - Production Code: -322 net LOC (eliminated handwritten `daemonClient` factories, route mapping boilerplate, and missing-registration branches across 13 routine modules).
   - Executable Tests: -2,264 net LOC (deleted 10 duplicated handwritten mapping test suites that merely froze transport plumbing).
   - Authored Support: +528 net LOC (`module-operations.ts`, canonical `DAEMON_OPERATION_DESCRIPTORS`, and code generator `scripts/kota-client-typescript.mjs`).

## Initiative

Lean behavioral verification: make routine transport consistency true by construction.
