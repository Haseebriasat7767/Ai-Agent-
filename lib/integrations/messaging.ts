/** WhatsApp (official providers only) and calendar/scheduling integrations. */
import { env, requestJson } from "./http";

// ── WhatsApp ─────────────────────────────────────────────────────────────────
export interface WhatsAppAvailability {
  available: boolean;
  provider: "meta" | "twilio" | null;
  from: string | null;
  reason: string;
}

export function whatsappAvailability(): WhatsAppAvailability {
  const declared = env("WHATSAPP_PROVIDER").toLowerCase();
  if (declared === "meta" || (!declared && env("WHATSAPP_ACCESS_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID"))) {
    if (env("WHATSAPP_ACCESS_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")) {
      return { available: true, provider: "meta", from: env("WHATSAPP_PHONE_NUMBER_ID"), reason: "Meta WhatsApp Cloud API credentials present." };
    }
    return { available: false, provider: "meta", from: null, reason: "WHATSAPP_PROVIDER=meta but WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID missing." };
  }
  if (declared === "twilio" || (!declared && env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN"))) {
    if (env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_WHATSAPP_FROM")) {
      return { available: true, provider: "twilio", from: env("TWILIO_WHATSAPP_FROM"), reason: "Twilio WhatsApp sender configured." };
    }
    return { available: false, provider: "twilio", from: null, reason: "Twilio credentials incomplete (need SID, auth token and TWILIO_WHATSAPP_FROM)." };
  }
  return {
    available: false,
    provider: null,
    from: null,
    reason:
      "No WhatsApp Business provider configured. Drafting works; sending needs Meta Cloud API or Twilio. " +
      "Unofficial automation is intentionally not implemented because it breaks platform rules.",
  };
}

export interface WhatsAppSendResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  hint?: string;
}

export async function sendWhatsApp(input: { to: string; body: string }): Promise<WhatsAppSendResult> {
  const availability = whatsappAvailability();
  const to = input.to.replace(/[\s()-]/g, "");
  if (!availability.available || !availability.provider) {
    return { ok: false, provider: availability.provider || "none", error: availability.reason, hint: "Nothing was sent." };
  }
  if (!/^\+?\d{8,16}$/.test(to)) {
    return { ok: false, provider: availability.provider, error: `Recipient must be E.164 formatted (received "${input.to}").` };
  }

  if (availability.provider === "meta") {
    const response = await requestJson<{ messages?: Array<{ id: string }>; error?: { message?: string } }>(
      `https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: input.body } }),
      },
    );
    if (!response.ok) {
      return {
        ok: false,
        provider: "meta",
        error: response.data?.error?.message || response.error,
        hint: "Meta requires an approved template for messages outside the 24-hour customer service window.",
      };
    }
    return { ok: true, provider: "meta", messageId: response.data?.messages?.[0]?.id };
  }

  const sid = env("TWILIO_ACCOUNT_SID");
  const auth = Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64");
  const body = new URLSearchParams({
    From: `whatsapp:${env("TWILIO_WHATSAPP_FROM")}`,
    To: `whatsapp:${to}`,
    Body: input.body,
  });
  const response = await requestJson<{ sid?: string; message?: string }>(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${auth}` },
      body,
    },
  );
  if (!response.ok) {
    return { ok: false, provider: "twilio", error: response.data?.message || response.error, hint: "Twilio sandbox numbers must opt in first." };
  }
  return { ok: true, provider: "twilio", messageId: response.data?.sid };
}

export function composeWhatsAppMessage(input: {
  company: string;
  contactName?: string | null;
  topic: "intro" | "follow_up" | "appointment" | "reminder";
  senderName: string;
  detail?: string | null;
}): string {
  const firstName = (input.contactName || "").split(" ")[0];
  const greeting = firstName ? `Hi ${firstName}` : "Hi";
  switch (input.topic) {
    case "intro":
      return `${greeting}, it's ${input.senderName}. I had a look at ${input.company}'s website and spotted a few quick wins for turning visitors into enquiries. Want me to send the short list?`;
    case "follow_up":
      return `${greeting}, following up on my note about ${input.company}${input.detail ? ` — ${input.detail}` : ""}. Happy to walk you through it in 10 minutes if useful.`;
    case "appointment":
      return `${greeting}, confirming our call about ${input.company}${input.detail ? ` — ${input.detail}` : ""}. If anything changes just let me know here.`;
    case "reminder":
    default:
      return `${greeting}, quick reminder${input.detail ? `: ${input.detail}` : ` about ${input.company}`}. Reply here and I'll pick it up straight away.`;
  }
}

// ── Calendar ────────────────────────────────────────────────────────────────
export interface CalendarAvailability {
  available: boolean;
  provider: "calcom" | "calendly" | null;
  canBook: boolean;
  reason: string;
}

export function calendarAvailability(): CalendarAvailability {
  const declared = env("CALENDAR_PROVIDER").toLowerCase();
  if (declared === "calcom" || (!declared && env("CALCOM_API_KEY"))) {
    if (env("CALCOM_API_KEY") && env("CALCOM_EVENT_TYPE_ID")) {
      return { available: true, provider: "calcom", canBook: true, reason: "Cal.com API key and event type configured." };
    }
    return { available: false, provider: "calcom", canBook: false, reason: "CALCOM_API_KEY present but CALCOM_EVENT_TYPE_ID missing." };
  }
  if (declared === "calendly" || (!declared && env("CALENDLY_API_TOKEN"))) {
    if (env("CALENDLY_API_TOKEN") && env("CALENDLY_EVENT_TYPE_URI")) {
      return {
        available: true,
        provider: "calendly",
        canBook: false,
        reason: "Calendly availability can be read; creating bookings requires Calendly's scheduling flow, so booking stays manual.",
      };
    }
    return { available: false, provider: "calendly", canBook: false, reason: "Calendly token present but CALENDLY_EVENT_TYPE_URI missing." };
  }
  return {
    available: false,
    provider: null,
    canBook: false,
    reason: "No calendar provider configured. Booking is unavailable until CALCOM_API_KEY or CALENDLY_API_TOKEN is set.",
  };
}

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

export async function findSlots(input: { from: string; to: string; timezone?: string }): Promise<
  { ok: true; provider: string; slots: TimeSlot[] } | { ok: false; error: string; hint?: string }
> {
  const availability = calendarAvailability();
  if (!availability.available || !availability.provider) {
    return { ok: false, error: availability.reason, hint: "Configure Cal.com or Calendly to read live availability." };
  }

  if (availability.provider === "calcom") {
    const base = env("CALCOM_BASE_URL") || "https://api.cal.com/v2";
    const url = `${base}/slots?eventTypeId=${encodeURIComponent(env("CALCOM_EVENT_TYPE_ID"))}&start=${encodeURIComponent(input.from)}&end=${encodeURIComponent(input.to)}&timeZone=${encodeURIComponent(input.timezone || "UTC")}`;
    const response = await requestJson<{ data?: Record<string, Array<{ start: string }>> }>(url, {
      headers: { authorization: `Bearer ${env("CALCOM_API_KEY")}`, "cal-api-version": "2024-08-13" },
    });
    if (!response.ok) return { ok: false, error: response.error ?? "Cal.com slot request failed", hint: "Check the Cal.com API key and event type id." };
    const slots: TimeSlot[] = [];
    for (const value of Object.values(response.data?.data ?? {})) {
      for (const slot of value) {
        slots.push({ start: slot.start, end: new Date(new Date(slot.start).getTime() + 30 * 60_000).toISOString(), available: true });
      }
    }
    return { ok: true, provider: "calcom", slots: slots.slice(0, 60) };
  }

  const url = `https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(env("CALENDLY_EVENT_TYPE_URI"))}&start_time=${encodeURIComponent(input.from)}&end_time=${encodeURIComponent(input.to)}`;
  const response = await requestJson<{ collection?: Array<{ start_time: string; status: string }> }>(url, {
    headers: { authorization: `Bearer ${env("CALENDLY_API_TOKEN")}` },
  });
  if (!response.ok) return { ok: false, error: response.error ?? "Calendly availability request failed", hint: "Check the Calendly token and event type URI." };
  const slots = (response.data?.collection ?? []).map((slot) => ({
    start: slot.start_time,
    end: new Date(new Date(slot.start_time).getTime() + 30 * 60_000).toISOString(),
    available: slot.status === "available",
  }));
  return { ok: true, provider: "calendly", slots: slots.filter((slot) => slot.available).slice(0, 60) };
}

export async function bookSlot(input: {
  start: string;
  name: string;
  email: string;
  timezone?: string;
  notes?: string;
}): Promise<{ ok: true; provider: string; bookingId?: string } | { ok: false; error: string; hint?: string }> {
  const availability = calendarAvailability();
  if (!availability.available || !availability.provider) {
    return { ok: false, error: availability.reason };
  }
  if (availability.provider !== "calcom") {
    return {
      ok: false,
      error: "Booking through this provider is not implemented (Calendly has no public create-booking endpoint).",
      hint: "Configure Cal.com with an event type to enable one-click booking, or book through the Calendly link manually.",
    };
  }
  const base = env("CALCOM_BASE_URL") || "https://api.cal.com/v2";
  const response = await requestJson<{ data?: { uid?: string; id?: number } }>(`${base}/bookings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env("CALCOM_API_KEY")}`,
      "cal-api-version": "2024-08-13",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      eventTypeId: Number(env("CALCOM_EVENT_TYPE_ID")),
      start: input.start,
      attendee: { name: input.name, email: input.email, timeZone: input.timezone || "UTC", language: "en" },
      metadata: { source: "haseeb-ai", notes: input.notes || "" },
    }),
  });
  if (!response.ok) return { ok: false, error: response.error ?? "Cal.com booking request failed", hint: "Verify attendee email, slot availability and event type settings." };
  return { ok: true, provider: "calcom", bookingId: response.data?.data?.uid || String(response.data?.data?.id ?? "") };
}

export async function cancelBooking(input: { bookingId: string; reason?: string }): Promise<{ ok: boolean; error?: string; hint?: string }> {
  const availability = calendarAvailability();
  if (availability.provider !== "calcom") {
    return { ok: false, error: availability.reason, hint: "Only Cal.com cancellations are supported automatically." };
  }
  const base = env("CALCOM_BASE_URL") || "https://api.cal.com/v2";
  const response = await requestJson(`${base}/bookings/${encodeURIComponent(input.bookingId)}/cancel`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env("CALCOM_API_KEY")}`,
      "cal-api-version": "2024-08-13",
      "content-type": "application/json",
    },
    body: JSON.stringify({ cancellationReason: input.reason || "Cancelled by owner via Haseeb AI" }),
  });
  if (!response.ok) return { ok: false, error: response.error };
  return { ok: true };
}
