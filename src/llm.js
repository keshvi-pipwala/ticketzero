// Optional second classifier backed by an LLM (Anthropic Messages API).
// The rules engine stays the safety layer: an LLM label can only ADD caution.
// When the rules and the model disagree, the ticket goes to a person.

import { INTENTS, INTENT_IDS } from "./intents.js";

export const DEFAULT_MODEL = "claude-haiku-5-5";

export function buildPrompt(ticketText) {
  const catalog = INTENT_IDS.map((id) => `- ${id}: ${INTENTS[id].label} (${INTENTS[id].side})`).join("\n");
  return `You triage support tickets for SideShift, a marketplace where brands hire and pay UGC creators.
Pick the single best ticket type, or "other" if none fits.

Ticket types:
${catalog}
- other: anything else (feature requests, app crashes, general questions)

Ticket:
"""${ticketText}"""

Reply with JSON only: {"intent": "<type>", "confidence": <0..1>, "reason": "<one short sentence>"}`;
}

export function parseLabel(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const intent = INTENT_IDS.includes(j.intent) || j.intent === "other" ? j.intent : null;
    if (!intent) return null;
    const confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0));
    return { intent, confidence, reason: String(j.reason || "") };
  } catch {
    return null;
  }
}

/** Ask the model for a label. `fetchImpl` is injectable for tests. */
export async function classifyWithLLM(ticketText, { apiKey, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY to use the LLM classifier.");
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: "user", content: buildPrompt(ticketText) }] }),
  });
  if (!res.ok) throw new Error(`LLM request failed: HTTP ${res.status}`);
  const body = await res.json();
  return parseLabel(body?.content?.[0]?.text);
}

/**
 * Combine the rules label with the model label.
 * Agree -> keep the rules result. Disagree, or no model label -> force a person, record both.
 */
export function reconcile(rulesOut, llmLabel) {
  if (!llmLabel) return { ...rulesOut, secondOpinion: null };
  if (llmLabel.intent === rulesOut.intent) return { ...rulesOut, secondOpinion: { ...llmLabel, agrees: true } };
  return {
    ...rulesOut,
    decision: "human",
    queue: rulesOut.queue || "support",
    guardrail: [...(rulesOut.guardrail || []), `rules said ${rulesOut.intent}, model said ${llmLabel.intent}`],
    secondOpinion: { ...llmLabel, agrees: false },
  };
}
