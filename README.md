# TicketZero

A support-agent kit for SideShift. It takes a customer ticket, runs the account checks a support engineer would run, decides whether an AI agent can answer alone, and drafts the reply. Every ticket it can't handle goes to a person and comes back as a new rule, reply and test.

**Live demo:** https://keshvi-pipwala.github.io/ticketzero/

Built from SideShift's public API docs, Terms of Service and public reviews. Independent project with no access to SideShift systems; account data and tickets are simulated.

## What's inside

| Part | What it does |
|---|---|
| `src/agent.js` | Classifies a ticket into 13 types, diagnoses it from account state, applies guardrails, and drafts the customer reply and internal note. |
| `src/webhooks.js` | Verifies `X-Sideshift-Signature` the way SideShift signs it, and when it fails, re-signs with each common mistake to name the bug. Triages `GET /api/embed/webhook-logs` and writes replay commands. |
| `src/llm.js` | Optional second classifier on the Anthropic API. If the model and the rules disagree, the ticket goes to a person: two keys to auto-answer. |
| `src/errors.js` | Every documented Connect error code, keyed by code and HTTP status (TRANSFER_FAILED alone has four meanings). |
| `skills/` | Seven runbooks written in Sidekick's custom-skill format (name, title, a description under 400 characters that says when not to use it, instructions under 24 KB), using SideShift MCP tool names. |
| `sql/support_queries.sql` | Seven proactive queries that find tickets before customers file them: withdrawals past their arrival date, work past the review window with no payout, deleted accounts still billed, and brands in the 30-day guarantee window running behind on conversions. |
| `evals/` | 104 labeled tickets, the scorer, and the saved results of three blind rounds. |
| `demo/` | The single-page demo: ticket desk, webhook debugger, evals and complaint-to-fix report. |

## Guardrails

The agent never moves money, refunds, lifts a hold or deletes data. That mirrors how SideShift's own MCP server flags money-moving tools as sensitive. These root causes always go to a person, and the test suite fails if any of them is ever auto-answered:

`eligible_withdrawal`, `payout_reversed`, `guarantee_claim`, `charged_after_deletion`, `charged_after_cancel`, `rejected_outside_window`, `risk_hold`, `denied_risk`, `no_self_serve_deletion`

Three more rules:
- Classifier confidence under 0.6 goes to a person.
- A ticket matched only on vocabulary (no strong pattern) gets a suggested queue for the person who takes it, and is never auto-answered.
- With the LLM classifier on, a disagreement between the model and the rules always goes to a person.

Why rules first: the rules are cheap, deterministic and testable, so they make a good safety floor and a fixed yardstick. The classifier is swappable (Intercom Fin, Sidekick or a direct model call); the diagnosis, the guardrails and the eval suite stay the same.

## How it's measured

Each round, I froze the rules, wrote a new batch of tickets, and scored it as-is. Then every miss became knowledge for the next version.

| Version | Blind round | Tickets | Right ticket type | Auto-answers correct | Unsafe auto-answers |
|---|---|---|---|---|---|
| v1.0 | Round 1 | 24 | 62.5% | 100% | 0 |
| v1.1 | Round 2 | 16 | 62.5% | 100% | 0 |
| v1.2 | Round 3 | 16 | 75.0% | 100% | 0 |

Saved results and misses are in `evals/history/`. The point of the table is the last two columns: when the agent didn't recognize a ticket, it handed it to a person instead of guessing. Current version on all 104 tickets: 100% correct ticket type, 52 answered by the agent alone, 100% of those correct, 0 unsafe.

The tickets are synthetic. Their wording is modeled on public SideShift reviews (Trustpilot, App Store) and on the ticket types in SideShift's own CX job post: onboarding, payments, creator disputes, campaign setup, bugs and platform workflows.

## Run it

```bash
npm test          # 30 tests: guardrails, timing rules, signatures, skill format, LLM adapter
npm run eval      # scores every ticket set and prints misses
npm install && npm run build   # bundles the demo into index.html (GitHub Pages)
ANTHROPIC_API_KEY=... npm run eval:llm   # rules + LLM, two keys to auto-answer
```

No runtime dependencies. Node 20+ (uses WebCrypto, so the same code runs in the browser demo).

## Sources

- SideShift API docs: Connect errors, webhooks, testing guide, authentication, MCP capability reference, Sidekick skills (docs.sideshift.app)
- SideShift Terms of Service: B4–B9, C5, C8–C10, 14, 16 (sideshift.app/terms-of-service)
- Public reviews: Trustpilot (sideshift.app), App Store
- SideShift V3 launch post (30-day conversion guarantee)

Keshvi Pipwala · keshvipipwalan@gmail.com
