/**
 * CSV/TSV parsing and structured preview for file_read.
 * Extracted from file-read.ts and enhanced with column type inference
 * and numeric range summaries for better data orientation.
 */

export const CSV_EXTENSIONS: Record<string, string> = {
  ".csv": ",",
  ".tsv": "\t",
};

/** Parse a CSV/TSV line, handling quoted fields. */
export function parseCsvRow(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Infer column type from sample values. */
function inferType(values: string[]): string | null {
  const nonEmpty = values.filter((v) => v !== "");
  if (nonEmpty.length === 0) return null;
  if (nonEmpty.every((v) => !Number.isNaN(Number(v)))) return "numeric";
  const datePattern = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
  if (nonEmpty.every((v) => datePattern.test(v))) return "date";
  return null; // text is default, no need to annotate
}

/**
 * Build a structured metadata header for CSV/TSV content.
 * Enhanced: includes column types and numeric ranges from a sample.
 */
export function formatCsvMetadata(lines: string[], delimiter: string): string {
  if (lines.length === 0) return "";
  const headers = parseCsvRow(lines[0], delimiter);
  const totalLines = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  const dataRows = Math.max(0, totalLines - 1);

  // Sample up to 50 data rows for type inference
  const sampleEnd = Math.min(lines.length, 51);
  const sample = lines.slice(1, sampleEnd).map((l) => parseCsvRow(l, delimiter));

  // Build column descriptors with inferred types
  const colDescs: string[] = [];
  const numericRanges: string[] = [];

  for (let i = 0; i < headers.length; i++) {
    const values = sample.map((row) => row[i] ?? "");
    const type = inferType(values);
    colDescs.push(type ? `${headers[i]}:${type}` : headers[i]);

    if (type === "numeric") {
      const nums = values.map(Number).filter((n) => !Number.isNaN(n));
      if (nums.length > 0) {
        numericRanges.push(`${headers[i]}: ${Math.min(...nums)}–${Math.max(...nums)}`);
      }
    }
  }

  let meta = `[CSV: ${dataRows} rows × ${headers.length} cols | ${colDescs.join(", ")}]`;
  if (numericRanges.length > 0) {
    meta += `\n[Ranges: ${numericRanges.join(", ")}]`;
  }
  return `${meta}\n\n`;
}
