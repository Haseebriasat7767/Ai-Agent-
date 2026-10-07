import { env, requestJson } from "./http";

export interface EmailAvailability {
  available: boolean;
  provider: "resend" | "smtp" | null;
  from: string;
  reason: string;
}

export function emailAvailability(): EmailAvailability {
  const from = env("EMAIL_FROM") || env("SMTP_FROM") || "Haseeb AI <no-reply@localhost>";
  const declared = env("EMAIL_PROVIDER").toLowerCase();
  if (declared === "resend" || (!declared && env("RESEND_API_KEY"))) {
    if (env("RESEND_API_KEY")) return { available: true, provider: "resend", from, reason: "Resend API key present." };
    return { available: false, provider: "resend", from, reason: "EMAIL_PROVIDER=resend but RESEND_API_KEY is empty." };
  }
  if (declared === "smtp" || (!declared && env("SMTP_HOST"))) {
    if (env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASSWORD")) {
      return { available: true, provider: "smtp", from, reason: `SMTP relay ${env("SMTP_HOST")}:${env("SMTP_PORT") || 587} configured.` };
    }
    return { available: false, provider: "smtp", from, reason: "SMTP_HOST/SMTP_USER/SMTP_PASSWORD are incomplete." };
  }
  return {
    available: false,
    provider: null,
    from,
    reason: "No email provider configured. Drafting works; sending is disabled until RESEND_API_KEY or SMTP_* is set.",
  };
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  html?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface SendEmailResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  hint?: string;
  simulated?: false;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const availability = emailAvailability();
  if (!availability.available || !availability.provider) {
    return {
      ok: false,
      provider: availability.provider || "none",
      error: availability.reason,
      hint: "Configure RESEND_API_KEY or SMTP_* in the environment. Nothing was sent.",
    };
  }

  if (availability.provider === "resend") {
    const response = await requestJson<{ id?: string; message?: string }>("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env("RESEND_API_KEY")}` },
      body: JSON.stringify({
        from: availability.from,
        to: [input.to],
        subject: input.subject,
        text: input.body,
        html: input.html,
        reply_to: input.replyTo,
        attachments: input.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content.toString("base64"),
        })),
      }),
      timeoutMs: 25_000,
    });
    if (!response.ok) {
      return { ok: false, provider: "resend", error: response.error, hint: response.retryable ? "Retry shortly." : "Check the API key, verified sending domain and recipient address." };
    }
    return { ok: true, provider: "resend", messageId: response.data?.id };
  }

  // SMTP via nodemailer (loaded lazily so the dependency is only needed when used).
  try {
    const nodemailer = (await import("nodemailer")) as typeof import("nodemailer");
    const transport = nodemailer.createTransport({
      host: env("SMTP_HOST"),
      port: Number(env("SMTP_PORT") || 587),
      secure: env("SMTP_SECURE") === "true",
      auth: { user: env("SMTP_USER"), pass: env("SMTP_PASSWORD") },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
    });
    const info = await transport.sendMail({
      from: availability.from,
      to: input.to,
      subject: input.subject,
      text: input.body,
      html: input.html,
      replyTo: input.replyTo,
      attachments: input.attachments,
    });
    return { ok: true, provider: "smtp", messageId: info.messageId };
  } catch (error) {
    return {
      ok: false,
      provider: "smtp",
      error: error instanceof Error ? error.message : String(error),
      hint: "Check SMTP host, port, TLS mode and credentials. Many hosts require an app password.",
    };
  }
}

// ── Draft helpers (deterministic templates the agent can refine) ────────────

export interface DraftEmailInput {
  company: string;
  contactName?: string | null;
  industry?: string | null;
  location?: string | null;
  painPoints?: string[];
  opportunity?: string | null;
  senderName: string;
  website?: string | null;
  style?: string;
}

export function composeOutreachEmail(input: DraftEmailInput): { subject: string; body: string } {
  const firstName = (input.contactName || "").split(" ")[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const location = input.location ? ` in ${input.location}` : "";
  const pain = input.painPoints?.filter(Boolean).slice(0, 3) ?? [];
  const painBlock = pain.length
    ? pain.map((item) => `• ${item}`).join("\n")
    : "• The site is hard to use on mobile\n• Visitors have no obvious next step\n• Nothing captures enquiries automatically";
  const subject = `${input.company}: a faster way to turn website visits into booked calls`;

  const body = [
    greeting,
    "",
    `I reviewed ${input.company}${location ? ` — ${input.website || location}` : ""}. ${input.opportunity || `I noticed a few gaps that cost you enquiries.`}`,
    "",
    "What I found:",
    painBlock,
    "",
    "I build AI-assisted websites and follow-up systems for "
      + `${input.industry || "businesses"} that do three things: load fast on mobile, capture leads automatically, and follow up without extra admin.`,
    "",
    "Worth a 15-minute call to see whether it applies to you? If not, I'll send the findings over anyway — no charge.",
    "",
    "Best,",
    input.senderName,
  ].join("\n");

  return { subject, body };
}

export interface SequenceStep {
  day: number;
  subject: string;
  body: string;
}

export function composeFollowUpSequence(input: DraftEmailInput): SequenceStep[] {
  const first = composeOutreachEmail(input);
  const firstName = (input.contactName || "").split(" ")[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  return [
    { day: 0, subject: first.subject, body: first.body },
    {
      day: 3,
      subject: `Re: ${input.company} website findings`,
      body: [
        greeting,
        "",
        `Following up on my note about ${input.company}. I put together a short list of the three fixes that would have the biggest impact on enquiries.`,
        "",
        "Want me to send it over? It takes two minutes to read and you can implement it with or without me.",
        "",
        "Best,",
        input.senderName,
      ].join("\n"),
    },
    {
      day: 7,
      subject: `Last note — ${input.company}`,
      body: [
        greeting,
        "",
        "I'll stop here so I'm not cluttering your inbox. If improving conversion on your site becomes a priority this quarter, reply with a one-word yes and I'll pick it up.",
        "",
        "Either way, good luck with the season ahead.",
        "",
        input.senderName,
      ].join("\n"),
    },
  ];
}

export function composeReplySuggestion(context: {
  inbound: string;
  senderName: string;
  company?: string;
  intent: "interested" | "question" | "not_now" | "not_interested" | "unclear";
}): string {
  const lines = ["Thanks for coming back to me.", ""];
  switch (context.intent) {
    case "interested":
      lines.push(
        `Great — here's what happens next. I'll prepare a short proposal for ${context.company || "your team"} covering scope, timeline and cost.`,
        "",
        "If you share two or three times that work for a 20-minute call this week, I'll confirm one.",
      );
      break;
    case "question":
      lines.push("Happy to answer that properly rather than guess — could you confirm which part matters most?", "", "I'll come back with a specific answer the same day.");
      break;
    case "not_now":
      lines.push("Understood — timing matters more than speed here.", "", "I'll check back in a quarter unless you'd prefer I close the loop entirely.");
      break;
    case "not_interested":
      lines.push("Appreciated, and no hard feelings. I'll close this out on my side.", "", "If anything changes down the line, you have my details.");
      break;
    default:
      lines.push("Reading between the lines, I'm not certain whether this is a fit right now.", "", "One question: is improving conversion a priority this quarter, or should I park it?");
  }
  lines.push("", context.senderName);
  return lines.join("\n");
}
