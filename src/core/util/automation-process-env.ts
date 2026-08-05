const AUTOMATION_PROCESS_ENV = {
  CI: "true",
  GIT_OPTIONAL_LOCKS: "0",
  PNPM_CONFIG_PM_ON_FAIL: "ignore",
} as const;

export function withAutomationProcessEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...env,
    ...AUTOMATION_PROCESS_ENV,
  };
}
