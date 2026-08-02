import type { DaemonTransport } from "#core/server/daemon-transport.js";

export type RecordedCall = {
  path: string;
  init: RequestInit | undefined;
};

type FetchResponder = (
  path: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

export function makeRecordingTransport(responder: FetchResponder): {
  transport: DaemonTransport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async (path, init) => {
      calls.push({ path, init });
      return responder(path, init);
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

export function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
