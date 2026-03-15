import { describe, it, expect } from "vitest";
import { parseCsvRow, formatCsvMetadata, CSV_EXTENSIONS } from "./csv-preview.js";

describe("parseCsvRow", () => {
  it("splits simple CSV", () => {
    expect(parseCsvRow("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsvRow('"hello, world",foo,bar', ",")).toEqual(["hello, world", "foo", "bar"]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsvRow('"say ""hi""",ok', ",")).toEqual(['say "hi"', "ok"]);
  });

  it("splits TSV", () => {
    expect(parseCsvRow("a\tb\tc", "\t")).toEqual(["a", "b", "c"]);
  });
});

describe("formatCsvMetadata", () => {
  it("returns empty for no lines", () => {
    expect(formatCsvMetadata([], ",")).toBe("");
  });

  it("shows basic column info for text-only data", () => {
    const lines = ["name,city", "Alice,NYC", "Bob,LA"];
    const result = formatCsvMetadata(lines, ",");
    expect(result).toContain("2 rows");
    expect(result).toContain("2 cols");
    expect(result).toContain("name");
    expect(result).toContain("city");
  });

  it("annotates numeric columns with type and range", () => {
    const lines = ["product,price,qty", "A,10.5,3", "B,20.0,7", "C,5.25,1"];
    const result = formatCsvMetadata(lines, ",");
    expect(result).toContain("price:numeric");
    expect(result).toContain("qty:numeric");
    expect(result).toContain("Ranges");
    expect(result).toContain("5.25");
    expect(result).toContain("20");
  });

  it("annotates date columns", () => {
    const lines = ["event,date", "launch,2024-01-15", "review,2024-03-20"];
    const result = formatCsvMetadata(lines, ",");
    expect(result).toContain("date:date");
  });

  it("does not annotate text columns", () => {
    const lines = ["name,city", "Alice,NYC"];
    const result = formatCsvMetadata(lines, ",");
    // text columns show without type annotation
    expect(result).not.toContain("name:text");
    expect(result).not.toContain("city:text");
  });

  it("handles header-only file", () => {
    const lines = ["a,b,c"];
    const result = formatCsvMetadata(lines, ",");
    expect(result).toContain("0 rows");
  });
});

describe("CSV_EXTENSIONS", () => {
  it("maps csv to comma", () => {
    expect(CSV_EXTENSIONS[".csv"]).toBe(",");
  });
  it("maps tsv to tab", () => {
    expect(CSV_EXTENSIONS[".tsv"]).toBe("\t");
  });
});
