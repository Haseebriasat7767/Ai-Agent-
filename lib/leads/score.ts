/**
 * Deterministic lead scoring. The AI supplies *evidence*, this module turns the
 * evidence into a 0–100 score with a human-readable breakdown, so the number can
 * always be explained ("why did this lead score 84?").
 */
import { temperatureFromScore, type Temperature } from "@/lib/utils";

export interface ScoreSignals {
  /** 0–100 quality of the current website (lower = bigger opportunity). */
  websiteQualityScore?: number | null;
  hasWebsite?: boolean | null;
  websiteIsLegacy?: boolean;
  mobileIssues?: boolean;
  noStructuredData?: boolean;
  noBookingLink?: boolean;
  noWhatsApp?: boolean;
  noChatWidget?: boolean;
  hasContactEmail?: boolean;
  hasPhone?: boolean;
  hasLinkedin?: boolean;
  hasNamedContact?: boolean;
  companySize?: string | null;
  industry?: string | null;
  location?: string | null;
  /** Signals that the business is a good fit for the offer (AI/web/AI-automation). */
  industryFit?: "high" | "medium" | "low" | null;
  recentActivity?: boolean;
  multipleLocations?: boolean;
  evidenceCount?: number;
  statedPainPoints?: string[];
}

export interface ScoreBreakdownEntry {
  label: string;
  points: number;
  max: number;
  note?: string;
}

export interface LeadScoreResult {
  score: number;
  temperature: Temperature;
  breakdown: ScoreBreakdownEntry[];
  explanation: string;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function scoreLead(signals: ScoreSignals): LeadScoreResult {
  const breakdown: ScoreBreakdownEntry[] = [];
  const push = (label: string, points: number, max: number, note?: string) =>
    breakdown.push({ label, points: Math.round(points), max, note });

  // 1. Website gap (max 30) — the single strongest signal for web/AI work.
  if (signals.hasWebsite === false) {
    push("No website found", 30, 30, "Highest-intent web opportunity: nothing to lose by rebuilding");
  } else if (typeof signals.websiteQualityScore === "number") {
    const gap = clamp((80 - signals.websiteQualityScore) / 80, 0, 1);
    push(
      "Website quality gap",
      gap * 30,
      30,
      `Measured site quality ${signals.websiteQualityScore}/100 — lower scores mean a bigger rebuild case`,
    );
  } else {
    push("Website quality gap", 10, 30, "No audit evidence yet — default midline applied");
  }

  // 2. Concrete technical problems (max 20)
  let techPoints = 0;
  const techNotes: string[] = [];
  if (signals.websiteIsLegacy) {
    techPoints += 7;
    techNotes.push("legacy/table-based markup");
  }
  if (signals.mobileIssues) {
    techPoints += 6;
    techNotes.push("mobile viewport or layout issues");
  }
  if (signals.noStructuredData) {
    techPoints += 3;
    techNotes.push("no structured data");
  }
  if (signals.noBookingLink) {
    techPoints += 2;
    techNotes.push("no self-service booking");
  }
  if (signals.noChatWidget && signals.noWhatsApp) {
    techPoints += 2;
    techNotes.push("no live chat or WhatsApp contact");
  }
  push("Technical problems found", clamp(techPoints, 0, 20), 20, techNotes.join(", ") || undefined);

  // 3. Reachability (max 20) — we must be able to contact them honestly.
  let reach = 0;
  const reachNotes: string[] = [];
  if (signals.hasContactEmail) {
    reach += 10;
    reachNotes.push("public contact email");
  }
  if (signals.hasPhone) {
    reach += 4;
    reachNotes.push("phone published");
  }
  if (signals.hasNamedContact) {
    reach += 3;
    reachNotes.push("named decision maker");
  }
  if (signals.hasLinkedin) {
    reach += 3;
    reachNotes.push("LinkedIn presence");
  }
  push("Contactability", clamp(reach, 0, 20), 20, reachNotes.join(", ") || undefined);

  // 4. Fit with Haseeb's offer (max 20)
  const fitPoints = signals.industryFit === "high" ? 20 : signals.industryFit === "medium" ? 12 : signals.industryFit === "low" ? 5 : 8;
  push(
    "Offer fit",
    fitPoints,
    20,
    signals.industry
      ? `${signals.industry}${signals.industryFit ? ` (${signals.industryFit} fit)` : ""}`
      : "Industry not classified yet",
  );

  // 5. Commercial signals (max 10)
  let commercial = 0;
  const commercialNotes: string[] = [];
  const size = (signals.companySize || "").toLowerCase();
  if (/small|1-10|2-10|sole|solo/.test(size)) {
    commercial += 4;
    commercialNotes.push("small team → fast decisions");
  } else if (/medium|11-50|51-200/.test(size)) {
    commercial += 6;
    commercialNotes.push("SMB with budget");
  } else if (/large|201|500|1000/.test(size)) {
    commercial += 3;
    commercialNotes.push("large org → longer sales cycle");
  }
  if (signals.multipleLocations) {
    commercial += 2;
    commercialNotes.push("multiple locations");
  }
  if (signals.recentActivity) {
    commercial += 2;
    commercialNotes.push("recently active online");
  }
  if ((signals.statedPainPoints?.length ?? 0) > 0) {
    commercial += 2;
    commercialNotes.push("stated pain points captured");
  }
  push("Commercial signals", clamp(commercial, 0, 10), 10, commercialNotes.join(", ") || undefined);

  const rawTotal = breakdown.reduce((sum, entry) => sum + entry.points, 0);
  const evidencePenalty = (signals.evidenceCount ?? 0) === 0 ? 15 : 0;
  const score = clamp(Math.round(rawTotal - evidencePenalty), 0, 100);

  const strongest = [...breakdown].sort((a, b) => b.points / b.max - a.points / a.max)[0];
  const weakest = [...breakdown].sort((a, b) => a.points / a.max - b.points / b.max)[0];
  const explanation = [
    `Score ${score}/100 based on measured evidence only (${breakdown.length} weighted factors).`,
    evidencePenalty ? `−${evidencePenalty} applied because no website evidence was collected yet.` : "",
    strongest ? `Strongest factor: ${strongest.label} (${strongest.points}/${strongest.max}).` : "",
    weakest && weakest.points / weakest.max < 0.4 ? `Weakest factor: ${weakest.label} (${weakest.points}/${weakest.max}).` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    score,
    temperature: temperatureFromScore(score),
    breakdown,
    explanation,
  };
}
