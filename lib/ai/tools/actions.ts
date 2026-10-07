import { tool } from "ai";
import { z } from "zod";
import { composeFollowUpSequence, composeOutreachEmail, composeReplySuggestion, emailAvailability } from "@/lib/integrations/email";
import { calendarAvailability, composeWhatsAppMessage, findSlots, whatsappAvailability } from "@/lib/integrations/messaging";
import { createApproval, getApproval, listApprovals } from "@/lib/repo/approvals";
import { addLeadActivity, getLead, updateLead } from "@/lib/repo/leads";
import { createAppointment, createDraft, listAppointments, listOutbound, updateOutbound } from "@/lib/repo/outbound";
import { executeApproval, standingPermissionFor } from "@/lib/approvals/execute";
import { markApprovalExecuted, markApprovalFailed } from "@/lib/repo/approvals";
import { failure, track, unavailable, type ToolContext } from "./context";

function leadContext(lead: Awaited<ReturnType<typeof getLead>>) {
  return {
    company: lead?.company ?? "the company",
    contactName: lead?.contactName ?? null,
    industry: lead?.industry ?? null,
    location: lead?.location ?? null,
    website: lead?.website ?? null,
    painPoints: lead?.painPoints ?? [],
    opportunity: lead?.aiOpportunity ?? null,
  };
}

export function actionTools(context: ToolContext) {
  return {
    draft_email: tool({
      description:
        "Create an email draft (stored in the workspace, nothing is sent). Use it for outreach, replies, follow-ups or proposals. Recipient must be a real address from the lead record or the user's instruction — never invent one.",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string(),
        body: z.string().describe("Plain-text body. No markdown formatting characters except line breaks."),
        leadId: z.string().nullable().default(null),
        note: z.string().optional().describe("Internal note about what this draft is for"),
      }),
      execute: async ({ to, subject, body, leadId }) => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
          return failure("draft_email", `"${to}" is not a valid email address.`, "Find the real address on the company website or leave it out and tell Haseeb it must be found manually.");
        }
        const draft = await createDraft(context.userId, {
          channel: "email",
          to,
          subject,
          body,
          leadId,
          projectId: context.projectId,
        });
        if (leadId) {
          await addLeadActivity(context.userId, {
            leadId,
            type: "draft",
            summary: `Email draft created: ${subject}`,
            detail: { draftId: draft.id, to },
          });
        }
        await track(context, {
          type: "draft",
          status: "success",
          title: `Email draft ready: ${subject}`,
          tool: "draft_email",
          detail: { draftId: draft.id, to },
        });
        return {
          ok: true,
          draftId: draft.id,
          to,
          subject,
          body,
          status: draft.status,
          emailSendingConfigured: emailAvailability().available,
          next: "Review the draft. To send it, call send_email with this draftId — that creates an approval unless a standing permission exists.",
        };
      },
    }),

    compose_outreach_email: tool({
      description:
        "Generate a tailored outreach email for an existing lead using the lead's own research (website gaps, industry, location) and save it as a draft. Best starting point for 'draft emails to the hottest leads'.",
      inputSchema: z.object({ leadId: z.string(), tone: z.string().optional() }),
      execute: async ({ leadId }) => {
        const lead = await getLead(context.userId, leadId);
        if (!lead) return failure("compose_outreach_email", "Lead not found.");
        const recipient = lead.email;
        const composed = composeOutreachEmail({
          ...leadContext(lead),
          senderName: context.user.name,
          style: context.user.settings.writingStyle,
        });
        if (!recipient) {
          await track(context, {
            type: "draft",
            status: "warning",
            title: `Outreach drafted for ${lead.company}, but no verified email exists`,
            tool: "compose_outreach_email",
            detail: { leadId },
          });
          return {
            ok: true,
            leadId,
            sent: false,
            draftCreated: false,
            subject: composed.subject,
            body: composed.body,
            warning: `No email address is stored for ${lead.company}. The draft was not saved because there is no recipient. ${lead.website ? `Find the address on ${lead.website} (contact page) or via LinkedIn, then call draft_email.` : "No website is stored either — research the company first."}`,
          };
        }
        const draft = await createDraft(context.userId, {
          channel: "email",
          to: recipient,
          subject: composed.subject,
          body: composed.body,
          leadId,
          projectId: context.projectId,
        });
        await addLeadActivity(context.userId, {
          leadId,
          type: "draft",
          summary: `Personalised outreach drafted: ${composed.subject}`,
          detail: { draftId: draft.id },
        });
        await track(context, {
          type: "draft",
          status: "success",
          title: `Outreach drafted for ${lead.company}`,
          tool: "compose_outreach_email",
          detail: { draftId: draft.id, leadId },
        });
        return { ok: true, draftId: draft.id, leadId, to: recipient, subject: composed.subject, body: composed.body, emailStatus: lead.emailStatus };
      },
    }),

    draft_follow_up_sequence: tool({
      description: "Create a 3-step follow-up sequence (day 0, +3, +7) as separate drafts for one lead.",
      inputSchema: z.object({ leadId: z.string() }),
      execute: async ({ leadId }) => {
        const lead = await getLead(context.userId, leadId);
        if (!lead) return failure("draft_follow_up_sequence", "Lead not found.");
        if (!lead.email) {
          return { ok: false, status: "error", capability: "draft_follow_up_sequence", error: `No email address stored for ${lead.company}, so no drafts were created.` };
        }
        const steps = composeFollowUpSequence({ ...leadContext(lead), senderName: context.user.name });
        const drafts: Array<{ day: number; draftId: string; subject: string }> = [];
        for (const step of steps) {
          const draft = await createDraft(context.userId, {
            channel: "email",
            to: lead.email,
            subject: step.subject,
            body: step.body,
            leadId,
            projectId: context.projectId,
          });
          drafts.push({ day: step.day, draftId: draft.id, subject: step.subject });
        }
        await addLeadActivity(context.userId, { leadId, type: "sequence", summary: `Follow-up sequence created (${drafts.length} drafts)` });
        await track(context, { type: "draft", status: "success", title: `Sequence drafted for ${lead.company}`, tool: "draft_follow_up_sequence", detail: { drafts } });
        return { ok: true, leadId, drafts, steps };
      },
    }),

    send_email: tool({
      description:
        "Send a saved email draft. WITHOUT a standing permission this creates a pending approval that Haseeb must approve — it does NOT send. If the result says sent:true the provider accepted the message; anything else means nothing was sent.",
      inputSchema: z.object({
        draftId: z.string(),
        subjectOverride: z.string().optional(),
        bodyOverride: z.string().optional(),
      }),
      execute: async ({ draftId, subjectOverride, bodyOverride }) => {
        const drafts = await listOutbound(context.userId, { channel: "email", status: "all", limit: 200 });
        const draft = drafts.find((item) => item.id === draftId);
        if (!draft) return failure("send_email", "Draft not found.");
        if (draft.status === "sent") return { ok: true, alreadySent: true, sentAt: draft.sentAt, note: "This draft was already sent." };

        const to = draft.to;
        const subject = subjectOverride ?? draft.subject ?? "(no subject)";
        const body = bodyOverride ?? draft.body;
        if (subjectOverride || bodyOverride) await updateOutbound(context.userId, draft.id, { subject, body, to });

        const payload = { outboundMessageId: draft.id, to, subject, body };
        const availability = emailAvailability();

        if (standingPermissionFor(context.user, "send_email")) {
          if (!availability.available) {
            return unavailable("email sending", availability.reason, "Configure RESEND_API_KEY or SMTP_* — nothing was sent.");
          }
          const approval = await createApproval(context.userId, {
            type: "send_email",
            title: `Send email to ${to}`,
            summary: subject,
            payload,
            conversationId: context.conversationId,
            projectId: context.projectId,
          });
          const result = await executeApproval(context.userId, approval);
          if (result.ok) {
            await markApprovalExecuted(context.userId, approval.id, result.result ?? {});
            await track(context, { type: "email", status: "success", title: `Email sent to ${to} (standing permission)`, tool: "send_email", detail: { result: result.result } });
            return { ok: true, sent: true, standing: true, to, subject, provider: result.result?.provider ?? availability.provider, messageId: result.result?.messageId ?? null };
          }
          await markApprovalFailed(context.userId, approval.id, result.error ?? "send failed");
          return failure("send_email", result.error ?? "Send failed", result.hint);
        }

        const approval = await createApproval(context.userId, {
          type: "send_email",
          title: `Send email to ${to}`,
          summary: `${subject} — ${to}`,
          payload,
          riskLevel: "medium",
          conversationId: context.conversationId,
          projectId: context.projectId,
        });
        await updateOutbound(context.userId, draft.id, { status: "awaiting_approval", approvalId: approval.id });
        if (draft.leadId) {
          await addLeadActivity(context.userId, { leadId: draft.leadId, type: "approval", summary: `Email to ${to} awaiting approval`, detail: { approvalId: approval.id } });
        }
        await track(context, {
          type: "approval_requested",
          status: "pending",
          title: `Approval requested: email to ${to}`,
          tool: "send_email",
          detail: { approvalId: approval.id },
        });
        return {
          ok: true,
          sent: false,
          requiresApproval: true,
          approvalId: approval.id,
          to,
          subject,
          body,
          providerReady: availability.available,
          providerNote: availability.reason,
          instruction: "Tell the user an approval is waiting. Do not claim the email was sent.",
        };
      },
    }),

    draft_whatsapp: tool({
      description: "Create a WhatsApp message draft (stored, nothing sent). Requires a real E.164 recipient number.",
      inputSchema: z.object({
        to: z.string().describe("E.164 number, e.g. +14155550123"),
        body: z.string(),
        leadId: z.string().nullable().default(null),
      }),
      execute: async ({ to, body, leadId }) => {
        const normalized = to.replace(/[\s()-]/g, "");
        if (!/^\+?\d{8,16}$/.test(normalized)) {
          return failure("draft_whatsapp", `"${to}" is not an E.164 phone number.`, "Use the number published on the company website — never invent one.");
        }
        const draft = await createDraft(context.userId, {
          channel: "whatsapp",
          to: normalized.startsWith("+") ? normalized : `+${normalized}`,
          body,
          leadId,
          projectId: context.projectId,
        });
        await track(context, { type: "draft", status: "success", title: `WhatsApp draft ready for ${normalized}`, tool: "draft_whatsapp", detail: { draftId: draft.id } });
        return {
          ok: true,
          draftId: draft.id,
          to: draft.to,
          body,
          whatsappConfigured: whatsappAvailability().available,
          providerNote: whatsappAvailability().reason,
          next: "Call send_whatsapp with this draftId to request approval.",
        };
      },
    }),

    compose_whatsapp_message: tool({
      description: "Compose a WhatsApp message for a lead (intro, follow-up, appointment or reminder) and save it as a draft if the lead has a phone number.",
      inputSchema: z.object({
        leadId: z.string(),
        topic: z.enum(["intro", "follow_up", "appointment", "reminder"]).default("intro"),
        detail: z.string().optional(),
      }),
      execute: async ({ leadId, topic, detail }) => {
        const lead = await getLead(context.userId, leadId);
        if (!lead) return failure("compose_whatsapp_message", "Lead not found.");
        const body = composeWhatsAppMessage({
          company: lead.company,
          contactName: lead.contactName,
          topic,
          senderName: context.user.name,
          detail: detail ?? null,
        });
        if (!lead.phone) {
          return { ok: true, draftCreated: false, body, warning: `No phone number stored for ${lead.company}. Draft not saved — find the number on the website first.` };
        }
        const draft = await createDraft(context.userId, {
          channel: "whatsapp",
          to: lead.phone,
          body,
          leadId,
          projectId: context.projectId,
        });
        return { ok: true, draftId: draft.id, to: draft.to, body, topic };
      },
    }),

    send_whatsapp: tool({
      description:
        "Send a saved WhatsApp draft through the official Business API. Creates an approval unless a standing permission exists. sent:true only when the provider accepted the message.",
      inputSchema: z.object({ draftId: z.string() }),
      execute: async ({ draftId }) => {
        const drafts = await listOutbound(context.userId, { channel: "whatsapp", status: "all", limit: 200 });
        const draft = drafts.find((item) => item.id === draftId);
        if (!draft) return failure("send_whatsapp", "Draft not found.");
        const payload = { outboundMessageId: draft.id, to: draft.to, body: draft.body };
        const availability = whatsappAvailability();

        if (standingPermissionFor(context.user, "send_whatsapp")) {
          if (!availability.available) return unavailable("WhatsApp sending", availability.reason, "Configure the Meta Cloud API or Twilio credentials — nothing was sent.");
          const approval = await createApproval(context.userId, {
            type: "send_whatsapp",
            title: `Send WhatsApp to ${draft.to}`,
            summary: draft.body.slice(0, 120),
            payload,
            conversationId: context.conversationId,
            projectId: context.projectId,
          });
          const result = await executeApproval(context.userId, approval);
          if (result.ok) {
            await markApprovalExecuted(context.userId, approval.id, result.result ?? {});
            await track(context, { type: "whatsapp", status: "success", title: `WhatsApp sent to ${draft.to} (standing permission)`, tool: "send_whatsapp" });
            return { ok: true, sent: true, standing: true, to: draft.to, provider: result.result?.provider ?? null };
          }
          await markApprovalFailed(context.userId, approval.id, result.error ?? "send failed");
          return failure("send_whatsapp", result.error ?? "Send failed", result.hint);
        }

        const approval = await createApproval(context.userId, {
          type: "send_whatsapp",
          title: `Send WhatsApp to ${draft.to}`,
          summary: draft.body.slice(0, 160),
          payload,
          riskLevel: "medium",
          conversationId: context.conversationId,
          projectId: context.projectId,
        });
        await updateOutbound(context.userId, draft.id, { status: "awaiting_approval", approvalId: approval.id });
        await track(context, { type: "approval_requested", status: "pending", title: `Approval requested: WhatsApp to ${draft.to}`, tool: "send_whatsapp", detail: { approvalId: approval.id } });
        return {
          ok: true,
          sent: false,
          requiresApproval: true,
          approvalId: approval.id,
          to: draft.to,
          body: draft.body,
          providerReady: availability.available,
          providerNote: availability.reason,
          instruction: "Tell the user an approval is waiting. Do not claim the message was sent.",
        };
      },
    }),

    find_appointment_slots: tool({
      description: "Read live availability from the configured calendar provider for a date range.",
      inputSchema: z.object({
        from: z.string().describe("ISO start of the search window"),
        to: z.string().describe("ISO end of the search window"),
        timezone: z.string().optional(),
      }),
      execute: async ({ from, to, timezone }) => {
        const availability = calendarAvailability();
        if (!availability.available) {
          return unavailable("calendar availability", availability.reason, "Set CALCOM_API_KEY + CALCOM_EVENT_TYPE_ID (or CALENDLY_API_TOKEN + CALENDLY_EVENT_TYPE_URI).");
        }
        const result = await findSlots({ from, to, timezone: timezone ?? context.user.timezone ?? "UTC" });
        if (!result.ok) return failure("find_appointment_slots", result.error, result.hint);
        await track(context, { type: "appointment", status: "success", title: `Read ${result.slots.length} available slots`, tool: "find_appointment_slots" });
        return { ok: true, provider: result.provider, slots: result.slots.slice(0, 30) };
      },
    }),

    book_appointment: tool({
      description:
        "Request an appointment booking. Creates a local appointment record plus an approval; the provider booking happens only after approval (or immediately with a standing permission).",
      inputSchema: z.object({
        title: z.string(),
        start: z.string().describe("ISO-8601 start time of an available slot"),
        end: z.string().describe("ISO-8601 end time"),
        attendeeName: z.string(),
        attendeeEmail: z.string(),
        leadId: z.string().nullable().default(null),
        timezone: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: async ({ title, start, end, attendeeName, attendeeEmail, leadId, timezone, notes }) => {
        const appointment = await createAppointment(context.userId, {
          title,
          startAt: start,
          endAt: end,
          withName: attendeeName,
          withEmail: attendeeEmail,
          leadId,
          projectId: context.projectId,
          timezone: timezone ?? context.user.timezone ?? "UTC",
          notes: notes ?? null,
          provider: calendarAvailability().provider,
          status: "pending_approval",
        });
        const payload = {
          appointmentId: appointment.id,
          start,
          end,
          name: attendeeName,
          email: attendeeEmail,
          timezone: timezone ?? context.user.timezone ?? "UTC",
          notes: notes ?? "",
        };
        const availability = calendarAvailability();

        if (standingPermissionFor(context.user, "book_appointment") && availability.canBook) {
          const approval = await createApproval(context.userId, {
            type: "book_appointment",
            title: `Book ${start} with ${attendeeName}`,
            summary: title,
            payload,
            conversationId: context.conversationId,
            projectId: context.projectId,
          });
          const result = await executeApproval(context.userId, approval);
          if (result.ok) {
            await markApprovalExecuted(context.userId, approval.id, result.result ?? {});
            return { ok: true, booked: true, standing: true, appointmentId: appointment.id, ...result.result };
          }
          await markApprovalFailed(context.userId, approval.id, result.error ?? "booking failed");
          return failure("book_appointment", result.error ?? "Booking failed", result.hint);
        }

        const approval = await createApproval(context.userId, {
          type: "book_appointment",
          title: `Book ${start} with ${attendeeName}`,
          summary: `${title} — ${availability.canBook ? "will be created in the connected calendar after approval" : "calendar booking is not configured; approving records the appointment locally only"}`,
          payload,
          riskLevel: "medium",
          conversationId: context.conversationId,
          projectId: context.projectId,
        });
        await track(context, { type: "approval_requested", status: "pending", title: `Approval requested: book ${start}`, tool: "book_appointment", detail: { approvalId: approval.id } });
        return {
          ok: true,
          booked: false,
          requiresApproval: true,
          approvalId: approval.id,
          appointmentId: appointment.id,
          providerReady: availability.canBook,
          providerNote: availability.reason,
          instruction: "Say that approval is pending. Do not claim the meeting exists yet.",
        };
      },
    }),

    cancel_appointment: tool({
      description: "Request cancellation of an appointment (approval required unless a standing permission exists).",
      inputSchema: z.object({ appointmentId: z.string(), reason: z.string().optional() }),
      execute: async ({ appointmentId, reason }) => {
        const appointments = await listAppointments(context.userId, { status: "all", limit: 200 });
        const appointment = appointments.find((item) => item.id === appointmentId);
        if (!appointment) return failure("cancel_appointment", "Appointment not found.");
        const payload = { appointmentId, providerEventId: appointment.providerEventId, reason: reason ?? "" };
        const approval = await createApproval(context.userId, {
          type: "cancel_appointment",
          title: `Cancel: ${appointment.title}`,
          summary: `${appointment.startAt} with ${appointment.withName ?? "unknown attendee"}`,
          payload,
          riskLevel: "medium",
          conversationId: context.conversationId,
          projectId: context.projectId,
        });
        await track(context, { type: "approval_requested", status: "pending", title: `Approval requested: cancel ${appointment.title}`, tool: "cancel_appointment", detail: { approvalId: approval.id } });
        return {
          ok: true,
          cancelled: false,
          requiresApproval: true,
          approvalId: approval.id,
          appointment: { id: appointment.id, title: appointment.title, startAt: appointment.startAt, provider: appointment.provider },
        };
      },
    }),

    list_appointments: tool({
      description: "List appointments, optionally within a window.",
      inputSchema: z.object({ from: z.string().optional(), to: z.string().optional(), status: z.enum(["scheduled", "pending_approval", "cancelled", "completed", "all"]).default("all") }),
      execute: async ({ from, to, status }) => {
        const appointments = await listAppointments(context.userId, { from, to, status, limit: 50 });
        return { ok: true, count: appointments.length, appointments };
      },
    }),

    list_outbound_messages: tool({
      description: "List email/WhatsApp drafts and their status (draft, awaiting_approval, sent, failed). Use it to check what actually went out.",
      inputSchema: z.object({ channel: z.enum(["email", "whatsapp"]).optional(), status: z.enum(["draft", "awaiting_approval", "sent", "failed", "cancelled", "all"]).default("all") }),
      execute: async ({ channel, status }) => {
        const messages = await listOutbound(context.userId, { channel, status, limit: 50 });
        return { ok: true, count: messages.length, messages };
      },
    }),

    suggest_reply: tool({
      description: "Draft a reply to an inbound message. Provide the inbound text; the tool suggests a reply that you can refine, and saves it as a draft when a recipient address is known.",
      inputSchema: z.object({
        inbound: z.string().min(10),
        intent: z.enum(["interested", "question", "not_now", "not_interested", "unclear"]).default("unclear"),
        leadId: z.string().nullable().default(null),
        to: z.string().optional(),
        subject: z.string().optional(),
        saveDraft: z.boolean().default(false),
      }),
      execute: async ({ inbound, intent, leadId, to, subject, saveDraft }) => {
        const lead = leadId ? await getLead(context.userId, leadId) : null;
        const suggestion = composeReplySuggestion({
          inbound,
          intent,
          senderName: context.user.name,
          company: lead?.company,
        });
        let draftId: string | null = null;
        const recipient = to ?? lead?.email ?? null;
        if (saveDraft && recipient) {
          const draft = await createDraft(context.userId, {
            channel: "email",
            to: recipient,
            subject: subject ?? `Re: ${lead?.company ?? "your message"}`,
            body: suggestion,
            leadId,
            projectId: context.projectId,
          });
          draftId = draft.id;
        }
        return { ok: true, suggestion, draftId, saved: Boolean(draftId), warning: saveDraft && !recipient ? "No recipient address was available, so nothing was saved." : null };
      },
    }),

    prepare_deployment: tool({
      description:
        "Request deployment of a generated website. Always approval-gated. Without a deploy hook configured, approval marks the site ready_to_deploy and nothing is published (the tool says so explicitly).",
      inputSchema: z.object({ websiteId: z.string(), note: z.string().optional() }),
      execute: async ({ websiteId, note }) => {
        const approval = await createApproval(context.userId, {
          type: "deploy_website",
          title: "Deploy website to production",
          summary: note ?? "Publish the generated website to the production target",
          payload: { websiteId, note: note ?? "" },
          riskLevel: "medium",
          conversationId: context.conversationId,
          projectId: context.projectId,
        });
        await track(context, { type: "approval_requested", status: "pending", title: "Approval requested: deploy website", tool: "prepare_deployment", detail: { approvalId: approval.id, websiteId } });
        return {
          ok: true,
          deployed: false,
          requiresApproval: true,
          approvalId: approval.id,
          deployHookConfigured: Boolean((process.env.VERCEL_DEPLOY_HOOK_URL || "").trim()),
          instruction: "Explain that approval is pending and nothing is published yet.",
        };
      },
    }),

    delete_record: tool({
      description: "Request deletion of a record (lead, task, file, report, website, conversation). Always approval-gated.",
      inputSchema: z.object({
        entity: z.enum(["lead", "task", "file", "report", "website", "conversation"]),
        id: z.string(),
        reason: z.string().optional(),
      }),
      execute: async ({ entity, id, reason }) => {
        const approval = await createApproval(context.userId, {
          type: "delete_data",
          title: `Delete ${entity} ${id}`,
          summary: reason ?? "No reason given",
          payload: { entity, id },
          riskLevel: "high",
          conversationId: context.conversationId,
          projectId: context.projectId,
        });
        await track(context, { type: "approval_requested", status: "pending", title: `Approval requested: delete ${entity}`, tool: "delete_record", detail: { approvalId: approval.id } });
        return {
          ok: true,
          deleted: false,
          requiresApproval: true,
          approvalId: approval.id,
          instruction: "Explain that deletion needs approval and has not happened.",
        };
      },
    }),

    request_approval: tool({
      description:
        "Request approval for any other consequential action (purchases, external API changes, anything that leaves the workspace). Provide a precise payload describing exactly what will happen.",
      inputSchema: z.object({
        type: z.enum(["send_email", "send_whatsapp", "book_appointment", "cancel_appointment", "deploy_website", "delete_data", "purchase", "external_api_change"]),
        title: z.string(),
        summary: z.string(),
        payload: z.record(z.string(), z.unknown()),
        riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
      }),
      execute: async ({ type, title, summary, payload, riskLevel }) => {
        const approval = await createApproval(context.userId, {
          type,
          title,
          summary,
          payload,
          riskLevel,
          conversationId: context.conversationId,
          projectId: context.projectId,
        });
        await track(context, { type: "approval_requested", status: "pending", title: `Approval requested: ${title}`, tool: "request_approval", detail: { approvalId: approval.id, type } });
        return { ok: true, requiresApproval: true, approvalId: approval.id, status: "pending", instruction: "Nothing has been executed. Ask the user to approve or reject." };
      },
    }),

    list_approvals: tool({
      description: "List approval requests and their current status.",
      inputSchema: z.object({ status: z.enum(["pending", "approved", "rejected", "failed", "executed", "all"]).default("pending") }),
      execute: async ({ status }) => {
        const approvals = await listApprovals(context.userId, { status, limit: 50 });
        return { ok: true, count: approvals.length, approvals };
      },
    }),

    check_approval_status: tool({
      description: "Check a single approval to see whether it was approved, rejected, executed or failed, and what the provider returned.",
      inputSchema: z.object({ approvalId: z.string() }),
      execute: async ({ approvalId }) => {
        const approval = await getApproval(context.userId, approvalId);
        if (!approval) return failure("check_approval_status", "Approval not found.");
        return { ok: true, approval };
      },
    }),
  };
}
