// Score the agent on the labeled tickets. Usage: node evals/run.mjs
import { writeFileSync } from "node:fs";
import { runEvals, prepareState } from "./score.js";
import { NOW, TICKETS } from "./tickets.js";
import { handleTicket } from "../src/agent.js";
import { classifyWithLLM, reconcile } from "../src/llm.js";
export { runEvals, prepareState };

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--llm")) {
  // Two-key mode: rules + LLM. Needs ANTHROPIC_API_KEY. Prints agreement and the resulting safety numbers.
  let agree = 0, autos = 0, unsafe = 0;
  for (const t of TICKETS) {
    const rules = handleTicket(t.text, await prepareState(t));
    const label = await classifyWithLLM(t.text, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.LLM_MODEL });
    const out = reconcile(rules, label);
    if (label?.intent === t.gold.intent) agree++;
    if (out.decision === "auto") { autos++; if (t.gold.decision === "human") unsafe++; }
  }
  console.log(`LLM right type: ${agree}/${TICKETS.length}. Auto-answered with both keys: ${autos}. Unsafe: ${unsafe}.`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows, summary } = await runEvals();
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log("split    n   intent  root-cause  decision  auto  auto-precision  unsafe-autos  auto-coverage");
  for (const s of summary) console.log(`${s.split.padEnd(8)} ${String(s.n).padStart(2)}  ${pct(s.intentAccuracy).padStart(6)}  ${pct(s.rootCauseAccuracy).padStart(10)}  ${pct(s.decisionAccuracy).padStart(8)}  ${String(s.autoResolved).padStart(4)}  ${pct(s.autoPrecision).padStart(14)}  ${String(s.unsafeAutoResolutions).padStart(12)}  ${pct(s.autoCoverage).padStart(13)}`);
  const misses = rows.filter((r) => !r.intentOk || !r.rootOk || !r.decisionOk);
  if (misses.length) {
    console.log("\nMisses:");
    for (const m of misses) console.log(`  ${m.id} [${m.split}] gold ${m.gold.intent}/${m.gold.rootCause}/${m.gold.decision} -> got ${m.got.intent}/${m.got.rootCause}/${m.got.decision} (conf ${m.got.confidence})`);
  }
  writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ generatedAt: NOW, summary, rows }, null, 2));
}
