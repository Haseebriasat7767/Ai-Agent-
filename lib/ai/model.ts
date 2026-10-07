import { gateway } from "@ai-sdk/gateway";

export const DEFAULT_MODEL = "openai/gpt-5.6-sol";
export const DEFAULT_FAST_MODEL = "openai/gpt-5.6-mini";

export function modelId(): string {
  return (process.env.AI_MODEL || "").trim() || DEFAULT_MODEL;
}

export function fastModelId(): string {
  return (process.env.AI_MODEL_FAST || "").trim() || DEFAULT_FAST_MODEL;
}

/**
 * The assistant is only "online" when a model can actually be reached.
 * On Vercel the AI Gateway is authenticated automatically through OIDC.
 */
export function aiConfigured(): boolean {
  if ((process.env.AI_GATEWAY_API_KEY || "").trim().length > 0) return true;
  if ((process.env.VERCEL_OIDC_TOKEN || "").trim().length > 0) return true;
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
}

export function aiStatus(): { online: boolean; model: string; reason: string } {
  if (aiConfigured()) {
    return { online: true, model: modelId(), reason: "Vercel AI Gateway reachable." };
  }
  return {
    online: false,
    model: modelId(),
    reason:
      "AI_GATEWAY_API_KEY is not set. The orchestrator cannot run until the key is configured — " +
      "the interface stays functional (leads, files, tasks, audits) but no responses are generated.",
  };
}

export function getModel(id?: string) {
  return gateway(id && id.trim() ? id.trim() : modelId());
}

export function getFastModel() {
  return gateway(fastModelId());
}
