/**
 * Deep links into the assistant.
 *
 * Every other workspace hands work to the orchestrator instead of faking it:
 * the link carries a prepared instruction, the assistant receives it as a real
 * user turn and answers with real tools.
 */
export function assistantUrl(prompt: string): string {
  return `/?prompt=${encodeURIComponent(prompt)}`;
}

export function draftOutreachPrompt(lead: { id: string; company: string; contactName?: string | null; email?: string | null }): string {
  const contact = lead.contactName ? ` Contact: ${lead.contactName}.` : "";
  return `Draft a short, personalised outreach email for ${lead.company} (lead id ${lead.id}).${contact} Use the research notes and pain points already saved on that lead. Show me the draft for review only — do not send anything.`;
}

export function analyseFilePrompt(file: { id: string; name: string }): string {
  return `Analyse the uploaded file "${file.name}" (file id ${file.id}). Summarise it, pull out the key facts and any tables, and tell me what I should do with it next.`;
}

export function researchPrompt(topic: string): string {
  return `Research ${topic}. Search the web, open the most relevant sources, and save a structured research note with findings and sources.`;
}

export function buildWebsitePrompt(input: { name: string; goal?: string | null; audience?: string | null; type?: string | null }): string {
  const parts = [`Build a ${input.type || "business"} website for "${input.name}"`];
  if (input.goal) parts.push(`goal: ${input.goal}`);
  if (input.audience) parts.push(`audience: ${input.audience}`);
  return `${parts.join(" — ")}. Create the sitemap, write the copy, generate the code, then run a QA audit and report the score and any issues.`;
}

export function auditWebsitePrompt(url: string): string {
  return `Audit the website ${url}. Run the full QA pass (desktop, mobile, functional, SEO, accessibility, performance), save the audit with a 0-100 score, and list the concrete fixes in priority order.`;
}

export function reportPrompt(type: string, subject: string): string {
  return `Generate a ${type.replace(/_/g, " ")} report about ${subject}. Include an executive summary, findings, data, recommendations and sources, then save it to Reports.`;
}
