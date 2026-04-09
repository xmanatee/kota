# Doctor Extension

Owns the `kota doctor` CLI health check surface.

- Entry point: `index.ts` — exports `runDoctorChecks`, `runDoctorFixes`, `checkProviderConnectivity`, `CheckResult`, `RepairResult`, and the default `KotaExtension`.
- No tools, routes, or workflows — only a CLI command contributed via `commands`.
- Tests co-located in `doctor.test.ts`.
- Imports from core (`config`, `extension-loader`, `extension-discovery`, `workflow/registry`) as needed; this is a layout migration, not a strict isolation boundary.
