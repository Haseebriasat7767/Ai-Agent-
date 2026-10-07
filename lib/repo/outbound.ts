import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { Appointment, OutboundMessage } from "@/lib/types";
import { nowIso } from "@/lib/utils";

interface OutboundRow {
  id: string;
  user_id: string;
  lead_id: string | null;
  project_id: string | null;
  channel: string;
  to_address: string;
  subject: string | null;
  body: string;
  status: string;
  approval_id: string | null;
  provider: string | null;
  provider_message_id: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapOutbound(row: OutboundRow): OutboundMessage {
  return {
    id: row.id,
    userId: row.user_id,
    leadId: row.lead_id,
    projectId: row.project_id,
    channel: (row.channel as OutboundMessage["channel"]) || "email",
    to: row.to_address,
    subject: row.subject,
    body: row.body,
    status: (row.status as OutboundMessage["status"]) || "draft",
    approvalId: row.approval_id,
    provider: row.provider,
    error: row.error,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

export async function createDraft(
  userId: string,
  input: {
    channel: OutboundMessage["channel"];
    to: string;
    body: string;
    subject?: string | null;
    leadId?: string | null;
    projectId?: string | null;
    status?: OutboundMessage["status"];
    approvalId?: string | null;
    id?: string;
  },
): Promise<OutboundMessage> {
  const db = await getDb();
  const id = input.id || newId("msg");
  const timestamp = nowIso();
  await db.run(
    `INSERT INTO outbound_messages (id, user_id, lead_id, project_id, channel, to_address, subject, body, status, approval_id, provider, provider_message_id, error, sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    [
      id,
      userId,
      input.leadId ?? null,
      input.projectId ?? null,
      input.channel,
      input.to,
      input.subject ?? null,
      input.body,
      input.status ?? "draft",
      input.approvalId ?? null,
      timestamp,
      timestamp,
    ],
  );
  const record = await getOutbound(userId, id);
  if (!record) throw new Error("Draft creation failed");
  return record;
}

export async function getOutbound(userId: string, id: string): Promise<OutboundMessage | null> {
  const db = await getDb();
  const row = await db.get<OutboundRow>("SELECT * FROM outbound_messages WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? mapOutbound(row) : null;
}

export async function listOutbound(
  userId: string,
  options: { channel?: OutboundMessage["channel"]; status?: OutboundMessage["status"] | "all"; leadId?: string; limit?: number } = {},
): Promise<OutboundMessage[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.channel) {
    conditions.push("channel = ?");
    params.push(options.channel);
  }
  if (options.status && options.status !== "all") {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.leadId) {
    conditions.push("lead_id = ?");
    params.push(options.leadId);
  }
  const rows = await db.all<OutboundRow>(
    `SELECT * FROM outbound_messages WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, options.limit ?? 100],
  );
  return rows.map(mapOutbound);
}

export async function updateOutbound(
  userId: string,
  id: string,
  patch: Partial<{
    body: string;
    subject: string | null;
    to: string;
    status: OutboundMessage["status"];
    approvalId: string | null;
    provider: string | null;
    providerMessageId: string | null;
    error: string | null;
    sentAt: string | null;
  }>,
): Promise<OutboundMessage | null> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.body !== undefined) assign("body", patch.body);
  if (patch.subject !== undefined) assign("subject", patch.subject);
  if (patch.to !== undefined) assign("to_address", patch.to);
  if (patch.status !== undefined) assign("status", patch.status);
  if (patch.approvalId !== undefined) assign("approval_id", patch.approvalId);
  if (patch.provider !== undefined) assign("provider", patch.provider);
  if (patch.providerMessageId !== undefined) assign("provider_message_id", patch.providerMessageId);
  if (patch.error !== undefined) assign("error", patch.error);
  if (patch.sentAt !== undefined) assign("sent_at", patch.sentAt);
  if (!sets.length) return getOutbound(userId, id);
  sets.push("updated_at = ?");
  params.push(nowIso(), userId, id);
  await db.run(`UPDATE outbound_messages SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
  return getOutbound(userId, id);
}

// ── Appointments ─────────────────────────────────────────────────────────────
interface AppointmentRow {
  id: string;
  user_id: string;
  lead_id: string | null;
  project_id: string | null;
  title: string;
  with_name: string | null;
  with_email: string | null;
  channel: string | null;
  provider: string | null;
  provider_event_id: string | null;
  start_at: string;
  end_at: string;
  timezone: string | null;
  location: string | null;
  notes: string | null;
  status: string;
  approval_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    userId: row.user_id,
    leadId: row.lead_id,
    projectId: row.project_id,
    title: row.title,
    withName: row.with_name,
    withEmail: row.with_email,
    channel: row.channel,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    location: row.location,
    notes: row.notes,
    status: (row.status as Appointment["status"]) || "scheduled",
    createdAt: row.created_at,
  };
}

export async function listAppointments(
  userId: string,
  options: { from?: string; to?: string; status?: Appointment["status"] | "all"; limit?: number } = {},
): Promise<Appointment[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.from) {
    conditions.push("start_at >= ?");
    params.push(options.from);
  }
  if (options.to) {
    conditions.push("start_at <= ?");
    params.push(options.to);
  }
  if (options.status && options.status !== "all") {
    conditions.push("status = ?");
    params.push(options.status);
  }
  const rows = await db.all<AppointmentRow>(
    `SELECT * FROM appointments WHERE ${conditions.join(" AND ")} ORDER BY start_at ASC LIMIT ?`,
    [...params, options.limit ?? 100],
  );
  return rows.map(mapAppointment);
}

export async function getAppointment(userId: string, id: string): Promise<Appointment | null> {
  const db = await getDb();
  const row = await db.get<AppointmentRow>("SELECT * FROM appointments WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? mapAppointment(row) : null;
}

export async function createAppointment(
  userId: string,
  input: {
    title: string;
    startAt: string;
    endAt: string;
    leadId?: string | null;
    projectId?: string | null;
    withName?: string | null;
    withEmail?: string | null;
    channel?: string | null;
    provider?: string | null;
    providerEventId?: string | null;
    timezone?: string | null;
    location?: string | null;
    notes?: string | null;
    status?: Appointment["status"];
    id?: string;
  },
): Promise<Appointment> {
  const db = await getDb();
  const id = input.id || newId("apt");
  const timestamp = nowIso();
  await db.run(
    `INSERT INTO appointments (id, user_id, lead_id, project_id, title, with_name, with_email, channel, provider, provider_event_id, start_at, end_at, timezone, location, notes, status, approval_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      userId,
      input.leadId ?? null,
      input.projectId ?? null,
      input.title,
      input.withName ?? null,
      input.withEmail ?? null,
      input.channel ?? null,
      input.provider ?? null,
      input.providerEventId ?? null,
      input.startAt,
      input.endAt,
      input.timezone ?? null,
      input.location ?? null,
      input.notes ?? null,
      input.status ?? "scheduled",
      timestamp,
      timestamp,
    ],
  );
  const rows = await db.get<AppointmentRow>("SELECT * FROM appointments WHERE user_id = ? AND id = ?", [userId, id]);
  if (!rows) throw new Error("Appointment creation failed");
  return mapAppointment(rows);
}

export async function updateAppointment(
  userId: string,
  id: string,
  patch: Partial<{
    startAt: string;
    endAt: string;
    status: Appointment["status"];
    notes: string | null;
    title: string;
    provider: string | null;
    providerEventId: string | null;
    location: string | null;
  }>,
): Promise<Appointment | null> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.startAt !== undefined) assign("start_at", patch.startAt);
  if (patch.endAt !== undefined) assign("end_at", patch.endAt);
  if (patch.status !== undefined) assign("status", patch.status);
  if (patch.notes !== undefined) assign("notes", patch.notes);
  if (patch.title !== undefined) assign("title", patch.title);
  if (patch.provider !== undefined) assign("provider", patch.provider);
  if (patch.providerEventId !== undefined) assign("provider_event_id", patch.providerEventId);
  if (patch.location !== undefined) assign("location", patch.location);
  if (!sets.length) return getAppointment(userId, id);
  sets.push("updated_at = ?");
  params.push(nowIso(), userId, id);
  await db.run(`UPDATE appointments SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
  const row = await db.get<AppointmentRow>("SELECT * FROM appointments WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? mapAppointment(row) : null;
}
