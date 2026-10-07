"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { Field, Spinner } from "@/components/ui/primitives";

export function LoginForm({ setupRequired }: { setupRequired: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "setup">(setupRequired ? "setup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (mode === "setup" && password !== confirm) {
      setError({ message: "The two passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, email, password, name: name || undefined }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; hint?: string };
      if (!response.ok) {
        setError({ message: payload.error || `Sign-in failed (${response.status})`, hint: payload.hint });
        return;
      }
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="chip chip-accent">
          {mode === "setup" ? <ShieldCheck size={11} /> : <KeyRound size={11} />}
          {mode === "setup" ? "First-run setup" : "Private sign-in"}
        </span>
        {!setupRequired && mode === "login" ? <span className="chip">Single-owner system</span> : null}
      </div>

      {mode === "setup" ? (
        <p className="rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2.5 text-[0.72rem] leading-relaxed text-muted">
          This deployment has no account yet. Create the owner account now — after this, no further accounts can be created from the interface
          (only <span className="font-mono text-ink-soft">OWNER_EMAIL</span> /{" "}
          <span className="font-mono text-ink-soft">ALLOWED_EMAILS</span> in the environment can add one).
        </p>
      ) : null}

      {mode === "setup" ? (
        <Field label="Your name">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Haseeb" autoComplete="name" required />
        </Field>
      ) : null}

      <Field label="Email">
        <div className="relative">
          <UserRound size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="input pl-8"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            required
          />
        </div>
      </Field>

      <Field label="Password" hint={mode === "setup" ? "At least 10 characters. Store it in your password manager." : undefined}>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
          required
        />
      </Field>

      {mode === "setup" ? (
        <Field label="Confirm password">
          <input className="input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
        </Field>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.1)] px-3 py-2.5">
          <p className="text-[0.75rem] text-[#ffb1b1]">{error.message}</p>
          {error.hint ? <p className="mt-1 text-[0.68rem] leading-relaxed text-[#ffb1b1]/80">{error.hint}</p> : null}
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? <Spinner /> : null}
        {mode === "setup" ? "Create owner account & enter" : "Sign in"}
      </button>

      {setupRequired ? (
        <button type="button" className="btn btn-ghost w-full justify-center text-[0.72rem]" onClick={() => setMode(mode === "setup" ? "login" : "setup")}>
          {mode === "setup" ? "Already have an account? Sign in" : "Deployment is empty — run first-run setup"}
        </button>
      ) : null}
    </form>
  );
}
