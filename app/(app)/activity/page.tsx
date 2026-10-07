import { requireUser } from "@/lib/auth/session";
import { activitySummary, listActivity } from "@/lib/repo/activity";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const { user } = await requireUser();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [entries, summary] = await Promise.all([listActivity(user.id, { limit: 300, since }), activitySummary(user.id, since)]);

  return <ActivityTimeline initialEntries={entries} initialSummary={summary} initialSince={since} />;
}
