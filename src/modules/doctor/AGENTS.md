# Doctor Module

Owns the `kota doctor` CLI health check surface.

- Entry point: `index.ts` — exports `runDoctorChecks`, `runDoctorFixes`, `checkProviderConnectivity`, `CheckResult`, `RepairResult`, and the default `KotaModule`.
- No tools, routes, or workflows — only a CLI command contributed via `commands`.
- Tests co-located in `doctor.test.ts`.
- Imports from core (`config`, `module-loader`, `module-discovery`, `workflow/registry`) as needed; this is a layout migration, not a strict isolation boundary.
