"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Pencil, Send, ShieldAlert, XCircle } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { Field, Modal, Spinner } from "@/components/ui/primitives";
import { cn, formatDateTime } from "@/lib/utils";
import type { Approval } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  send_email: "Send email",
  send_whatsapp: "Send WhatsApp message",
  book_appointment: "Book appointment",
  cancel_appointment: "Cancel appointment",
  deploy_website: "Deploy website",
  delete_data: "Delete data",
  purchase: "Make a purchase",
  external_api_change: "Change an external system",
};

export function ApprovalCard({ approvalId, onDecided }: { approvalId: string; onDecided?: () => void }) {
  const { api, pushToast, refreshApprovals } = useApp();
  const [approval, setApproval] = useState<Approval | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{ executed: boolean; error?: string; hint?: string; result?: Record<string, unknown> } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ approval: Approval }>(`/api/approvals/${approvalId}`);
      setApproval(data.approval);
    } catch (error) {
      console.error("[approval] load failed", error);
    }
  }, [api, approvalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    try {
      const data = await api<{ approval: Approval; executed: boolean; error?: string; hint?: string; result?: Record<string, unknown> }>(
        `/api/approvals/${approvalId}`,
        { method: "POST", json: { decision } },
      );
      setApproval(data.approval);
      setResult({ executed: data.executed, error: data.error, hint: data.hint, result: data.result });
      if (decision === "approve" && !data.executed) {
        pushToast({ tone: "error", title: "Approved, but the action failed", description: data.error ?? "See the card for details." });
      } else if (decision === "approve") {
        pushToast({ tone: "success", title: "Approved and executed" });
      } else {
        pushToast({ tone: "info", title: "Rejected", description: "Nothing was performed." });
      }
      await refreshApprovals();
      onDecided?.();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not record the decision", description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setBusy(null);
    }
  };

  if (!approval) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2.5 text-[0.72rem] text-muted">
        <Spinner /> Loading approval…
      </div>
    );
  }

  const payload = approval.payload as {
    to?: string;
    subject?: string;
    body?: string;
    start?: string;
    name?: string;
    email?: string;
    websiteId?: string;
    entity?: string;
    id?: string;
  };

  const pending = approval.status === "pending";

  return (
    <div
      className={cn(
        "mt-2 overflow-hidden rounded-xl border",
        pending ? "border-[rgba(245,184,67,0.35)] bg-[rgba(245,184,67,0.055)]" : "border-[color:var(--color-line)] bg-white/[0.02]",
      )}
    >
      <div className="flex items-center gap-2 border-b border-[color:var(--color-line)] px-3 py-2">
        <ShieldAlert size={14} className={pending ? "text-[color:var(--color-warn)]" : "text-muted"} />
        <span className="text-[0.72rem] font-medium text-ink">{pending ? "AI wants to perform this action" : `Approval ${approval.status}`}</span>
        <span className="chip ml-auto">{TYPE_LABELS[approval.type] ?? approval.type}</span>
        <span className={cn("chip", approval.riskLevel === "high" ? "chip-danger" : approval.riskLevel === "medium" ? "chip-warn" : "")}>{approval.riskLevel} risk</span>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <p className="text-[0.8rem] font-medium text-ink">{approval.title}</p>
        {approval.summary ? <p className="text-[0.72rem] leading-relaxed text-muted">{approval.summary}</p> : null}

        {approval.type === "send_email" && (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-black/25 p-2.5">
            <p className="text-[0.68rem] uppercase tracking-[0.08em] text-faint">Recipient</p>
            <p className="text-[0.76rem] text-ink-soft">{payload.to}</p>
            <p className="mt-2 text-[0.68rem] uppercase tracking-[0.08em] text-faint">Subject</p>
            <p className="text-[0.76rem] text-ink-soft">{payload.subject}</p>
            <p className="mt-2 text-[0.68rem] uppercase tracking-[0.08em] text-faint">Body</p>
            <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[0.75rem] leading-relaxed text-ink-soft">{payload.body}</pre>
            <p className="mt-2 text-[0.68rem] uppercase tracking-[0.08em] text-faint">Attachments</p>
            <p className="text-[0.72rem] text-faint">None</p>
          </div>
        )}

        {approval.type === "send_whatsapp" && (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-black/25 p-2.5">
            <p className="text-[0.68rem] uppercase tracking-[0.08em] text-faint">To</p>
            <p className="text-[0.76rem] text-ink-soft">{payload.to}</p>
            <p className="mt-2 text-[0.68rem] uppercase tracking-[0.08em] text-faint">Message</p>
            <pre className="mt-0.5 whitespace-pre-wrap font-sans text-[0.75rem] leading-relaxed text-ink-soft">{payload.body}</pre>
          </div>
        )}

        {(approval.type === "book_appointment" || approval.type === "cancel_appointment") && (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-black/25 p-2.5 text-[0.75rem] text-ink-soft">
            <p>
              <span className="text-faint">When:</span> {payload.start ? formatDateTime(payload.start) : "—"}
            </p>
            <p className="mt-1">
              <span className="text-faint">Attendee:</span> {payload.name ?? "—"} {payload.email ? `· ${payload.email}` : ""}
            </p>
          </div>
        )}

        {(approval.type === "deploy_website" || approval.type === "delete_data" || approval.type === "purchase" || approval.type === "external_api_change") && (
          <pre className="max-h-40 overflow-auto rounded-lg border border-[color:var(--color-line)] bg-black/25 px-2.5 py-2 text-[0.68rem] text-[#a9b3c6]">
            {JSON.stringify(payload, null, 2)}
          </pre>
        )}

        {result ? (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[0.72rem]",
              result.executed ? "border-[rgba(61,220,154,0.3)] bg-[rgba(61,220,154,0.08)] text-[#8af0c4]" : "border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.08)] text-[#ffb1b1]",
            )}
          >
            {result.executed ? <CheckCircle2 size={13} className="mt-0.5" /> : <AlertTriangle size={13} className="mt-0.5" />}
            <div>
              <p>{result.executed ? "Executed successfully." : result.error ?? "Not executed."}</p>
              {result.hint ? <p className="mt-1 opacity-80">{result.hint}</p> : null}
              {result.result ? <pre className="mt-1 whitespace-pre-wrap text-[0.66rem] opacity-80">{JSON.stringify(result.result, null, 2)}</pre> : null}
            </div>
          </div>
        ) : null}
      </div>

      {pending ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line)] px-3 py-2.5">
          <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void decide("approve")}>
            {busy === "approve" ? <Spinner /> : <Send size={12} />} Approve
          </button>
          <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => void decide("reject")}>
            {busy === "reject" ? <Spinner /> : <XCircle size={12} />} Reject
          </button>
          <button className="btn btn-sm" disabled={busy !== null} onClick={() => setEditing(true)}>
            <Pencil size={12} /> Edit
          </button>
          <span className="ml-auto text-[0.66rem] text-faint">Requested {formatDateTime(approval.createdAt)}</span>
        </div>
      ) : null}

      <EditApprovalModal
        open={editing}
        approval={approval}
        onClose={() => setEditing(false)}
        onSaved={(updated) => {
          setApproval(updated);
          setEditing(false);
          pushToast({ tone: "success", title: "Approval updated" });
        }}
      />
    </div>
  );
}

function EditApprovalModal({
  open,
  approval,
  onClose,
  onSaved,
}: {
  open: boolean;
  approval: Approval;
  onClose: () => void;
  onSaved: (approval: Approval) => void;
}) {
  const { api, pushToast } = useApp();
  const [payload, setPayload] = useState<Record<string, unknown>>(approval.payload);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setPayload(approval.payload);
  }, [open, approval.payload]);

  const editableKeys = Array.from(
    new Set(["to", "subject", "body", "start", "name", "email", "notes", "reason"].filter((key) => key in (approval.payload as Record<string, unknown>) || ["to", "subject", "body"].includes(key))),
  ).filter((key) => key !== "outboundMessageId");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit before approving"
      description="Changes are saved to the pending approval. Approval is still required before anything is sent or booked."
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const data = await api<{ approval: Approval }>(`/api/approvals/${approval.id}`, { method: "PATCH", json: { payload } });
                onSaved(data.approval);
              } catch (error) {
                pushToast({ tone: "error", title: "Could not save changes", description: error instanceof Error ? error.message : "Unknown error" });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : null} Save changes
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {editableKeys.map((key) => (
          <Field key={key} label={key}>
            {key === "body" || key === "notes" || key === "reason" ? (
              <textarea className="textarea" rows={6} value={String(payload[key] ?? "")} onChange={(event) => setPayload({ ...payload, [key]: event.target.value })} />
            ) : (
              <input className="input" value={String(payload[key] ?? "")} onChange={(event) => setPayload({ ...payload, [key]: event.target.value })} />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}
