// Public complaints about SideShift (sideshift.app), coded by theme.
// Source: the 14 reviews on ca.trustpilot.com/review/sideshift.app as read on Oct 14, 2026
// (profile unclaimed, all one-star, small sample). Quotes are shortened.
// Each theme maps to the ticket intent the agent handles today and the product change that removes the ticket.

export const REVIEWS = [
  { date: "2026-10-08", theme: "money", quote: "this app eat your money" },
  { date: "2026-09-08", theme: "deletion", quote: "they keep your card on file and charge it even after you delete your account", alsoTheme: "money" },
  { date: "2026-08-25", theme: "pricing", quote: "300 USD per month for the company" },
  { date: "2026-06-22", theme: "money", quote: "charges you 5% to send money into their wallet" },
  { date: "2026-05-25", theme: "money", quote: "does not allow me to withdraw or receive my funds" },
  { date: "2026-05-04", theme: "reliability", quote: "a service that is repeatedly turned on and off" },
  { date: "2026-05-24", theme: "support", quote: "zero support or guidance for beginners" },
  { date: "2026-05-09", theme: "support", quote: "inexperienced, incompetent employees" },
  { date: "2026-04-06", theme: "eligibility", quote: "Moroccan numbers are not supported" },
  { date: "2026-02-26", theme: "pricing", quote: "Super expensive, $200 a month" },
  { date: "2026-01-05", theme: "deletion", quote: "can't delete account, or disconnect my tiktok" },
  { date: "2025-12-26", theme: "deletion", quote: "no option to delete your account" },
  { date: "2025-11-11", theme: "support", quote: "no response from the help section or customer service" },
  { date: "2025-09-21", theme: "support", quote: "no public support email" },
];

export const THEMES = {
  support: {
    label: "No answer from support",
    intents: ["every intent"],
    fix: "Answer fast. The agent resolves routine tickets on its own, and every ticket it routes arrives at a person already diagnosed. Publish a support address that accepts replies.",
  },
  money: {
    label: "Money in or out (withdrawals, deposit fee, charges)",
    intents: ["withdrawal_blocked", "withdrawal_delayed", "wallet_fee", "billing_charge"],
    fix: "Show status, arrival date and trace code on every withdrawal; show the fee and net credit before a brand funds; explain pending vs available per item.",
  },
  deletion: {
    label: "Can't delete account or disconnect social",
    intents: ["account_deletion", "billing_charge"],
    fix: "Self-serve Delete account and Disconnect social in Settings, cancelling the subscription and detaching the card in the same step.",
  },
  pricing: {
    label: "Price objections",
    intents: [],
    fix: "Not a support ticket. Route to sales with the plan and usage so the V3 pay-for-results pitch reaches them.",
  },
  reliability: {
    label: "Service switching on and off",
    intents: [],
    fix: "Status page plus proactive Intercom messages to affected accounts during incidents.",
  },
  eligibility: {
    label: "Unsupported country or phone number",
    intents: [],
    fix: "State supported countries on sign-up before asking for a phone number.",
  },
};

export function themeCounts() {
  const counts = {};
  for (const r of REVIEWS) {
    counts[r.theme] = (counts[r.theme] || 0) + 1;
    if (r.alsoTheme) counts[r.alsoTheme] = (counts[r.alsoTheme] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
