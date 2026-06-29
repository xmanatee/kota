import type { KotaConfig } from "#core/config/config.js";

export function builderWorktreeModeEnabledFromConfig(
  config: Pick<KotaConfig, "modules"> | undefined,
): boolean {
  return config?.modules?.builder?.branchPerTask !== false;
}

export function builderMaxConcurrentRunsFromConfig(
  config: Pick<KotaConfig, "modules"> | undefined,
): number {
  return builderWorktreeModeEnabledFromConfig(config) ? 2 : 1;
}
