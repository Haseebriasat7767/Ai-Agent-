/**
 * Server-side file analysis. Runs entirely on the server; extracted text is the
 * only thing that leaves this module (into the model context for this user).
 */
import { readZip, xmlToText } from "./zip";
import type { FileKind } from "./storage";

export interface ExtractionResult {
  ok: boolean;
  kind: FileKind;
  text: string;
  meta: Record<string, unknown>;
  error?: string;
  warnings: string[];
}

const MAX_TEXT_CHARS = 120_000;

function clip(text: string): string {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[…truncated, document longer than ${MAX_TEXT_CHARS} characters]` : text;
}

export async function extractText(kind: FileKind, bytes: Buffer, name: string): Promise<ExtractionResult> {
  const warnings: string[] = [];
  try {
    switch (kind) {
      case "pdf":
        return await extractPdf(bytes);
      case "docx":
        return extractDocx(bytes);
      case "xlsx":
        return extractXlsx(bytes, warnings);
      case "csv":
        return extractCsv(bytes.toString("utf8"));
      case "json":
        return extractJson(bytes.toString("utf8"));
      case "txt":
        return { ok: true, kind, text: clip(bytes.toString("utf8")), meta: { bytes: bytes.length }, warnings };
      case "image":
        return { ok: true, kind, text: "", meta: { bytes: bytes.length, name }, warnings: ["Image stored — visual analysis happens through the model's image input."] };
      default:
        return {
          ok: false,
          kind,
          text: "",
          meta: { bytes: bytes.length },
          error: `Unsupported file type for ${name}. Supported: PDF, DOCX, XLSX, CSV, TXT, JSON, images.`,
          warnings,
        };
    }
  } catch (error) {
    return {
      ok: false,
      kind,
      text: "",
      meta: { bytes: bytes.length },
      error: error instanceof Error ? error.message : String(error),
      warnings,
    };
  }
}

async function extractPdf(bytes: Buffer): Promise<ExtractionResult> {
  const { extractText: extractPdfText, getDocumentProxy, getMeta } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const result = await extractPdfText(pdf, { mergePages: true });
  const text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  let meta: Record<string, unknown> = { pages: result.totalPages };
  try {
    const info = await getMeta(pdf);
    meta = { ...meta, ...(info?.info ?? {}), pageCount: result.totalPages };
  } catch {
    /* metadata is optional */
  }
  const pages = result.totalPages ?? 0;
  const warnings: string[] = [];
  if (text.trim().length === 0) {
    warnings.push("No selectable text found — this PDF is probably a scan. OCR is not configured, so it cannot be read as text.");
  }
  return { ok: true, kind: "pdf", text: clip(text), meta: { ...meta, pages, characters: text.length }, warnings };
}

function extractDocx(bytes: Buffer): ExtractionResult {
  const entries = readZip(bytes);
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (!document) return { ok: false, kind: "docx", text: "", meta: {}, error: "word/document.xml missing — not a valid DOCX file.", warnings: [] };
  const text = xmlToText(document.data.toString("utf8"));
  const paragraphs = text.split(/\n+/).filter((line) => line.trim().length > 0);
  const headings = Array.from(document.data.toString("utf8").matchAll(/<w:pStyle w:val="(Heading[1-3]|Title)"/g)).length;
  return {
    ok: true,
    kind: "docx",
    text: clip(text),
    meta: { paragraphs: paragraphs.length, headingStyles: headings, words: text.split(/\s+/).length, bytes: bytes.length },
    warnings: [],
  };
}

function extractXlsx(bytes: Buffer, warnings: string[]): ExtractionResult {
  const entries = readZip(bytes);
  const sharedStringsEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (sharedStringsEntry) {
    const xml = sharedStringsEntry.data.toString("utf8");
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      sharedStrings.push(xmlToText(match[1]).replace(/\n/g, " "));
    }
  } else {
    warnings.push("No sharedStrings.xml — using inline cell values only.");
  }

  const sheetEntries = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (sheetEntries.length === 0) {
    return { ok: false, kind: "xlsx", text: "", meta: {}, error: "No worksheets found in the workbook.", warnings };
  }

  const workbookNames = entries.find((entry) => entry.name === "xl/workbook.xml")?.data.toString("utf8") ?? "";
  const sheetNames = Array.from(workbookNames.matchAll(/<sheet[^>]+name="([^"]+)"/g)).map((match) => match[1]);

  const parts: string[] = [];
  const sheetStats: Array<{ name: string; rows: number; columns: number }> = [];
  sheetEntries.slice(0, 8).forEach((entry, index) => {
    const xml = entry.data.toString("utf8");
    const rows = Array.from(xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g));
    const name = sheetNames[index] || entry.name.split("/").pop() || `sheet${index + 1}`;
    const table: string[] = [];
    let maxColumns = 0;
    rows.slice(0, 400).forEach((rowMatch) => {
      const cells = Array.from(rowMatch[1].matchAll(/<c[^>]*?(?:\s|>)([\s\S]*?)<\/c>/g));
      const values = cells.map((cell) => {
        const reference = /r="([A-Z]+)\d+"/.exec(cell[0]);
        const sharedIndex = /t="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>/.exec(cell[1]);
        const inline = /<is>([\s\S]*?)<\/is>/.exec(cell[1]);
        const numeric = /<v>([\s\S]*?)<\/v>/.exec(cell[1]);
        let value = "";
        if (sharedIndex) value = sharedStrings[Number(sharedIndex[1])] ?? "";
        else if (inline) value = xmlToText(inline[1]).replace(/\n/g, " ");
        else if (numeric) value = numeric[1];
        return `${reference ? `${reference[1]}:` : ""}${value}`.trim();
      });
      maxColumns = Math.max(maxColumns, values.length);
      if (values.some((value) => value.replace(/^[A-Z]+:/, "").trim().length > 0)) table.push(values.join(" | "));
    });
    sheetStats.push({ name, rows: rows.length, columns: maxColumns });
    parts.push(`### Sheet: ${name} (${rows.length} rows)\n${table.join("\n")}`);
  });

  const text = parts.join("\n\n");
  return {
    ok: true,
    kind: "xlsx",
    text: clip(text),
    meta: { sheets: sheetStats, totalSheets: sheetEntries.length, sharedStrings: sharedStrings.length },
    warnings,
  };
}

function extractCsv(text: string): ExtractionResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiter = (lines[0]?.match(/;/g)?.length ?? 0) > (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = lines[0]?.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, "")) ?? [];
  const stats: Record<string, { numeric: number; empty: number; examples: string[] }> = {};
  for (const column of header) stats[column] = { numeric: 0, empty: 0, examples: [] };
  lines.slice(1, 4001).forEach((line) => {
    const values = line.split(delimiter);
    header.forEach((column, index) => {
      const raw = (values[index] ?? "").trim().replace(/^"|"$/g, "");
      if (!raw) stats[column].empty += 1;
      else {
        if (!Number.isNaN(Number(raw.replace(/[$,%]/g, "")))) stats[column].numeric += 1;
        if (stats[column].examples.length < 3) stats[column].examples.push(raw.slice(0, 60));
      }
    });
  });
  return {
    ok: true,
    kind: "csv",
    text: clip(text),
    meta: { rows: lines.length - 1, columns: header.length, header, delimiter, columnStats: stats },
    warnings: [],
  };
}

function extractJson(text: string): ExtractionResult {
  try {
    const parsed = JSON.parse(text);
    const shape = Array.isArray(parsed)
      ? { type: "array", length: parsed.length, keys: parsed[0] && typeof parsed[0] === "object" ? Object.keys(parsed[0]) : [] }
      : { type: typeof parsed, keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 40) : [] };
    return { ok: true, kind: "json", text: clip(text), meta: { shape }, warnings: [] };
  } catch (error) {
    return {
      ok: true,
      kind: "json",
      text: clip(text),
      meta: {},
      warnings: [`JSON did not parse: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
