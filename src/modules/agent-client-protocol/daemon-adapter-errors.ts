import { AcpProtocolError } from "./protocol.js";

export async function responseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // Non-JSON error bodies collapse to the HTTP status below.
  }
  return `HTTP ${res.status}`;
}

export function daemonHttpError(status: number, message: string): AcpProtocolError {
  if (status === 404) {
    return new AcpProtocolError(-32002, message, { code: "daemon_not_found" });
  }
  if (status === 503) {
    return new AcpProtocolError(-32603, message, { code: "daemon_unavailable" });
  }
  return new AcpProtocolError(-32603, message, { code: "daemon_http_error", status });
}

export function daemonProtocolError(message: string): AcpProtocolError {
  return new AcpProtocolError(-32603, message, { code: "daemon_protocol_error" });
}
