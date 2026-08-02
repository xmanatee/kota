import { describe, expect, it } from "vitest";
import { buildUserProfile, expandAlias, type KotaConfig } from "./config.js";

describe("buildUserProfile", () => {
  it("returns empty string when no user config", () => {
    expect(buildUserProfile({} as KotaConfig)).toBe("");
  });

  it("builds profile with name only", () => {
    const result = buildUserProfile({ user: { name: "Alex" } } as KotaConfig);
    expect(result).toContain("**User**: Alex");
    expect(result).toContain("## User Profile");
  });

  it("builds profile with name and context", () => {
    const result = buildUserProfile({
      user: { name: "Alex", context: "Senior ML engineer, prefers Python" },
    } as KotaConfig);
    expect(result).toContain("**User**: Alex");
    expect(result).toContain("Senior ML engineer, prefers Python");
  });

  it("builds profile with context only", () => {
    const result = buildUserProfile({
      user: { context: "Works on data pipelines" },
    } as KotaConfig);
    expect(result).not.toContain("**User**");
    expect(result).toContain("Works on data pipelines");
  });
});

describe("expandAlias", () => {
  const aliases: Record<string, string> = {
    "/research": "Enable web tools and thoroughly research: ",
    "/draft": "Draft a well-structured document about: ",
    "/review": "Review this code for bugs and best practices: ",
  };

  it("expands a matching alias", () => {
    const result = expandAlias("/research quantum computing", aliases);
    expect(result).toBe("Enable web tools and thoroughly research: quantum computing");
  });

  it("returns original prompt when no alias matches", () => {
    const result = expandAlias("just a normal prompt", aliases);
    expect(result).toBe("just a normal prompt");
  });

  it("handles alias with no trailing text", () => {
    expect(expandAlias("/research", aliases)).toBe(
      "Enable web tools and thoroughly research:",
    );
  });

  it("does not expand partial matches", () => {
    expect(expandAlias("/researching things", aliases)).toBe("/researching things");
  });

  it("returns original when aliases is undefined", () => {
    expect(expandAlias("/research stuff", undefined)).toBe("/research stuff");
  });
});
