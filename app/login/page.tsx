import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { countUsers } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/LoginForm";
import { dbHealth } from "@/lib/db";
import { aiStatus } from "@/lib/ai/model";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const auth = await getAuth();
  if (auth) redirect("/");

  const [users, health] = await Promise.all([countUsers().catch(() => 0), dbHealth()]);
  const ai = aiStatus();

  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-[0.5]" />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#7d97ff] to-[#a78bfa] text-base font-bold text-[#080b14]">H</span>
          <div>
            <h1 className="text-[1.05rem] font-semibold tracking-tight text-ink">Haseeb AI</h1>
            <p className="text-xs text-muted">Your private AI operator. Research. Build. Execute.</p>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <LoginForm setupRequired={users === 0} />
        </div>

        <div className="mt-4 space-y-1.5 text-[0.68rem] leading-relaxed text-faint">
          <p>Single-owner system · no public signup · every session is audited.</p>
          <p>
            Database: {health.ok ? health.label : <span className="text-[color:var(--color-danger)]">unavailable — {health.error}</span>}
          </p>
          <p>
            AI orchestrator: {ai.online ? ai.model : <span className="text-[color:var(--color-warn)]">not configured (set AI_GATEWAY_API_KEY)</span>}
          </p>
          {!health.ok ? <p className="text-[color:var(--color-danger)]">{health.hint}</p> : null}
        </div>
      </div>
    </div>
  );
}
