/**
 * Read document module — extract text from PDFs, DOCX, RTF, ODT, and
 * other document formats using available system tools.
 *
 * Tools:
 *   read_document — extract plain text from document files
 */

import type { KotaModule, ToolDef } from "../../core/modules/module-types.js";
import { readDocumentTool, runReadDocument } from "./read-document.js";

const tools: ToolDef[] = [
  {
    tool: readDocumentTool,
    runner: runReadDocument,
    risk: "safe",
    kind: "discovery",
  },
];

const readDocumentModule: KotaModule = {
  name: "read-document",
  version: "1.0.0",
  description: "Document text extraction: PDF, DOCX, RTF, ODT, EPUB, HTML",
  tools,
};

export default readDocumentModule;
