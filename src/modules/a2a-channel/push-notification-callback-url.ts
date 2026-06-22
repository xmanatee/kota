export function redactedCallbackUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.username = "";
  url.password = "";
  if (url.search) url.search = "?...";
  url.hash = "";
  return url.toString();
}
