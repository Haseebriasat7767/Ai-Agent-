"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, CheckCircle2, Clock, Mail, MessageCircle, RefreshCw, Send, Sparkles, XCircle } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, Field, Modal, SectionHeader, Segmented, Spinner, Stat } from "@/components/ui/primitives";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { assistantUrl } from "@/lib/deep-link";
import type { Appointment, OutboundMessage } from "@/lib/types";

type Availability = {
  email: { available: boolean; provider: string | null; from: string; reason: string };
  whatsapp: { available: boolean; provider: string | null; reason: string };
};

export function OutreachWorkspace({
  initialMessages,
  initialAppointments,
  initialAvailability,
  calendar,
}: {
  initialMessages: OutboundMessage[];
  initialAppointments: Appointment[];
  initialAvailability: Availability;
  calendar: { available: boolean; canBook: boolean; provider: string | null; reason: string };
}) {
  const { api, pushToast, activeProjectId, refreshApprovals } = useApp();
  const [tab, setTab] = useState<"drafts" | "appointments">("drafts");
  const [messages, setMessages] = useState(initialMessages);
  const [appointments, setAppointments] = useState(initialAppointments);
  const [availability, setAvailability] = useState(initialAvailability);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState<OutboundMessage | null>(null);
  const [editing, setEditing] = useState<OutboundMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [bookingTarget, setBookingTarget] = useState<Appointment | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ messages: OutboundMessage[]; appointments: Appointment[]; availability: Availability }>("/api/outbound?status=all&limit=150");
      setMessages(data.messages);
      setAppointments(data.appointments);
      setAvailability(data.availability);
    } catch (error) {
      pushToast({ tone: "error", title: "Could not load outreach", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, pushToast]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  const counts = useMemo(
    () => ({
      drafts: messages.filter((message) => message.status === "draft").length,
      awaiting: messages.filter((message) => message.status === "awaiting_approval").length,
      sent: messages.filter((message) => message.status === "sent").length,
      failed: messages.filter((message) => message.status === "failed").length,
    }),
    [messages],
  );

  const send = async (draft: OutboundMessage) => {
    setSending(true);
    try {
      const data = await api<{ sent: boolean; requiresApproval: boolean; approvalId: string | null; message: string }>(`/api/outbound/${draft.id}`, {
        method: "POST",
        json: { action: "send" },
      });
      await refreshApprovals();
      await reload();
      setReviewing(null);
      pushToast({
        tone: data.sent ? "success" : "warning",
        title: data.sent ? `Sent to ${draft.to}` : "Approval requested — nothing sent yet",
        description: data.message,
      });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not send", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async (draft: OutboundMessage, patch: { to: string; subject: string; body: string }) => {
    try {
      await api(`/api/outbound/${draft.id}`, { method: "PATCH", json: patch });
      pushToast({ tone: "success", title: "Draft updated" });
      setEditing(null);
      await reload();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not save the draft", description: error instanceof Error ? error.message : undefined });
    }
  };

  const actOnAppointment = async (appointment: Appointment, action: "book" | "cancel") => {
    try {
      const data = await api<{ executed: boolean; requiresApproval: boolean; approvalId: string | null; message: string; providerNote: string }>(
        `/api/appointments/${appointment.id}`,
        { method: "PATCH", json: { action } },
      );
      await refreshApprovals();
      await reload();
      setBookingTarget(null);
      pushToast({
        tone: data.executed ? "success" : "warning",
        title: data.executed ? `Done: ${appointment.title}` : "Approval requested",
        description: `${data.message}${data.executed ? "" : ` ${data.providerNote}`}`,
      });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not update the appointment", description: error instanceof Error ? error.message : undefined });
    }
  };

  const channelAvailable = (message: OutboundMessage) => (message.channel === "email" ? availability.email.available : availability.whatsapp.available);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <SectionHeader
        title="Outreach"
        subtitle="Drafts, pre-send review and appointments. Drafting is always automatic; sending is always your decision — nothing leaves this workspace without an explicit approval unless you granted a standing permission."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void reload()}>
              {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
            </button>
            <button className="btn btn-sm" onClick={() => window.location.href = assistantUrl("Draft outreach emails for my five hottest leads. Show me each draft for review — do not send anything.")}>
              <Sparkles size={12} /> Draft with the assistant
            </button>
          </>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Drafts" value={counts.drafts} />
        <Stat label="Awaiting approval" value={counts.awaiting} tone="warn" />
        <Stat label="Sent" value={counts.sent} tone="success" />
        <Stat label="Failed" value={counts.failed} tone={counts.failed ? "danger" : "default"} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={tab}
          onChange={(value) => setTab(value)}
          options={[
            { value: "drafts", label: "Messages", count: messages.length },
            { value: "appointments", label: "Appointments", count: appointments.length },
          ]}
        />
        <span className={cn("chip", availability.email.available ? "chip-success" : "chip-warn")}>
          <Mail size={10} /> email {availability.email.available ? `via ${availability.email.provider}` : "not configured"}
        </span>
        <span className={cn("chip", availability.whatsapp.available ? "chip-success" : "chip-warn")}>
          <MessageCircle size={10} /> WhatsApp {availability.whatsapp.available ? `via ${availability.whatsapp.provider}` : "not configured"}
        </span>
        <span className={cn("chip", calendar.canBook ? "chip-success" : "chip-warn")}>
          <CalendarPlus size={10} /> calendar {calendar.canBook ? `booking via ${calendar.provider}` : calendar.available ? "read-only" : "not configured"}
        </span>
      </div>

      {tab === "drafts" ? (
        messages.length === 0 ? (
          <div className="panel mt-3">
            <EmptyState
              icon={<Send size={18} />}
              title="No messages yet"
              description="Ask the assistant to draft outreach, a reply suggestion or a follow-up sequence. Drafts land here for review before anything is sent."
              action={
                <button className="btn btn-primary btn-sm" onClick={() => window.location.href = assistantUrl("Research my leads and draft personalised outreach emails. Show them for review first.")}>
                  <Sparkles size={12} /> Draft with the assistant
                </button>
              }
            />
          </div>
        ) : (
          <div className="panel mt-3 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-ai">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Recipient</th>
                    <th>Message</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message) => (
                    <tr key={message.id}>
                      <td>
                        <span className="chip">
                          {message.channel === "email" ? <Mail size={10} /> : <MessageCircle size={10} />} {message.channel}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate text-ink">{message.to}</td>
                      <td className="max-w-[380px]">
                        {message.subject ? <p className="truncate text-ink-soft">{message.subject}</p> : null}
                        <p className="line-clamp-2 text-[11.5px] leading-snug text-muted">{message.body}</p>
                        {message.error ? <p className="mt-1 text-[11px] text-[color:var(--color-danger)]">{message.error}</p> : null}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "chip",
                            message.status === "sent" ? "chip-success" : message.status === "awaiting_approval" ? "chip-warn" : message.status === "failed" ? "chip-danger" : "",
                          )}
                        >
                          {message.status.replace(/_/g, " ")}
                        </span>
                        {message.sentAt ? <p className="mt-1 text-[10.5px] text-faint">{relativeTime(message.sentAt)}</p> : null}
                      </td>
                      <td className="text-faint">{relativeTime(message.createdAt)}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <button className="btn btn-xs" onClick={() => setEditing(message)} disabled={message.status === "sent"}>
                            Edit
                          </button>
                          <button className="btn btn-primary btn-xs" onClick={() => setReviewing(message)} disabled={message.status === "sent"}>
                            <Send size={10} /> Review & send
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : appointments.length === 0 ? (
        <div className="panel mt-3">
          <EmptyState
            icon={<Clock size={18} />}
            title="No appointments"
            description="Ask the assistant to find a slot and prepare the meeting — booking stays pending until you approve it."
          />
        </div>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {appointments.map((appointment) => (
            <div key={appointment.id} className="panel p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{appointment.title}</p>
                  <p className="text-[11px] text-faint">
                    {formatDateTime(appointment.startAt)}
                    {appointment.timezone ? ` · ${appointment.timezone}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "chip",
                    appointment.status === "scheduled" ? "chip-success" : appointment.status === "pending_approval" ? "chip-warn" : appointment.status === "cancelled" ? "chip-danger" : "",
                  )}
                >
                  {appointment.status.replace(/_/g, " ")}
                </span>
              </div>
              {appointment.withName || appointment.withEmail ? (
                <p className="mt-2 text-[12px] text-muted">
                  {appointment.withName ?? "attendee"}
                  {appointment.withEmail ? ` · ${appointment.withEmail}` : ""}
                </p>
              ) : null}
              {appointment.notes ? <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{appointment.notes}</p> : null}
              <div className="mt-3 flex items-center gap-1.5 border-t border-[color:var(--color-line)] pt-3">
                {appointment.status !== "cancelled" ? (
                  <>
                    <button className="btn btn-sm" onClick={() => setBookingTarget(appointment)}>
                      <CalendarPlus size={11} /> {appointment.status === "pending_approval" ? "Book" : "Reschedule"}
                    </button>
                    <button className="btn btn-sm btn-danger ml-auto" onClick={() => void actOnAppointment(appointment, "cancel")}>
                      <XCircle size={11} /> Cancel
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-faint">Cancelled {relativeTime(appointment.createdAt)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pre-send review ─────────────────────────────────────────────────── */}
      <Modal
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title="Review before sending"
        description="This is exactly what leaves the workspace. Nothing is sent until you confirm."
        size="lg"
        footer={
          reviewing ? (
            <>
              <button className="btn btn-sm" onClick={() => setReviewing(null)} disabled={sending}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm ml-auto" onClick={() => void send(reviewing)} disabled={sending || !channelAvailable(reviewing)}>
                {sending ? <Spinner /> : <Send size={12} />} Send {reviewing.channel === "email" ? "email" : "WhatsApp"}
              </button>
            </>
          ) : null
        }
      >
        {reviewing ? (
          <div className="space-y-3">
            {!channelAvailable(reviewing) ? (
              <p className="rounded-xl border border-[rgba(251,191,36,0.32)] bg-[rgba(251,191,36,0.08)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#fbd88b]">
                {reviewing.channel === "email" ? availability.email.reason : availability.whatsapp.reason} Sending is disabled until the provider is configured — the draft is safe
                here in the meantime.
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.1em] text-faint">To</p>
                <p className="mt-0.5 break-all text-[12.5px] text-ink">{reviewing.to}</p>
              </div>
              <div className="rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Channel</p>
                <p className="mt-0.5 text-[12.5px] text-ink">
                  {reviewing.channel} {reviewing.provider ? `· ${reviewing.provider}` : ""}
                </p>
              </div>
            </div>
            {reviewing.subject ? (
              <div>
                <p className="label">Subject</p>
                <p className="text-[13px] text-ink">{reviewing.subject}</p>
              </div>
            ) : null}
            <div>
              <p className="label">Body</p>
              <pre className="scroll-area max-h-[40vh] whitespace-pre-wrap rounded-xl border border-[color:var(--color-line)] bg-black/30 px-3.5 py-3 text-[12.5px] leading-relaxed text-[#d3d9e4]">
                {reviewing.body}
              </pre>
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              Attachments: none. Sending records an audit entry, marks the lead as contacted and (unless a standing permission is enabled) creates an approval request you decide first.
            </p>
          </div>
        ) : null}
      </Modal>

      {/* ── Edit draft ──────────────────────────────────────────────────────── */}
      <EditDraftModal draft={editing} onClose={() => setEditing(null)} onSave={saveEdit} />

      {/* ── Book / reschedule ───────────────────────────────────────────────── */}
      <Modal
        open={Boolean(bookingTarget)}
        onClose={() => setBookingTarget(null)}
        title="Book this meeting"
        description={calendar.reason}
        footer={
          bookingTarget ? (
            <>
              <button className="btn btn-sm" onClick={() => setBookingTarget(null)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm ml-auto" onClick={() => void actOnAppointment(bookingTarget, "book")} disabled={!calendar.canBook}>
                {calendar.canBook ? <CheckCircle2 size={12} /> : null} {calendar.canBook ? "Request booking" : "Booking unavailable"}
              </button>
            </>
          ) : null
        }
      >
        {bookingTarget ? (
          <div className="space-y-2 text-[12.5px] text-ink-soft">
            <p>
              <span className="text-faint">Meeting:</span> {bookingTarget.title}
            </p>
            <p>
              <span className="text-faint">When:</span> {formatDateTime(bookingTarget.startAt)}
            </p>
            <p>
              <span className="text-faint">With:</span> {bookingTarget.withName ?? "attendee"} {bookingTarget.withEmail ? `(${bookingTarget.withEmail})` : ""}
            </p>
            <p className="text-[11px] leading-relaxed text-faint">
              {calendar.canBook
                ? "Booking creates a real event in your connected calendar after you approve it."
                : "No booking-capable calendar is connected, so approving can only update the local record. Configure Cal.com (CALCOM_API_KEY + CALCOM_EVENT_TYPE_ID) to enable real bookings."}
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function EditDraftModal({
  draft,
  onClose,
  onSave,
}: {
  draft: OutboundMessage | null;
  onClose: () => void;
  onSave: (draft: OutboundMessage, patch: { to: string; subject: string; body: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ to: "", subject: "", body: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (draft) setForm({ to: draft.to ?? "", subject: draft.subject ?? "", body: draft.body });
  }, [draft]);

  return (
    <Modal
      open={Boolean(draft)}
      onClose={onClose}
      title="Edit draft"
      size="lg"
      footer={
        draft ? (
          <>
            <button className="btn btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm ml-auto"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onSave(draft, form);
                setBusy(false);
              }}
            >
              {busy ? <Spinner /> : null} Save draft
            </button>
          </>
        ) : null
      }
    >
      <div className="space-y-3">
        <Field label="To">
          <input className="input" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} />
        </Field>
        <Field label="Subject">
          <input className="input" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} />
        </Field>
        <Field label="Body">
          <textarea className="textarea" rows={14} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
