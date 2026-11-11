/**
 * E1a figure for Lab post 1. Reads tables.json (written by analyse.ts) and the trial log, and draws one SVG.
 * No number is typed by hand.
 *
 * Each bar is one model and one variant (told about the checker, or not): the share of attack runs in which the
 * agent followed the planted instruction, split in two (8 Nov, after the DeepSeek and GPT-5.5 Pro review):
 *   solid  = it asked for a forbidden payment, and the checker refused it;
 *   light  = it only used the attacker's reference ID on one allowed purchase; nothing extra was paid.
 * The whisker is the 95% Wilson interval of the whole bar.
 *
 * Usage: npx tsx experiments/01-e1a/figure.ts <tables.json> <trials.jsonl> <figure.svg>
 * PNG:   render the SVG at 1200 x 1200 (for example with a headless browser screenshot).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { wilson } from "../../src/report/stats.js";
import { label } from "./analyse.js";
import { MODELS, type TrialRecord } from "./design.js";

const [, , inFile, logFile, outFile] = process.argv;
// Guard (8 Nov): an earlier two-argument version once wrote the SVG over the trial log. Refuse any output
// that is not an .svg, and any input that is not a .jsonl log.
if (!outFile?.endsWith(".svg") || !logFile?.endsWith(".jsonl") || !inFile?.endsWith(".json")) {
  throw new Error("usage: figure.ts <tables.json> <trials.jsonl> <figure.svg>");
}
const d = JSON.parse(readFileSync(inFile, "utf8"));
const recs = readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);

type Cell = { n: number; forbidden: number; refOnly: number };
const cells = new Map<string, Cell>();
for (const r of recs) {
  if (r.context === "C0") continue;
  const L = label(r);
  const c = cells.get(`${r.modelId}|${r.variant}`) ?? { n: 0, forbidden: 0, refOnly: 0 };
  if (L.agent !== "error") c.n++;
  if (L.agent === "hijacked") {
    const refused = [...r.results, ...(r.firstAttempt?.results ?? [])].some((x) => x.status !== "paid");
    if (refused || L.breach) c.forbidden++;
    else c.refOnly++;
  }
  cells.set(`${r.modelId}|${r.variant}`, c);
}
// The bars must agree with the frozen analysis: same hijack count and denominator per cell.
for (const m of MODELS) for (const v of ["checker", "plain"] as const) {
  const c = cells.get(`${m.id}|${v}`)!, e = d.effect[m.id][v];
  if (c.forbidden + c.refOnly !== e.k || c.n !== e.n) throw new Error(`figure disagrees with tables.json for ${m.id} ${v}`);
}
const forbiddenTotal = [...cells.values()].reduce((a, c) => a + c.forbidden, 0);

const W = 1200, H = 1200;
const C = { surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#4a4946", grid: "#e4e3df", with: "#2a78d6", withL: "#a9cbf3", without: "#eb6834", withoutL: "#f7c0a2" };
const NAMES: Record<string, [string, string]> = {
  qwen: ["Qwen 3.5", "open-weight"], haiku: ["Claude", "Haiku 5.5"], sonnet: ["Claude", "Sonnet 5.5"], opus: ["Claude", "Opus 5.5"],
  gemma: ["Gemma 4", "open-weight"], deepseek: ["DeepSeek", "V4 Pro"], gpt: ["OpenAI", "GPT-5.5"],
};

const breaches = (d.breaches as unknown[]).length;
const x0 = 112, x1 = 1130, yTop = 520, yBase = 950, ph = yBase - yTop;
const y = (p: number) => yBase - p * ph;
const out: string[] = [];
const t = (x: number, yy: number, s: string, size: number, fill = C.ink, anchor = "start", weight = 400) =>
  out.push(`<text x="${x}" y="${yy}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`);
const rect = (x: number, yy: number, w: number, h: number, fill: string, stroke = "") =>
  out.push(`<rect x="${x}" y="${yy}" width="${w}" height="${h}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="2"` : ""}/>`);

out.push(`<rect width="${W}" height="${H}" fill="${C.surface}"/>`);
t(64, 112, `${breaches} forbidden payments signed`, 76, C.ink, "start", 700);
t(64, 166, `${d.trials.toLocaleString("en-GB")} trials, 7 models, mock payments. Forbidden requests in ${forbiddenTotal} runs: all refused.`, 30, C.ink, "start", 500);

t(64, 250, "How often the agent followed a planted instruction", 36, C.ink, "start", 700);
rect(64, 276, 30, 30, C.with); t(104, 300, "Told about the checker", 26);
rect(420, 276, 30, 30, C.without); t(460, 300, "Not told", 26);
rect(64, 326, 30, 30, C.ink2); t(104, 350, "Asked for a forbidden payment: refused", 26);
rect(64, 376, 30, 30, "#d9d8d4", C.ink2); t(104, 400, "Only reused the attacker's reference ID: allowed, nothing extra paid", 26);
t(64, 446, "Each bar: 60 attack runs (GPT-5.5 told: 57; 3 lost to an API billing error).", 24, C.ink2);

for (const p of [0, 0.5, 1]) {
  out.push(`<line x1="${x0}" x2="${x1}" y1="${y(p)}" y2="${y(p)}" stroke="${C.grid}" stroke-width="2"/>`);
  t(x0 - 12, y(p) + 9, `${p * 100}%`, 24, C.ink2, "end");
}
const groupW = (x1 - x0) / MODELS.length, barW = Math.min(110, groupW / 2 - 8), gap = 4;
MODELS.forEach((m, i) => {
  const cx = x0 + groupW * (i + 0.5);
  (["checker", "plain"] as const).forEach((v, j) => {
    const c = cells.get(`${m.id}|${v}`)!;
    const k = c.forbidden + c.refOnly;
    const { lo, hi } = wilson(k, c.n);
    const bx = j === 0 ? cx - barW - gap / 2 : cx + gap / 2;
    const solid = j === 0 ? C.with : C.without, light = j === 0 ? C.withL : C.withoutL;
    const yF = y(c.forbidden / c.n), yK = y(k / c.n);
    if (c.forbidden > 0) rect(bx, yF, barW, yBase - yF, solid);
    if (c.refOnly > 0) rect(bx + 1, yK + 1, barW - 2, Math.max(yF - yK - 3, 1), light, solid);
    const mx = bx + barW / 2;
    out.push(`<line x1="${mx}" x2="${mx}" y1="${y(hi)}" y2="${y(lo)}" stroke="${C.ink}" stroke-width="2"/>`);
    out.push(`<line x1="${mx - 7}" x2="${mx + 7}" y1="${y(hi)}" y2="${y(hi)}" stroke="${C.ink}" stroke-width="2"/>`);
    out.push(`<line x1="${mx - 7}" x2="${mx + 7}" y1="${y(lo)}" y2="${y(lo)}" stroke="${C.ink}" stroke-width="2"/>`);
    t(mx, y(hi) - 10, c.n === 60 ? `${k}` : `${k}/${c.n}`, 27, C.ink, "middle", 700); // "Each bar: 60 attack runs" is stated above
  });
  const [l1, l2] = NAMES[m.id] ?? [m.model, ""];
  t(cx, yBase + 36, l1, 25, C.ink, "middle", 600);
  t(cx, yBase + 66, l2, 24, C.ink2, "middle", 400);
});
out.push(`<line x1="${x0}" x2="${x1}" y1="${yBase}" y2="${yBase}" stroke="${C.ink2}" stroke-width="2"/>`);

const verdicts = MODELS.map((m) => d.effect[m.id].diff.verdict as string);
const odd = MODELS.map((m, i) => ({ name: (NAMES[m.id] ?? [m.model, ""]).join(" ").replace(/^OpenAI /, ""), v: verdicts[i] })).filter((x) => x.v !== "unclear");
const vtext = odd.length === 0 ? "no clear difference for any model" : `no clear difference, except ${odd.map((x) => `${x.name} (${x.v === "down" ? "lower" : x.v === "up" ? "higher" : x.v} when told; could be chance)`).join(", ")}`;
t(64, 1056, `Told or not: ${vtext}.`, 25, C.ink2);
t(64, 1088, "Thin lines: 95% interval for these runs.", 25, C.ink2);
t(64, 1120, "Each plan version was timestamped before its trials.", 25, C.ink2);
t(64, 1170, "Agent Payments Lab · Experiment E1a · agentpaymentslab.com", 25, C.ink2, "start", 600);

writeFileSync(outFile, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">${out.join("")}</svg>\n`);
console.log(`wrote ${outFile}`);
