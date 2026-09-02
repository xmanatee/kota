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
	if (
		requestedPath.some(isSensitiveConfigKey) ||
		isForeignModuleEnvValuePath(requestedPath)
	) {
		return "***";
	}
	return walkAndMask(value as ConfigRedactionInputValue, requestedPath);
}

function isForeignModuleEnvValuePath(path: readonly string[]): boolean {
	// Inline foreign-module environment entries are credential-bearing by
	// schema, even when the operator chose a neutral variable name.
	return (
		path.length > 3 &&
		path[0] === "foreignModules" &&
		/^\d+$/.test(path[1] ?? "") &&
		path[2] === "env"
	);
}

function walkAndMask(
	value: ConfigRedactionInputValue,
	path: readonly string[],
): RedactedConfigValue {
	if (Array.isArray(value)) {
		return value.map((nested, index) =>
			walkAndMask(nested, [...path, String(index)]),
		);
	}
	if (value !== null && typeof value === "object") {
		const result: RedactedConfigObject = {};
		for (const [key, nested] of Object.entries(value)) {
			const nestedPath = [...path, key];
			result[key] =
				isSensitiveConfigKey(key) || isForeignModuleEnvValuePath(nestedPath)
					? "***"
					: walkAndMask(nested, nestedPath);
		}
		return result;
	}
	return value;
}
