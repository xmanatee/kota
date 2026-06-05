const SECRET_REFERENCE_PATTERN = /^\$[A-Z][A-Z0-9_]*$/;

export type SecretResolver = (name: string) => string | null | undefined;

export function isSecretReference(value: string): boolean {
  return SECRET_REFERENCE_PATTERN.test(value);
}

export function secretReferenceName(value: string): string | null {
  if (!isSecretReference(value)) return null;
  return value.slice(1);
}

export function resolveSecretReference(
  value: string,
  getSecret?: SecretResolver,
): string {
  const name = secretReferenceName(value);
  if (name === null) return value;
  return getSecret?.(name) ?? process.env[name] ?? "";
}
