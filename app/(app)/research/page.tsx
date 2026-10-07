import { requireUser } from "@/lib/auth/session";
import { listResearch } from "@/lib/repo/research";
import { ResearchWorkspace } from "@/components/research/ResearchWorkspace";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const { user } = await requireUser();
  const items = await listResearch(user.id, { limit: 200 });

  return <ResearchWorkspace initialItems={items} />;
}
