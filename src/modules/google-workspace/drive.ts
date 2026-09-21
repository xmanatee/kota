import { z } from "zod";
import type { ToolDef } from "#core/modules/module-types.js";
import { type OutboundHttpRequestPort, outboundHttp } from "#core/outbound-http/index.js";
import { networkReadEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { apiError, googleFetch, googleRawFetch } from "./auth.js";
import { listGooglePages, listingStatus, MAX_LIST_PAGES } from "./listing.js";

const filePageSchema = z.object({
  files: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    mimeType: z.string(),
    modifiedTime: z.string().optional(),
    size: z.string().regex(/^\d+$/).optional(),
  })).optional(),
  kind: z.literal("drive#fileList").optional(),
  nextPageToken: z.string().min(1).optional(),
  incompleteSearch: z.boolean().optional(),
}).refine((page) => Object.values(page).some((value) => value !== undefined))
  .transform((page) => ({
    items: page.files ?? [],
    nextPageToken: page.nextPageToken,
    limitation: page.incompleteSearch
      ? "Google reported an incomplete search; some files may be missing. Narrow the search."
      : undefined,
  }));

export function makeDriveListFiles(
  getToken: () => Promise<string>,
  http: OutboundHttpRequestPort = outboundHttp,
): ToolDef {
  return {
    effect: networkReadEffect(),
    group: "productivity",
    tool: {
      name: "drive_list_files",
      description:
        "List Google Drive files with an optional search query. " +
        `Returns file names, IDs, MIME types, and modification times. Follows up to ${MAX_LIST_PAGES} pages within maxResults and reports incomplete searches or unavailable results.`,
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Drive search query (e.g. \"name contains 'budget'\" or \"mimeType='application/pdf'\")",
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            description: "Maximum number of files to return (default: 20, max: 100)",
          },
        },
        required: [],
      },
    },
    async runner(input): Promise<ToolResult> {
      const requestedMax = input.maxResults ?? 20;
      if (typeof requestedMax !== "number" || !Number.isInteger(requestedMax) || requestedMax < 1) {
        return { content: "maxResults must be a positive integer.", is_error: true };
      }
      const max = Math.min(requestedMax, 100);
      const params = new URLSearchParams({
        pageSize: String(max),
        fields: "files(id,name,mimeType,modifiedTime,size),nextPageToken,incompleteSearch",
        orderBy: "modifiedTime desc",
      });
      if (input.query) params.set("q", input.query as string);

      const { items: files, state } = await listGooglePages({
        getToken,
        http,
        maxResults: max,
        pageSchema: filePageSchema,
        url: (remaining, pageToken) => {
          params.set("pageSize", String(remaining));
          if (pageToken) params.set("pageToken", pageToken);
          return `https://www.googleapis.com/drive/v3/files?${params}`;
        },
      });

      const lines = files.map((f) => {
        const size = f.size ? ` (${Math.round(Number(f.size) / 1024)}KB)` : "";
        return `[${f.id}] ${f.name}${size}\n  Type: ${f.mimeType} | Modified: ${f.modifiedTime ?? "?"}`;
      });

      return {
        content: [
          listingStatus(state, "Complete results for the requested query."),
          state.kind === "complete" && files.length === 0
            ? "No files found." : `${files.length} file(s) retrieved:\n\n${lines.join("\n\n")}`,
        ].join("\n"),
        ...(state.kind === "unavailable" ? { is_error: true } : {}),
      };
    },
  };
}

export function makeDriveReadFile(
  getToken: () => Promise<string>,
  http: OutboundHttpRequestPort = outboundHttp,
): ToolDef {
  return {
    effect: networkReadEffect(),
    group: "productivity",
    tool: {
      name: "drive_read_file",
      description:
        "Read the plain text content of a Google Drive file by its ID. " +
        "Google Docs are exported as plain text; other text files are downloaded directly.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Drive file ID" },
          maxChars: {
            type: "number",
            description: "Maximum characters to return (default: 8000)",
          },
        },
        required: ["id"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();
      const fileId = input.id as string;
      const maxChars = (input.maxChars as number | undefined) ?? 8000;

      const metaRes = await googleFetch(
        token,
        "GET",
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`,
        undefined,
        http,
      );
      if (!metaRes.ok) return apiError("get file metadata", metaRes.status, metaRes.data);

      const meta = metaRes.data as { name: string; mimeType: string };

      let url: string;
      if (meta.mimeType === "application/vnd.google-apps.document") {
        url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
      } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
        url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`;
      } else {
        url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      }

      const res = await googleRawFetch(token, "GET", url, undefined, http);
      if (!res.ok) {
        const body = await res.text();
        return { content: `Google Drive error (${res.status}): ${body}`, is_error: true };
      }

      const text = await res.text();
      const truncated = text.length > maxChars;
      const content = truncated ? `${text.slice(0, maxChars)}\n... (truncated)` : text;

      return {
        content: `File: ${meta.name}\nType: ${meta.mimeType}\n\n${content}`,
      };
    },
  };
}
