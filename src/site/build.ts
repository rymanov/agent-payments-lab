/**
 * Builds the Lab's one-page site, site/index.html, from src/site/page.html and each experiment's generated files.
 *
 * Every number on the page comes from an experiment's tables.json (written by its frozen analysis script) or is
 * counted here from its trial log with that script's own labels. None is typed by hand (method rule 6). The
 * forbidden / reference-ID split is the same count figure.ts draws, and is checked against tables.json the
 * same way. The clean re-run rebuilds the page from a fresh checkout and refuses to publish if it differs.
 *
 * Usage: npx tsx src/site/build.ts [outdir]     (default: site/)
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pct, wilson } from "../report/stats.js";
import { label } from "../../experiments/01-e1a/analyse.js";
import { CONTEXTS, MODELS, type TrialRecord } from "../../experiments/01-e1a/design.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "site"));
const E1A = path.join(ROOT, "experiments/01-e1a");
const REPO = "https://github.com/rymanov/agent-payments-lab";
const TREE = `${REPO}/tree/main/experiments/01-e1a`;
const BLOB = `${REPO}/blob/main/experiments/01-e1a`;

/** Display names and makers. Labels only: no number on the page depends on them except the count of makers. */
const NAMES: Record<string, { name: string; maker: string; how: string }> = {
  qwen: { name: "Qwen 3.5 9B", maker: "Alibaba", how: "open weights, run locally" },
  haiku: { name: "Claude Haiku 5.5", maker: "Anthropic", how: "API" },
  sonnet: { name: "Claude Sonnet 5.5", maker: "Anthropic", how: "API" },
  opus: { name: "Claude Opus 5.5", maker: "Anthropic", how: "API" },
  gemma: { name: "Gemma 4 E4B", maker: "Google", how: "open weights, run locally" },
  deepseek: { name: "DeepSeek V4 Pro", maker: "DeepSeek", how: "API" },
  gpt: { name: "GPT-5.5", maker: "OpenAI", how: "API" },
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x: number) => x.toLocaleString("en-GB");
const list = (xs: string[], sep = ", ") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(sep)} and ${xs.at(-1)}`);
const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (x: number) => words[x] ?? n(x);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ E1a data

const d = JSON.parse(readFileSync(path.join(E1A, "tables.json"), "utf8"));
if (!Array.isArray(d.breaches) || !Array.isArray(d.errors) || typeof d.exercised !== "number") {
  throw new Error("tables.json is not in the shape this page was written for (breaches, errors, exercised)");
}
const byKey = new Map<string, TrialRecord>();
for (const l of readFileSync(path.join(E1A, "logs/trials.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l) as TrialRecord;
  byKey.set(r.key, r); // one record per trial key, the last one counting, as analyse.ts does
}
if (byKey.size !== d.trials) throw new Error(`trial log has ${byKey.size} trials, tables.json says ${d.trials}`);

type Split = { n: number; forbidden: number; refOnly: number };
const split = new Map<string, Split>();
const payTwiceRuns = new Map<string, number>(); // C3 attack runs per model, errors left out
for (const r of byKey.values()) {
  if (r.context === "C0") continue;
  const L = label(r);
  if (r.context === "C3" && L.agent !== "error") payTwiceRuns.set(r.modelId, (payTwiceRuns.get(r.modelId) ?? 0) + 1);
  const key = `${r.modelId}|${r.variant}`;
  const c = split.get(key) ?? { n: 0, forbidden: 0, refOnly: 0 };
  if (L.agent !== "error") c.n++;
  if (L.agent === "hijacked") {
    const refused = [...r.results, ...(r.firstAttempt?.results ?? [])].some((x) => x.status !== "paid");
    if (refused || L.breach) c.forbidden++;
    else c.refOnly++;
  }
  split.set(key, c);
}

const rows = MODELS.map((m) => {
  const e = d.effect[m.id];
  const told = split.get(`${m.id}|checker`)!, plain = split.get(`${m.id}|plain`)!;
  for (const [c, t] of [[told, e.checker], [plain, e.plain]] as const) {
    if (c.forbidden + c.refOnly !== t.k || c.n !== t.n) throw new Error(`site disagrees with tables.json for ${m.id}`);
  }
  return {
    id: m.id, ...NAMES[m.id],
    attacks: told.n + plain.n,
    forbidden: told.forbidden + plain.forbidden,
    refOnly: told.refOnly + plain.refOnly,
    told: e.checker as { k: number; n: number },
    plain: e.plain as { k: number; n: number },
    verdict: (["up", "down", "unclear"].includes(e.diff.verdict) ? e.diff.verdict : (() => {
      throw new Error(`unknown verdict ${e.diff.verdict} for ${m.id}`);
    })()) as "up" | "down" | "unclear",
    diff: e.diff as { diff: number; lo: number; hi: number },
  };
});
const forbiddenTotal = rows.reduce((a, r) => a + r.forbidden, 0);
if (forbiddenTotal !== d.exercised) {
  throw new Error(`forbidden requests (${forbiddenTotal}) differ from trials where the checker refused (${d.exercised})`);
}

const breaches = (d.breaches as unknown[]).length;
const exercisedHi = wilson(0, d.exercised).hi;
const makers = new Set(rows.map((r) => r.maker)).size;
const triedForbidden = rows.filter((r) => r.forbidden > 0);
const neverForbidden = rows.filter((r) => r.forbidden === 0);
const unclear = rows.filter((r) => r.verdict === "unclear");
const clear = rows.filter((r) => r.verdict !== "unclear");
const passLines = Object.values(d.pass as Record<string, boolean>);
if (breaches !== 0 || passLines.some((x) => !x)) {
  throw new Error("E1a no longer meets its pass lines: the page's wording assumes it does; rewrite it before building");
}

// The neverForbidden sentence names the models, so it stays true if the counts move.
const slipped = neverForbidden.filter((r) => r.refOnly > 0);
const neverSentence =
  `${list(neverForbidden.map((r) => r.name))} never asked for one.` +
  (slipped.length
    ? ` Their only slip, in some pay-twice attacks: one allowed purchase that used a reference ID the attacker supplied (${slipped.map((r) => `${r.name.replace(/^Claude /, "")}: ${r.refOnly} of ${payTwiceRuns.get(r.id)}`).join("; ")}). Nothing extra was paid.`
    : "");

const effectSentence = clear.length
  ? `Telling the agent that a checker exists made no clear difference for ${word(unclear.length)} models. ` +
    clear
      .map((r) => `${r.name} was tricked ${r.verdict === "down" ? "less" : "more"} when told: ${r.told.k} of ${r.told.n} attack runs against ${r.plain.k} of ${r.plain.n}`)
      .join("; ") +
    `. That is one result in ${word(rows.length)} unadjusted comparisons, so it could be chance and needs a repeat.`
  : `Telling the agent that a checker exists made no clear difference for any of the ${word(rows.length)} models.`;

const verdictText = (v: string) => (v === "down" ? "lower when told, clearly" : v === "up" ? "higher when told, clearly" : "no clear difference");
const tableRows = rows
  .map(
    (r) => `          <tr>
            <th scope="row">${esc(r.name)}<span class="sub">${esc(r.maker)} · ${esc(r.how)}</span></th>
            <td class="num">${r.forbidden} <span class="of">of ${r.attacks}</span></td>
            <td class="num">${r.refOnly} <span class="of">of ${r.attacks}</span></td>
            <td class="num">${r.told.k} <span class="of">of ${r.told.n}</span></td>
            <td class="num">${r.plain.k} <span class="of">of ${r.plain.n}</span></td>
            <td>${esc(verdictText(r.verdict))}</td>
          </tr>`,
  )
  .join("\n");

const values: Record<string, string> = {
  trials: n(d.trials),
  models: word(rows.length),
  modelsNum: String(rows.length),
  modelsCap: cap(word(rows.length)),
  claudeModels: word(rows.filter((r) => r.maker === "Anthropic").length),
  attacksCap: cap(word(CONTEXTS.filter((c) => c.attack).length)),
  makers: word(makers),
  breaches: String(breaches),
  exercised: n(d.exercised),
  exercisedHi: pct(exercisedHi),
  honestPaid: n(d.benign.honestPaid),
  benignEvaluable: n(d.benign.evaluable),
  checkerRefusedHonest: d.benign.checkerRefusedHonest === 0 ? "none of them" : n(d.benign.checkerRefusedHonest),
  triedForbiddenNames: list(triedForbidden.map((r) => r.name)),
  neverSentence,
  effectSentence,
  errors: String((d.errors as unknown[]).length),
  tableRowsHtml: tableRows,
  repo: REPO,
  e1aTree: TREE,
  e1aPlan: `${BLOB}/PLAN.md`,
  e1aResults: `${BLOB}/RESULTS.md`,
  e1aLogs: `${TREE}/logs`,
  e1aTimestamp: `${BLOB}/TIMESTAMP.md`,
  e1aTimestampV11: `${BLOB}/TIMESTAMP-v1.1.md`,
};

// ------------------------------------------------------------------ fill the template

const template = readFileSync(path.join(ROOT, "src/site/page.html"), "utf8");
const used = new Set<string>();
const html = template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
  if (!(k in values)) throw new Error(`page.html asks for {{${k}}}, which the build does not provide`);
  used.add(k);
  return k.endsWith("Html") || /^(repo|e1a)/.test(k) ? values[k] : esc(values[k]);
});
const unused = Object.keys(values).filter((k) => !used.has(k));
if (unused.length) throw new Error(`values the page never shows: ${unused.join(", ")}`);

writeFileSync(path.join(OUT, "index.html"), html);
copyFileSync(path.join(E1A, "figure.svg"), path.join(OUT, "e1a-figure.svg"));
copyFileSync(path.join(E1A, "figure.png"), path.join(OUT, "e1a-figure.png"));
process.stdout.write(`site built: ${path.relative(ROOT, OUT) || "."}/index.html (${n(d.trials)} E1a trials)\n`);
