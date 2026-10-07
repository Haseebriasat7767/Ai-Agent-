import { requireUser } from "@/lib/auth/session";
import { buildBriefing } from "@/lib/briefing";
import { listConversations } from "@/lib/repo/conversations";
import { AssistantWorkspace } from "@/components/assistant/AssistantWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assistant" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { user } = await requireUser();
  const params = await searchParams;
  const [briefing, conversations] = await Promise.all([
    buildBriefing(user),
    listConversations(user.id, { limit: 100 }),
  ]);

  const requested = params.c && conversations.some((conversation) => conversation.id === params.c) ? params.c : null;

  return (
    <AssistantWorkspace
      initialConversationId={requested ?? conversations[0]?.id ?? null}
      briefing={briefing}
    />
  );
}
