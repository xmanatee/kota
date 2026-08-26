export const ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
export const SECRET_REFERENCE_PATTERN = /^\$[A-Z][A-Z0-9_]*$/;
export const SETUP_KINDS = [
  "config",
  "secret",
  "oauth",
  "browser-profile",
  "external-url",
  "capability",
] as const;
export const SETUP_SCOPES = ["scope", "global"] as const;
export const SETUP_SENSITIVITIES = ["none", "secret", "oauth", "browser-profile"] as const;
export const SETUP_MODES = ["form", "url", "none"] as const;
export const FORM_FIELD_TYPES = ["string", "number", "boolean"] as const;
export const SETUP_ACTION_STATUSES = ["pending", "completed", "revoked"] as const;
