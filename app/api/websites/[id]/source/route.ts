import { NextResponse } from "next/server";
import { apiError, authorize, handleRouteError } from "@/lib/auth/guards";
import { getWebsite } from "@/lib/repo/websites";
import { slugify } from "@/lib/utils";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Download the generated website source. `?path=` returns a single file,
 * otherwise a bundle file (json manifest with every file) is returned.
 */
export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const website = await getWebsite(guard.auth.user.id, id);
    if (!website) return apiError(404, "not_found", "Website not found.");
    if (!website.files || website.files.length === 0) {
      return apiError(409, "no_files", "This website has no generated source files.");
    }
    const requestedPath = new URL(request.url).searchParams.get("path");
    const base = slugify(website.name, "website");

    if (requestedPath) {
      const file = website.files.find((item) => item.path === requestedPath);
      if (!file) return apiError(404, "file_not_found", `No generated file at ${requestedPath}.`);
      const extension = file.path.split(".").pop() ?? "txt";
      return new NextResponse(file.content, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `${file.path.endsWith("html") ? "inline" : "attachment"}; filename="${base}.${extension}"`,
          "cache-control": "private, no-store",
        },
      });
    }

    if (new URL(request.url).searchParams.get("format") === "json") {
      return NextResponse.json(
        {
          name: website.name,
          type: website.type,
          positioning: website.positioning,
          sitemap: website.sitemap,
          files: website.files,
          generatedAt: website.updatedAt,
        },
        { headers: { "content-disposition": `attachment; filename="${base}-bundle.json"` } },
      );
    }

    // Default: preview HTML if available, else a readable concatenation.
    if (website.previewHtml) {
      return new NextResponse(website.previewHtml, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
      });
    }
    const combined = website.files.map((file) => `/* ── ${file.path} ── */\n${file.content}`).join("\n\n");
    return new NextResponse(combined, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${base}-source.txt"`,
      },
    });
  } catch (error) {
    return handleRouteError(error, "website-source");
  }
}
