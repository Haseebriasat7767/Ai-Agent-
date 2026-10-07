import { NextResponse } from "next/server";
import { apiError, authorize, handleRouteError } from "@/lib/auth/guards";
import { getFileWithPath } from "@/lib/repo/files";
import { readStoredFile } from "@/lib/files/storage";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

/** Streams a private file back to its owner only. Never publicly cached. */
export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const file = await getFileWithPath(guard.auth.user.id, id);
    if (!file) return apiError(404, "not_found", "File not found.");
    if (file.kind === "image" && file.storage === "disk" && file.storagePath) {
      const bytes = await readStoredFile("disk", file.storagePath);
      if (!bytes) return apiError(410, "gone", "The stored file is no longer available on disk.");
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "content-type": file.mime,
          "content-disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
          "cache-control": "private, no-store",
        },
      });
    }
    if (file.storage === "disk" && file.storagePath) {
      const bytes = await readStoredFile("disk", file.storagePath);
      if (!bytes) return apiError(410, "gone", "The stored file is no longer available on disk.");
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "content-type": file.mime,
          "content-disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
          "cache-control": "private, no-store",
        },
      });
    }
    return apiError(409, "not_streamable", "This file is stored at a remote URL.", { details: file.sourceUrl });
  } catch (error) {
    return handleRouteError(error, "file-raw");
  }
}
