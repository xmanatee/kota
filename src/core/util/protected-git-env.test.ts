import { describe, expect, it } from "vitest";
import {
  buildFilteredInheritedSubprocessEnv,
  buildRequiredInheritedSubprocessEnv,
} from "#core/modules/subprocess-env.js";
import { withProtectedGitBareRepositoryEnv } from "./protected-git-env.js";

describe("protected git environment", () => {
  it("adds safe.bareRepository=explicit without mutating the source env", () => {
    const source = { PATH: "/bin" };

    const env = withProtectedGitBareRepositoryEnv(source);

    expect(source).toEqual({ PATH: "/bin" });
    expect(env.PATH).toBe("/bin");
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("safe.bareRepository");
    expect(env.GIT_CONFIG_VALUE_0).toBe("explicit");
  });

  it("removes inherited Git command-line config parameters", () => {
    const env = withProtectedGitBareRepositoryEnv({
      GIT_CONFIG_PARAMETERS: "safe.bareRepository=all",
    });

    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("safe.bareRepository");
    expect(env.GIT_CONFIG_VALUE_0).toBe("explicit");
  });

  it("preserves other env config entries while replacing inherited bare-repo policy", () => {
    const env = withProtectedGitBareRepositoryEnv({
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "KOTA",
      GIT_CONFIG_KEY_1: "safe.bareRepository",
      GIT_CONFIG_VALUE_1: "all",
      GIT_CONFIG_KEY_2: "color.ui",
      GIT_CONFIG_VALUE_2: "false",
    });

    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_KEY_0).toBe("user.name");
    expect(env.GIT_CONFIG_VALUE_0).toBe("KOTA");
    expect(env.GIT_CONFIG_KEY_1).toBe("color.ui");
    expect(env.GIT_CONFIG_VALUE_1).toBe("false");
    expect(env.GIT_CONFIG_KEY_2).toBe("safe.bareRepository");
    expect(env.GIT_CONFIG_VALUE_2).toBe("explicit");
  });

  it("protects filtered inherited subprocess env while stripping KOTA-owned keys", () => {
    const env = buildFilteredInheritedSubprocessEnv({
      PATH: "/bin",
      KOTA_SESSION_ID: "session",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.bareRepository",
      GIT_CONFIG_VALUE_0: "all",
    });

    expect(env.PATH).toBe("/bin");
    expect(env.KOTA_SESSION_ID).toBeUndefined();
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("safe.bareRepository");
    expect(env.GIT_CONFIG_VALUE_0).toBe("explicit");
  });

  it("protects minimal required subprocess env", () => {
    const env = buildRequiredInheritedSubprocessEnv({
      PATH: "/bin",
      HOME: "/tmp/home",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.email",
      GIT_CONFIG_VALUE_0: "kota@example.com",
    });

    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("safe.bareRepository");
    expect(env.GIT_CONFIG_VALUE_0).toBe("explicit");
  });
});
