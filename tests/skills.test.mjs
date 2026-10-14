import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Sidekick custom-skill limits, from docs.sideshift.app/sidekick/skills.
const RESERVED = ["boost-post", "create-campaign", "find-creators", "fund-wallet", "grill-my-brief", "hire-creator", "invoice-client", "message-creators", "performance-report", "post-job", "quickpay", "resolve-dispute", "review-applicants", "review-content", "run-payouts", "write-brief"];
const dir = new URL("../skills/", import.meta.url);

for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
  test(`skill ${f} fits Sidekick's custom-skill format`, () => {
    const src = readFileSync(new URL(f, dir), "utf8");
    const m = src.match(/^---\nname: (.+)\ntitle: (.+)\ndescription: (.+)\n---\n([\s\S]+)$/);
    assert.ok(m, "header must be name/title/description");
    const [, name, title, description, body] = m;
    assert.match(name, /^[a-z0-9][a-z0-9-]{1,63}$/);
    assert.ok(!RESERVED.includes(name), "name collides with a built-in skill");
    assert.ok(title.length >= 1 && title.length <= 120);
    assert.ok(description.length >= 1 && description.length <= 400, `description is ${description.length} chars`);
    assert.match(description, /Do not use/, "description should say when not to use it");
    assert.ok(Buffer.byteLength(body) <= 24 * 1024, "instructions over 24 KB");
  });
}
