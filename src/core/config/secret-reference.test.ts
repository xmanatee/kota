import { describe, expect, it } from "vitest";
import {
  isSecretReference,
  resolveSecretReference,
  secretReferenceName,
} from "./secret-reference.js";

describe("secret reference helpers", () => {
  it("recognizes setup-compatible secret references", () => {
    expect(isSecretReference("$GITHUB_TOKEN")).toBe(true);
    expect(isSecretReference("$SLACK_APP_TOKEN_2")).toBe(true);
    expect(isSecretReference("plain-token")).toBe(false);
    expect(isSecretReference("$lowercase")).toBe(false);
  });

  it("extracts the referenced secret name", () => {
    expect(secretReferenceName("$SMTP_PASS")).toBe("SMTP_PASS");
    expect(secretReferenceName("smtp-pass")).toBeNull();
  });

  it("resolves through the provided secret resolver before the environment", () => {
    process.env.KOTA_SECRET_REFERENCE_TEST = "env-value";
    try {
      expect(resolveSecretReference(
        "$KOTA_SECRET_REFERENCE_TEST",
        () => "store-value",
      )).toBe("store-value");
      expect(resolveSecretReference("$KOTA_SECRET_REFERENCE_TEST")).toBe("env-value");
      expect(resolveSecretReference("$MISSING_KOTA_SECRET_REFERENCE_TEST")).toBe("");
      expect(resolveSecretReference("literal-value")).toBe("literal-value");
    } finally {
      delete process.env.KOTA_SECRET_REFERENCE_TEST;
    }
  });
});
