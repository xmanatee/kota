export type RedactedConfigValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| RedactedConfigValue[]
	| RedactedConfigObject;

export type RedactedConfigObject = {
	[key: string]: RedactedConfigValue;
};

type ConfigRedactionInputValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly ConfigRedactionInputValue[]
	| ConfigRedactionInputObject;

type ConfigRedactionInputObject = {
	readonly [key: string]: ConfigRedactionInputValue;
};

const SENSITIVE_CONFIG_KEY_PATTERN =
	/(authorization|bearer|credential|password|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|signing[-_]?key|client[-_]?assertion|refresh[-_]?token|cookie)/i;

export function isSensitiveConfigKey(key: string): boolean {
	return SENSITIVE_CONFIG_KEY_PATTERN.test(key);
}

export function maskConfig(config: object): RedactedConfigObject {
	return maskConfigValue(config) as RedactedConfigObject;
}

/**
 * Project one resolved config value for a client-visible boundary.
 *
 * A lookup of a sensitive path must hide the matched leaf itself, while a
 * lookup of a parent object or array recursively hides sensitive descendants.
 */
export function maskConfigValue(
	value: unknown,
	requestedPath: readonly string[] = [],
): RedactedConfigValue {
	if (requestedPath.some(isSensitiveConfigKey)) return "***";
	return walkAndMask(value as ConfigRedactionInputValue);
}

function walkAndMask(value: ConfigRedactionInputValue): RedactedConfigValue {
	if (Array.isArray(value)) return value.map(walkAndMask);
	if (value !== null && typeof value === "object") {
		const result: RedactedConfigObject = {};
		for (const [key, nested] of Object.entries(value)) {
			result[key] = isSensitiveConfigKey(key) ? "***" : walkAndMask(nested);
		}
		return result;
	}
	return value;
}
