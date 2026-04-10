import type { ToolDef } from "#core/modules/module-types.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { apiError, googleFetch } from "./auth.js";

export function makeDriveListFiles(getToken: () => Promise<string>): ToolDef {
  return {
    risk: "safe",
    kind: "discovery",
    group: "productivity",
    tool: {
      name: "drive_list_files",
      description:
        "List Google Drive files with an optional search query. " +
        "Returns file names, IDs, MIME types, and modification times.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Drive search query (e.g. \"name contains 'budget'\" or \"mimeType='application/pdf'\")",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of files to return (default: 20, max: 100)",
          },
        },
        required: [],
      },
    },
    async runner(input): Promise<ToolResult> {
      const token = await getToken();
      const max = Math.min((input.maxResults as number | undefined) ?? 20, 100);
      const params = new URLSearchParams({
        pageSize: String(max),
        fields: "files(id,name,mimeType,modifiedTime,size)",
        orderBy: "modifiedTime desc",
      });
      if (input.query) params.set("q", input.query as string);

      const res = await googleFetch(
        token,
        "GET",
        `https://www.googleapis.com/drive/v3/files?${params}`,
      );
      if (!res.ok) return apiError("list files", res.status, res.data);

      const data = res.data as {
        files?: Array<{
          id: string;
          name: string;
          mimeType: string;
          modifiedTime?: string;
          size?: string;
        }>;
      };

      const files = data.files ?? [];
      if (files.length === 0) return { content: "No files found." };

      const lines = files.map((f) => {
        const size = f.size ? ` (${Math.round(Number(f.size) / 1024)}KB)` : "";
        return `[${f.id}] ${f.name}${size}\n  Type: ${f.mimeType} | Modified: ${f.modifiedTime ?? "?"}`;
      });

      return { content: `${files.length} file(s):\n\n${lines.join("\n\n")}` };
    },
  };
}

export function makeDriveReadFile(getToken: () => Promise<string>): ToolDef {
  return {
    risk: "safe",
    kind: "discovery",
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

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
