#!/usr/bin/env node
// Fixture stub for the workflow-validate repair check. The real improver
// repair loop runs `node dist/cli.js workflow validate` via the autonomy
// `runCheck` surface; in the fixture replay the validation is out of
// scope (the subprocess executor runs KOTA from a different checkout),
// so this stub exits 0 for any arguments it receives. The genuine
// validator is exercised by KOTA's own typecheck/test suites, which are
// what the workflow step is really guarding against in production.
process.exit(0);
