const APPROVAL_COMMAND_CREDENTIAL_VALUE_PATTERN =
	`("(?:\\\\.|[^"\\\\])*"|'[^']*'|[^\\s,;&'"]+)`;
const APPROVAL_PASSWORD_COMMAND_PATTERN =
	/\b(sshpass|mysql|mysqladmin|mariadb|mariadb-admin|mongo|mongosh|redis-cli|valkey-cli)(?:\.exe)?\b(?:"(?:\\.|[^"\\])*"|'[^']*'|\\.|[^'"\\\r\n;&|])*/gi;

export function redactApprovalShortCredentialArgumentValue(
	flag: string,
	value: string,
	command?: string,
): string | undefined {
	const normalizedFlag = flag.toLowerCase();
	if (normalizedFlag === "-u" && getExecutableName(command) === "curl") {
		return redactApprovalUserPasswordCredential(value);
	}
	if (isSeparatedPasswordOnlyShortCredentialFlag(flag, command)) {
		return "[redacted]";
	}
	return undefined;
}

export function redactApprovalShortCredentialArgument(
	argument: string,
	command?: string,
): string | undefined {
	const userPasswordMatch = /^(-[uU])(=?)(.+)$/.exec(argument);
	if (userPasswordMatch !== null && getExecutableName(command) === "curl") {
		return `${userPasswordMatch[1]}${userPasswordMatch[2]}${redactApprovalUserPasswordCredential(userPasswordMatch[3])}`;
	}

	const passwordMatch = /^(-[A-Za-z])(=?)(.+)$/.exec(argument);
	if (
		passwordMatch === null
		|| !isPasswordOnlyShortCredentialFlag(passwordMatch[1], command)
	) {
		return undefined;
	}
	return `${passwordMatch[1]}${passwordMatch[2]}${redactWholeCredential(passwordMatch[3])}`;
}

export function redactApprovalCommandCredentials(text: string): string {
	return text.replace(
		APPROVAL_PASSWORD_COMMAND_PATTERN,
		(segment: string, executable: string) => redactPasswordFlagsForCommand(
			segment,
			executable.toLowerCase(),
		),
	);
}

function redactPasswordFlagsForCommand(segment: string, executable: string): string {
	const flag = executable === "redis-cli" || executable === "valkey-cli" ? "a" : "p";
	const allowsSeparatedValue = ![
		"mysql",
		"mysqladmin",
		"mariadb",
		"mariadb-admin",
	].includes(executable);
	const separatorPattern = allowsSeparatedValue ? "(\\s+|=?)" : "(=?)";
	const pattern = new RegExp(
		`(\\s-${flag})${separatorPattern}${APPROVAL_COMMAND_CREDENTIAL_VALUE_PATTERN}`,
		"g",
	);
	return segment.replace(
		pattern,
		(_match, prefix: string, separator: string, credential: string) =>
			`${prefix}${separator}${redactWholeCredential(credential)}`,
	);
}

function isSeparatedPasswordOnlyShortCredentialFlag(
	flag: string,
	command: string | undefined,
): boolean {
	const executable = getExecutableName(command);
	if (["mysql", "mysqladmin", "mariadb", "mariadb-admin"].includes(executable ?? "")) {
		return false;
	}
	return isPasswordOnlyShortCredentialFlag(flag, command);
}

function isPasswordOnlyShortCredentialFlag(flag: string, command: string | undefined): boolean {
	switch (getExecutableName(command)) {
		case "sshpass":
		case "mysql":
		case "mysqladmin":
		case "mariadb":
		case "mariadb-admin":
		case "mongo":
		case "mongosh":
			return flag === "-p";
		case "redis-cli":
		case "valkey-cli":
			return flag === "-a";
		default:
			return false;
	}
}

function getExecutableName(command: string | undefined): string | undefined {
	if (command === undefined) return undefined;
	const executable = command.trim().split(/[\\/]/).at(-1)?.toLowerCase();
	return executable?.endsWith(".exe") ? executable.slice(0, -4) : executable;
}

function redactWholeCredential(credential: string): string {
	const quote = credential.startsWith('"') || credential.startsWith("'")
		? credential[0]
		: "";
	return quote === "" ? "[redacted]" : `${quote}[redacted]${quote}`;
}

export function redactApprovalUserPasswordCredential(credential: string): string {
	const quote = credential.startsWith('"') || credential.startsWith("'")
		? credential[0]
		: "";
	const value = quote === "" ? credential : credential.slice(1, -1);
	const separatorIndex = value.indexOf(":");
	const redacted = separatorIndex < 0
		? "[redacted]"
		: `${value.slice(0, separatorIndex + 1)}[redacted]`;
	return `${quote}${redacted}${quote}`;
}
