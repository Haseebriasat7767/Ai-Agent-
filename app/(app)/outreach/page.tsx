import { requireUser } from "@/lib/auth/session";
import { listAppointments, listOutbound } from "@/lib/repo/outbound";
import { emailAvailability } from "@/lib/integrations/email";
import { calendarAvailability, whatsappAvailability } from "@/lib/integrations/messaging";
import { OutreachWorkspace } from "@/components/outreach/OutreachWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const { user } = await requireUser();
  const [messages, appointments] = await Promise.all([
    listOutbound(user.id, { status: "all", limit: 150 }),
    listAppointments(user.id, { status: "all", limit: 100 }),
  ]);

  return (
    <OutreachWorkspace
      initialMessages={messages}
      initialAppointments={appointments}
      initialAvailability={{ email: emailAvailability(), whatsapp: whatsappAvailability() }}
      calendar={calendarAvailability()}
    />
  );
}
