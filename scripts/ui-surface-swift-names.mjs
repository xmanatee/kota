const SWIFT_KEYWORDS = new Set([
  "associatedtype", "class", "deinit", "enum", "extension", "fileprivate",
  "func", "import", "init", "inout", "internal", "let", "open", "operator",
  "private", "protocol", "public", "rethrows", "static", "struct", "subscript",
  "typealias", "var", "break", "case", "continue", "default", "defer", "do",
  "else", "fallthrough", "for", "guard", "if", "in", "repeat", "return",
  "switch", "where", "while", "as", "catch", "false", "is", "nil", "super",
  "self", "Self", "throw", "throws", "true", "try",
]);

function words(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function upperCamel(value) {
  return words(value).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
}

export function lowerCamel(value) {
  const name = upperCamel(value);
  return name.length === 0 ? "value" : name[0].toLowerCase() + name.slice(1);
}

export function swiftIdentifier(value) {
  const name = lowerCamel(value);
  return SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

export function swiftCaseReference(value) {
  return `.${swiftIdentifier(value)}`;
}

export function singular(value) {
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("ses")) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}
