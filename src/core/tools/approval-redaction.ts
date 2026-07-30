import { isApprovalCredentialClauseBoundary } from "#core/tools/approval-clause-boundary.js";
import {
	redactApprovalCommandCredentials,
	redactApprovalShortCredentialArgumentValue,
	redactApprovalUserPasswordCredential,
} from "#core/tools/approval-command-redaction.js";
import { isSensitiveToolInputKey } from "#core/tools/approval-sensitive-key.js";

export { isSensitiveToolInputKey } from "#core/tools/approval-sensitive-key.js";

const APPROVAL_CREDENTIAL_KEY_PATTERN =
  "(?:[A-Za-z0-9]+[-_])*(?:auth|authorization|credentials?|pass|password|passphrase|passcode|secret|tokens?|api[-_]?key|access[-_]?(?:key(?:[-_]?id)?|token)|private[-_]?key|secret[-_]?key|client[-_]?secret|refresh[-_]?token|signing[-_]?key|encryption[-_]?key|cookies?|pgpassword|mysql[-_]?pwd)(?:[-_][A-Za-z0-9]+)*";
const APPROVAL_CREDENTIAL_VALUE_PATTERN =
  "(?:Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]+|\"[^\"]*\"|'[^']*'|[^\\s,;&'\"]+";
const APPROVAL_AUTHORIZATION_SCHEME_PATTERN =
	/\b(auth|authorization)([ \t]*(?::|=)[ \t]*|[ \t]+is[ \t]+)[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*[ \t]+(?=[^\r\n])/gi;
const APPROVAL_CREDENTIAL_PROSE_PATTERN = new RegExp(
	`\\b(${APPROVAL_CREDENTIAL_KEY_PATTERN})([ \\t]+is[ \\t]+)(?=[^\\r\\n])`,
	"gi",
);
const APPROVAL_CREDENTIAL_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(${APPROVAL_CREDENTIAL_KEY_PATTERN})(\\s*(?::|=)\\s*|\\s+is\\s+)(?!\\[redacted\\])(${APPROVAL_CREDENTIAL_VALUE_PATTERN})`,
  "gi",
);
const APPROVAL_CREDENTIAL_FLAG_PATTERN = new RegExp(
  `(--${APPROVAL_CREDENTIAL_KEY_PATTERN})(\\s+|=)(${APPROVAL_CREDENTIAL_VALUE_PATTERN})`,
  "gi",
);
const APPROVAL_USER_PASSWORD_FLAG_PATTERN =
	/(--(?:proxy-)?user)(\s+|=)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const APPROVAL_CURL_USER_PASSWORD_FLAG_PATTERN =
	/(\bcurl\b(?:(?![;&|]).)*?\s-[uU])(\s+|=)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const APPROVAL_CURL_ATTACHED_USER_PASSWORD_FLAG_PATTERN =
	/(\bcurl\b(?:(?![;&|]).)*?\s-[uU])(=?)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const APPROVAL_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const APPROVAL_BASIC_PATTERN = /\bBasic\s+[A-Za-z0-9._~+/=-]+/gi;
const APPROVAL_DOUBLE_QUOTED_CREDENTIAL_PATTERN = new RegExp(
	`("${APPROVAL_CREDENTIAL_KEY_PATTERN}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
	"gi",
);
const APPROVAL_SINGLE_QUOTED_CREDENTIAL_PATTERN = new RegExp(
	`('${APPROVAL_CREDENTIAL_KEY_PATTERN}'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`,
	"gi",
);
const APPROVAL_PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g;
const APPROVAL_URI_PASSWORD_PATTERN =
  /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:)[^/\s@]+(@)/g;
const APPROVAL_URI_USERINFO_PATTERN =
  /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s:@]+(@)/g;

/** Redact an argv value when the preceding flag identifies a credential. */
export function redactApprovalCredentialArgumentValue(
	flag: string,
	value: string,
	command?: string,
): string | undefined {
	const shortFlagRedaction = redactApprovalShortCredentialArgumentValue(
		flag,
		value,
		command,
	);
	if (shortFlagRedaction !== undefined) return shortFlagRedaction;

	const normalizedFlag = flag.toLowerCase();
	if (normalizedFlag === "--user" || normalizedFlag === "--proxy-user") {
		return redactApprovalUserPasswordCredential(value);
	}
	if (!normalizedFlag.startsWith("--") || normalizedFlag.includes("=")) {
		return undefined;
	}
	return isSensitiveToolInputKey(normalizedFlag.slice(2))
		? "[redacted]"
		: undefined;
}

/**
 * Redact credential values embedded in otherwise reviewable operator text.
 * This deliberately preserves ordinary targets such as paths, email addresses,
 * arguments, and operation names; the general evidence scrubber is broader
 * than the approval-review boundary needs.
 */
export function redactApprovalCredentialText(text: string): string {
  const structuredText = text
    .replace(APPROVAL_URI_PASSWORD_PATTERN, "$1[redacted]$2")
    .replace(APPROVAL_URI_USERINFO_PATTERN, "$1[redacted]$2")
    .replace(APPROVAL_DOUBLE_QUOTED_CREDENTIAL_PATTERN, '$1"[redacted]"')
    .replace(APPROVAL_SINGLE_QUOTED_CREDENTIAL_PATTERN, "$1'[redacted]'");

  const flaggedText = redactAuthorizationSchemeValues(
    redactCredentialProseValues(structuredText),
  )
    .replace(
      APPROVAL_CREDENTIAL_FLAG_PATTERN,
      (_match, flag: string, separator: string) => `${flag}${separator}[redacted]`,
    )
    .replace(
      APPROVAL_USER_PASSWORD_FLAG_PATTERN,
      (_match, flag: string, separator: string, credential: string) =>
        `${flag}${separator}${redactApprovalUserPasswordCredential(credential)}`,
    )
    .replace(
      APPROVAL_CURL_USER_PASSWORD_FLAG_PATTERN,
      (_match, prefix: string, separator: string, credential: string) =>
        `${prefix}${separator}${redactApprovalUserPasswordCredential(credential)}`,
    )
    .replace(
      APPROVAL_CURL_ATTACHED_USER_PASSWORD_FLAG_PATTERN,
      (_match, prefix: string, separator: string, credential: string) =>
        `${prefix}${separator}${redactApprovalUserPasswordCredential(credential)}`,
    );

  return redactApprovalCommandCredentials(flaggedText)
    .replace(
      APPROVAL_CREDENTIAL_ASSIGNMENT_PATTERN,
      (_match, key: string, separator: string) => `${key}${separator}[redacted]`,
    )
    .replace(APPROVAL_BEARER_PATTERN, "Bearer [redacted]")
    .replace(APPROVAL_BASIC_PATTERN, "Basic [redacted]")
    .replace(APPROVAL_PRIVATE_KEY_BLOCK_PATTERN, "[redacted]");
}

function redactCredentialProseValues(text: string): string {
	let cursor = 0;
	let redacted = "";
	APPROVAL_CREDENTIAL_PROSE_PATTERN.lastIndex = 0;

	for (
		let match = APPROVAL_CREDENTIAL_PROSE_PATTERN.exec(text);
		match !== null;
		match = APPROVAL_CREDENTIAL_PROSE_PATTERN.exec(text)
	) {
		const valueStart = match.index + match[0].length;
		const valueEnd = findCredentialProseValueEnd(text, valueStart);
		redacted += text.slice(cursor, match.index);
		redacted += `${match[1]}${match[2]}[redacted]`;
		cursor = valueEnd;
		APPROVAL_CREDENTIAL_PROSE_PATTERN.lastIndex = valueEnd;
	}

	return `${redacted}${text.slice(cursor)}`;
}

function findCredentialProseValueEnd(text: string, valueStart: number): number {
	const quote = text[valueStart] === "'" || text[valueStart] === '"'
		? text[valueStart]
		: undefined;
	for (let index = valueStart + (quote === undefined ? 0 : 1); index < text.length; index += 1) {
		const character = text[index];
		if (character === "\r" || character === "\n") return index;
		if (quote !== undefined) {
			if (character === "\\" && quote === '"') {
				index += 1;
				continue;
			}
			if (character === quote) return index + 1;
			continue;
		}
		if (
				isApprovalCredentialClauseBoundary(text, index)
			|| ([",", ";", ".", "!", "?"].includes(character)
				&& (index + 1 === text.length || /\s/.test(text[index + 1] ?? "")))
			|| (character === "&" && text[index + 1] === "&")
			|| (character === "|" && (text[index + 1] === "|" || /\s/.test(text[index + 1] ?? "")))
		) {
			return index;
		}
	}
	return text.length;
}

function redactAuthorizationSchemeValues(text: string): string {
	let cursor = 0;
	let redacted = "";
	APPROVAL_AUTHORIZATION_SCHEME_PATTERN.lastIndex = 0;

	for (
		let match = APPROVAL_AUTHORIZATION_SCHEME_PATTERN.exec(text);
		match !== null;
		match = APPROVAL_AUTHORIZATION_SCHEME_PATTERN.exec(text)
	) {
		const valueEnd = findAuthorizationValueEnd(text, match.index, match[0].length);
		redacted += text.slice(cursor, match.index);
		redacted += `${match[1]}${match[2]}[redacted]`;
		cursor = valueEnd;
		APPROVAL_AUTHORIZATION_SCHEME_PATTERN.lastIndex = valueEnd;
	}

	return `${redacted}${text.slice(cursor)}`;
}

function findAuthorizationValueEnd(
	text: string,
	matchStart: number,
	matchLength: number,
): number {
	const valueStart = matchStart + matchLength;
	const enclosingQuote = findEnclosingQuote(text, matchStart);
	for (let index = valueStart; index < text.length; index += 1) {
		const character = text[index];
		if (character === "\r" || character === "\n") return index;
		if (enclosingQuote !== undefined) {
			if (character === "\\" && enclosingQuote === '"') {
				index += 1;
				continue;
			}
			if (character === enclosingQuote) return index;
			continue;
		}
		if (
			isAuthorizationSentenceBoundary(text, index)
				|| isApprovalCredentialClauseBoundary(text, index)
			|| (character === ";" && /\s/.test(text[index + 1] ?? ""))
			|| (character === "&" && text[index + 1] === "&")
			|| (character === "|" && (text[index + 1] === "|" || /\s/.test(text[index + 1] ?? "")))
		) {
			return index;
		}
	}
	return text.length;
}

function isAuthorizationSentenceBoundary(text: string, index: number): boolean {
	const character = text[index];
	const nextCharacter = text[index + 1];
	if (character === ",") {
		return !/^[ \t]*[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*[ \t]*=/.test(
			text.slice(index + 1),
		);
	}
	return [".", "!", "?"].includes(character)
		&& (nextCharacter === undefined || /\s/.test(nextCharacter));
}

function findEnclosingQuote(text: string, targetIndex: number): "'" | '"' | undefined {
	const lineStart = Math.max(
		text.lastIndexOf("\n", targetIndex - 1),
		text.lastIndexOf("\r", targetIndex - 1),
	) + 1;
	let quote: "'" | '"' | undefined;
	for (let index = lineStart; index < targetIndex; index += 1) {
		const character = text[index];
		if (character === "\\" && quote !== "'") {
			index += 1;
			continue;
		}
		if (character !== "'" && character !== '"') continue;
		quote = quote === undefined ? character : quote === character ? undefined : quote;
	}
	return quote;
}
