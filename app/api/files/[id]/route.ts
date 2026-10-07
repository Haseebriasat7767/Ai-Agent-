import { apiError, authorize, handleRouteError, json } from "@/lib/auth/guards";
import { deleteFile, getFile } from "@/lib/repo/files";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const file = await getFile(guard.auth.user.id, id);
    if (!file) return apiError(404, "not_found", "File not found.");
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(60_000, Number(url.searchParams.get("limit") ?? 20_000));
    const text = file.textContent ?? "";
    return json({
      file: { ...file, textContent: undefined },
      text: text.slice(offset, offset + limit),
      totalCharacters: text.length,
      hasMore: offset + limit < text.length,
    });
  } catch (error) {
    return handleRouteError(error, "file-get");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const file = await getFile(guard.auth.user.id, id);
    if (!file) return apiError(404, "not_found", "File not found.");
    await deleteFile(guard.auth.user.id, id);
    return json({ ok: true, deleted: id });
  } catch (error) {
    return handleRouteError(error, "file-delete");
  }
}
