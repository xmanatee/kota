import { describe, expect, it } from "vitest";
import { isSensitiveConfigKey, maskConfig } from "./config-redaction.js";

describe("config redaction", () => {
	it("treats private-key and assertion-shaped names as sensitive", () => {
		for (const key of [
			"privateKey",
			"privateKeyPem",
			"private_key",
			"private_key_jwt",
			"signingKey",
			"signing_key",
			"clientAssertion",
			"client_assertion",
		]) {
			expect(isSensitiveConfigKey(key), key).toBe(true);
		}

		expect(isSensitiveConfigKey("publicKey")).toBe(false);
		expect(isSensitiveConfigKey("teamKey")).toBe(false);
	});

	it("masks private-key and assertion-shaped values throughout config data", () => {
		const masked = maskConfig({
			modules: {
				demo: {
					privateKeyPem: "-----BEGIN PRIVATE KEY-----",
					private_key: "private-key-material",
					signingKey: "signing-key-material",
					clientAssertion: "signed-client-assertion",
					teamKey: "OPS",
				},
			},
			entries: [
				{
					client_assertion: "nested-client-assertion",
					publicKey: "public-key-material",
				},
			],
		});

		const serialized = JSON.stringify(masked);
		expect(serialized).not.toContain("-----BEGIN PRIVATE KEY-----");
		expect(serialized).not.toContain("private-key-material");
		expect(serialized).not.toContain("signing-key-material");
		expect(serialized).not.toContain("signed-client-assertion");
		expect(serialized).not.toContain("nested-client-assertion");
		expect(serialized).toContain('"privateKeyPem":"***"');
		expect(serialized).toContain('"private_key":"***"');
		expect(serialized).toContain('"signingKey":"***"');
		expect(serialized).toContain('"clientAssertion":"***"');
		expect(serialized).toContain('"client_assertion":"***"');
		expect(serialized).toContain("OPS");
		expect(serialized).toContain("public-key-material");
	});
});
