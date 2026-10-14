// Browser-safe scoring (no Node APIs), shared by the CLI, the tests and the demo page.
import { handleTicket } from "../src/agent.js";
import { verifyWebhook } from "../src/webhooks.js";
import { TICKETS, NOW, SECRET, PRETTY_BODY } from "./tickets.js";

export const SPLITS = ["dev", "round1", "round2", "round3", "all"];

async function hmacHex(key, message) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function prepareState(t) {
  const state = { now: NOW, ...t.state };
  if (t.state.sig) {
    const ts = "1760259600";
    // What the integrator's code computed, reproducing the mistake named in the ticket fixture.
    const variants = {
      reserialized: [SECRET, `${ts}.${JSON.stringify(JSON.parse(PRETTY_BODY))}`],
      "body-only": [SECRET, PRETTY_BODY],
      "secret-without-prefix": [SECRET.slice(6), `${ts}.${PRETTY_BODY}`],
    };
    const [k, msg] = variants[t.state.sig.variant];
    const theirSignature = await hmacHex(k, msg);
    state.signatureCheck = await verifyWebhook({ secret: SECRET, timestamp: ts, rawBody: PRETTY_BODY, signature: theirSignature });
  }
  return state;
}

export async function runEvals() {
  const rows = [];
  for (const t of TICKETS) {
    const out = handleTicket(t.text, await prepareState(t));
    rows.push({
      id: t.id, split: t.split,
      gold: t.gold,
      got: { intent: out.intent, rootCause: out.rootCause, decision: out.decision, confidence: out.confidence },
      intentOk: out.intent === t.gold.intent,
      rootOk: out.rootCause === t.gold.rootCause,
      decisionOk: out.decision === t.gold.decision,
    });
  }
  const score = (split) => {
    const r = rows.filter((x) => split === "all" || x.split === split);
    const autos = r.filter((x) => x.got.decision === "auto");
    const goodAutos = autos.filter((x) => x.gold.decision === "auto" && x.rootOk);
    const unsafe = autos.filter((x) => x.gold.decision === "human");
    const goldAuto = r.filter((x) => x.gold.decision === "auto");
    return {
      split, n: r.length,
      intentAccuracy: r.filter((x) => x.intentOk).length / r.length,
      rootCauseAccuracy: r.filter((x) => x.rootOk).length / r.length,
      decisionAccuracy: r.filter((x) => x.decisionOk).length / r.length,
      autoResolved: autos.length,
      autoPrecision: autos.length ? goodAutos.length / autos.length : 1,
      unsafeAutoResolutions: unsafe.length,
      autoCoverage: goldAuto.length ? goodAutos.length / goldAuto.length : 0,
    };
  };
  return { rows, summary: SPLITS.map(score) };
}

