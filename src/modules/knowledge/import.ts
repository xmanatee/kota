type ImportJsonValue =
	| string
	| number
	| boolean
	| null
	| ImportJsonValue[]
	| { [key: string]: ImportJsonValue };

export type RawImportEntry = {
	title?: ImportJsonValue;
	body?: ImportJsonValue;
	tags?: ImportJsonValue;
};

/** Parse a JSON or JSONL file into raw entry objects. */
export function parseImportEntries(content: string): RawImportEntry[] {
	const trimmed = content.trim();
	if (trimmed.startsWith("[")) {
		const parsed = JSON.parse(trimmed) as ImportJsonValue;
		if (!Array.isArray(parsed)) throw new Error("JSON file must be an array");
		return parsed as RawImportEntry[];
	}
	return trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as RawImportEntry);
}
