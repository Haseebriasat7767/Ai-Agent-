import { tool } from "ai";
import { z } from "zod";
import { getFile, listFiles } from "@/lib/repo/files";
import { conversationFileIds } from "@/lib/repo/conversations";
import { compact, failure, type ToolContext } from "./context";

export function fileTools(context: ToolContext) {
  return {
    list_files: tool({
      description:
        "List uploaded files in the workspace (optionally filtered). Files attached to this conversation are marked so. Always list first when the user says 'this PDF' or 'the spreadsheets' and you are unsure which file they mean.",
      inputSchema: z.object({
        search: z.string().optional(),
        kind: z.enum(["all", "pdf", "docx", "xlsx", "csv", "txt", "image", "json"]).default("all"),
        onlyThisConversation: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      execute: async ({ search, kind, onlyThisConversation, limit }) => {
        const files = await listFiles(context.userId, { search, kind, limit, projectId: context.projectId ?? undefined });
        const attachedIds = context.conversationId ? new Set(await conversationFileIds(context.userId, context.conversationId)) : new Set<string>();
        const filtered = onlyThisConversation ? files.filter((file) => attachedIds.has(file.id)) : files;
        return {
          ok: true,
          count: filtered.length,
          files: filtered.map((file) => ({
            id: file.id,
            name: file.name,
            kind: file.kind,
            size: file.size,
            status: file.status,
            attachedToThisConversation: attachedIds.has(file.id),
            characters: file.textContent?.length ?? 0,
            summary: (file.extracted?.summary as string | undefined) ?? null,
            uploadedAt: file.createdAt,
          })),
        };
      },
    }),

    read_file: tool({
      description:
        "Read the extracted text of an uploaded file (PDF, DOCX, XLSX, CSV, TXT, JSON). Supports paging with offset for long documents. Returns structure metadata (pages, sheets, columns) as well as text.",
      inputSchema: z.object({
        fileId: z.string().optional(),
        name: z.string().optional().describe("Partial filename match if the id is unknown"),
        offset: z.number().int().min(0).default(0),
        maxChars: z.number().int().min(500).max(60_000).default(20_000),
      }),
      execute: async ({ fileId, name, offset, maxChars }) => {
        let file = fileId ? await getFile(context.userId, fileId) : null;
        if (!file && name) {
          const matches = await listFiles(context.userId, { search: name, limit: 3 });
          file = matches[0] ?? null;
        }
        if (!file) return failure("read_file", "No matching file found.", "Call list_files to see available files.");
        if (file.status === "failed") {
          return failure("read_file", `Extraction failed for ${file.name}: ${file.error ?? "unknown error"}`);
        }
        const text = file.textContent ?? "";
        if (file.kind === "image") {
          return {
            ok: true,
            fileId: file.id,
            name: file.name,
            kind: file.kind,
            note: "Image files are analysed through the model's image input when attached to a message; there is no text layer to read.",
            extracted: file.extracted,
          };
        }
        const slice = text.slice(offset, offset + maxChars);
        return compact({
          ok: true,
          fileId: file.id,
          name: file.name,
          kind: file.kind,
          size: file.size,
          extracted: file.extracted,
          totalCharacters: text.length,
          offset,
          returnedCharacters: slice.length,
          hasMore: offset + maxChars < text.length,
          nextOffset: offset + maxChars < text.length ? offset + maxChars : null,
          text: slice,
        });
      },
    }),

    search_in_files: tool({
      description: "Full-text search across uploaded files and return matching excerpts with surrounding context.",
      inputSchema: z.object({
        query: z.string().min(2),
        fileId: z.string().optional(),
        limit: z.number().int().min(1).max(30).default(8),
      }),
      execute: async ({ query, fileId, limit }) => {
        const files = fileId ? [await getFile(context.userId, fileId)].filter(Boolean) : await listFiles(context.userId, { limit: 100 });
        const needle = query.toLowerCase();
        const matches: Array<{ fileId: string; name: string; excerpt: string; position: number }> = [];
        for (const file of files) {
          if (!file?.textContent) continue;
          const haystack = file.textContent.toLowerCase();
          let index = haystack.indexOf(needle);
          let found = 0;
          while (index >= 0 && found < 3 && matches.length < limit) {
            matches.push({
              fileId: file.id,
              name: file.name,
              excerpt: file.textContent.slice(Math.max(0, index - 160), Math.min(file.textContent.length, index + 260)).trim(),
              position: index,
            });
            found += 1;
            index = haystack.indexOf(needle, index + needle.length);
          }
          if (matches.length >= limit) break;
        }
        return { ok: true, query, matches, filesSearched: files.filter(Boolean).length };
      },
    }),
  };
}
