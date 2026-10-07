import { requireUser } from "@/lib/auth/session";
import { fileStats, listFiles } from "@/lib/repo/files";
import { MAX_UPLOAD_BYTES, storageMode } from "@/lib/files/storage";
import { FileLibrary } from "@/components/files/FileLibrary";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const { user } = await requireUser();
  const [files, stats] = await Promise.all([listFiles(user.id, { limit: 200 }), fileStats(user.id)]);
  const initialFiles = files.map(({ textContent, ...file }) => ({ ...file, preview: textContent?.slice(0, 400) ?? null }));

  return (
    <FileLibrary
      initialFiles={initialFiles}
      initialStats={stats}
      maxUploadBytes={MAX_UPLOAD_BYTES}
      storageMode={storageMode()}
    />
  );
}
