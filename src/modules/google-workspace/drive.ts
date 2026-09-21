import { z } from "zod";
import type { ToolDef } from "#core/modules/module-types.js";
import { type OutboundHttpRequestPort, outboundHttp } from "#core/outbound-http/index.js";
import { networkReadEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { googleFetch, googleRawFetch } from "./auth.js";
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

const driveIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const fileMetadataSchema = z.object({
  name: z.string(),
  mimeType: z.string().min(1),
  trashed: z.boolean().optional(),
  shortcutDetails: z.object({
    targetId: driveIdSchema,
    targetResourceKey: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  }).optional(),
});
const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";
const MAX_SHORTCUT_HOPS = 8;

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
        "Read the plain text content of a Google Drive file or shortcut by its ID. " +
        "Resolves shortcuts using current target metadata and reports both identities. " +
        "Google Docs are exported as plain text; Google spreadsheets are exported as CSV (first sheet only); " +
        "text, JSON and XML files are downloaded directly. Other types are unsupported. " +
        "maxChars limits the returned text separately from sheet coverage.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Drive file or shortcut ID" },
          maxChars: {
            type: "integer",
            minimum: 0,
            description: "Maximum characters to return (default: 8000)",
          },
        },
        required: ["id"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const parsedId = driveIdSchema.safeParse(input.id);
      if (!parsedId.success) return { content: "Unavailable: invalid Drive file ID.", is_error: true };
      const maxChars = input.maxChars ?? 8000;
      if (typeof maxChars !== "number" || !Number.isSafeInteger(maxChars) || maxChars < 0) {
        return { content: "maxChars must be a non-negative integer.", is_error: true };
      }
      let fileId = parsedId.data;
      let driveResource: { fileId: string; resourceKey: string } | undefined;
      const shortcuts: string[] = [];
      const visited = new Set<string>();
      const identity = () => shortcuts.length > 0
        ? `${shortcuts.join("\n")}\nResolved file ID: ${fileId}\n` : "";
      const unavailable = (reason: string): ToolResult => ({
        content: `${identity()}Unavailable: ${reason}`,
        is_error: true,
      });

      try {
        const token = await getToken();
        for (;;) {
          if (visited.has(fileId)) return unavailable("cyclic Drive shortcut reference.");
          visited.add(fileId);
          const baseUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
          const metaRes = await googleFetch(
            token, "GET",
            `${baseUrl}?fields=name,mimeType,trashed,shortcutDetails(targetId,targetResourceKey)`,
            undefined, http, driveResource,
          );
          // Provider diagnostics can echo resource keys. Only status and operation are public.
          if (!metaRes.ok) return unavailable(`Google Drive metadata request failed (${metaRes.status}); the file may be missing or inaccessible.`);
          const parsedMeta = fileMetadataSchema.safeParse(metaRes.data);
          if (!parsedMeta.success) return unavailable("malformed Drive file metadata or shortcut reference.");
          const meta = parsedMeta.data;
          if (meta.trashed) return unavailable("the Drive file is in the trash.");
          if (meta.mimeType === SHORTCUT_MIME_TYPE) {
            shortcuts.push(`Shortcut: ${meta.name} [${fileId}]`);
            if (!meta.shortcutDetails) return unavailable("missing Drive shortcut target.");
            if (shortcuts.length > MAX_SHORTCUT_HOPS) return unavailable("Drive shortcut resolution limit reached.");
            fileId = meta.shortcutDetails.targetId;
            driveResource = meta.shortcutDetails.targetResourceKey === undefined ? undefined : {
              fileId,
              resourceKey: meta.shortcutDetails.targetResourceKey,
            };
            continue;
          }

          const isSpreadsheet = meta.mimeType === "application/vnd.google-apps.spreadsheet";
          let url: string;
          if (meta.mimeType === "application/vnd.google-apps.document") {
            url = `${baseUrl}/export?mimeType=text/plain`;
          } else if (isSpreadsheet) {
            url = `${baseUrl}/export?mimeType=text/csv`;
          } else if (meta.mimeType.startsWith("text/") || ["application/json", "application/xml"].includes(meta.mimeType)) {
            url = `${baseUrl}?alt=media`;
          } else {
            return { content: `${identity()}Unsupported Drive file: ${meta.name} (${meta.mimeType}). No content read.`, is_error: true };
          }
          const res = await googleRawFetch(token, "GET", url, undefined, http, driveResource);
          if (!res.ok) return unavailable(`Google Drive content request failed (${res.status}). No content read.`);
          const text = await res.text();
          const content = text.length > maxChars ? `${text.slice(0, maxChars)}\n... (truncated)` : text;
          const exportNotice = isSpreadsheet
            ? "\nExport: CSV (text/csv), first sheet only. Other sheets, if any, are not read."
            : "";
          return {
            content: `${identity()}File: ${meta.name}\nType: ${meta.mimeType}${exportNotice}\n\n${content}`,
          };
        }
      } catch {
        return unavailable("Google Drive request could not be completed. No content read.");
      }
    },
  };
}
