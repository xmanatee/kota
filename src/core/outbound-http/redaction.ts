const SENSITIVE_HEADER = /(?:authorization|cookie|token|api[-_]?key|secret|signature|credential)/i;
const SENSITIVE_QUERY = /(?:token|api[-_]?key|secret|signature|credential|password|code)/i;
const JSON_STRING_VALUE = /("((?:\\.|[^"\\])*)"\s*:\s*)"(?:\\.|[^"\\])*"/g;
const SENSITIVE_FIELD_SEGMENT =
  /(?:^|[-_])(?:authorization|cookie|token|api[-_]?key|secret|signature|credential|password|code)(?:$|[-_])/i;
const MULTI_PART_SECRET_TEXT_VALUE =
  /(\b(?:authorization|proxy-authorization|cookie|set-cookie)\b\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^"'\r\n}\]]+)/gi;
const SENSITIVE_TEXT_VALUE =
  /(token|api[-_]?key|secret|password|credential)(\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,&;}\]"']+)/gi;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;

function isSensitiveFieldName(name: string): boolean {
  const separatorNormalized = name.replace(/([a-z\d])([A-Z])/g, "$1_$2");
  return SENSITIVE_FIELD_SEGMENT.test(separatorNormalized);
}

export function redactOutboundHttpUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return redactFreeTextSecrets(rawUrl);
  }
  if (url.username) url.username = "[redacted]";
  if (url.password) url.password = "[redacted]";
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, "[redacted]");
  }
  url.hash = "";
  return url.toString();
}

export function redactOutboundHttpHeaders(headers: Headers): Readonly<Record<string, string>> {
  const redacted: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    redacted[name] = SENSITIVE_HEADER.test(name) ? "[redacted]" : redactOutboundHttpText(value);
  }
  return redacted;
}

export function redactOutboundHttpText(text: string): string {
  return text
    .replace(URL_IN_TEXT, (url) => redactOutboundHttpUrl(url))
    .replace(JSON_STRING_VALUE, (value, prefix: string, fieldName: string) =>
      isSensitiveFieldName(fieldName) ? `${prefix}"[redacted]"` : value
    )
    .replace(MULTI_PART_SECRET_TEXT_VALUE, "$1[redacted]")
    .replace(SENSITIVE_TEXT_VALUE, "$1$2[redacted]");
}

function redactFreeTextSecrets(text: string): string {
  return text.replace(MULTI_PART_SECRET_TEXT_VALUE, "$1[redacted]").replace(SENSITIVE_TEXT_VALUE, "$1$2[redacted]");
}
