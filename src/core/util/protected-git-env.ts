const PROTECTED_GIT_BARE_REPOSITORY_KEY = "safe.bareRepository";
const PROTECTED_GIT_BARE_REPOSITORY_KEY_NORMALIZED = "safe.barerepository";
const PROTECTED_GIT_BARE_REPOSITORY_VALUE = "explicit";
const GIT_CONFIG_ENTRY_ENV = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;

type GitConfigEnvEntry = {
  key: string;
  value: string;
};

function readGitConfigEnvEntries(env: NodeJS.ProcessEnv): GitConfigEnvEntry[] {
  const countRaw = env.GIT_CONFIG_COUNT;
  if (!countRaw) return [];
  const count = Number.parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count <= 0) return [];

  const entries: GitConfigEnvEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = env[`GIT_CONFIG_KEY_${index}`];
    const value = env[`GIT_CONFIG_VALUE_${index}`];
    if (!key || value === undefined) continue;
    entries.push({ key, value });
  }
  return entries;
}

function removeGitConfigEnvEntries(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (
      key === "GIT_CONFIG_COUNT" ||
      key === "GIT_CONFIG_PARAMETERS" ||
      GIT_CONFIG_ENTRY_ENV.test(key)
    ) {
      delete env[key];
    }
  }
}

export function withProtectedGitBareRepositoryEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const entries = readGitConfigEnvEntries(env).filter(
    (entry) =>
      entry.key.toLowerCase() !== PROTECTED_GIT_BARE_REPOSITORY_KEY_NORMALIZED,
  );
  entries.push({
    key: PROTECTED_GIT_BARE_REPOSITORY_KEY,
    value: PROTECTED_GIT_BARE_REPOSITORY_VALUE,
  });

  removeGitConfigEnvEntries(env);
  env.GIT_CONFIG_COUNT = String(entries.length);
  entries.forEach((entry, index) => {
    env[`GIT_CONFIG_KEY_${index}`] = entry.key;
    env[`GIT_CONFIG_VALUE_${index}`] = entry.value;
  });
  return env;
}
