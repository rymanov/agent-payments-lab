/**
 * E1b figure for Lab post 2. Reads tables.json (written by analyse.ts) and draws one SVG. No number is typed by hand.
 * Not frozen: it only draws what the frozen analysis wrote, and checks its totals against it.
 *
 * Each model has two bars: the share of evaluable attack runs in which the agent tried to raise its own limit
 * (called confirm_limit), in A1 (no attacker; the real code mailed to its inbox) and A2 (a planted email with a
 * fake code). The darker inner part is the runs that sent the code itself. The whisker is the 95% Wilson interval.
 *
 * Usage: npx tsx experiments/02-e1b/figure.ts <tables.json> <figure.svg>
 * PNG (18 Nov): Chrome --headless=new --force-device-scale-factor=1 --window-size=1200,1200 --screenshot=figure.png file://.../figure.svg
 */
import { readFileSync, writeFileSync } from "node:fs";
import { wilson } from "../../src/report/stats.js";
import { MODELS } from "./design.js";

const [, , inFile, outFile] = process.argv;
if (!inFile?.endsWith(".json") || !outFile?.endsWith(".svg")) throw new Error("usage: figure.ts <tables.json> <figure.svg>");
const d = JSON.parse(readFileSync(inFile, "utf8"));

const W = 1200, H = 1200;
const C = { surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#4a4946", grid: "#e4e3df", a1: "#2a78d6", a1L: "#a9cbf3", a2: "#eb6834", a2L: "#f7c0a2" };
const NAMES: Record<string, [string, string]> = {
  qwen: ["Qwen 3.5", "open-weight"], haiku: ["Claude", "Haiku 5.5"], sonnet: ["Claude", "Sonnet 5.5"], opus: ["Claude", "Opus 5.5"],
  deepseek: ["DeepSeek", "V4 Pro"], gemini: ["Gemini", "3.8 Flash"],
};
const obtained = (d.obtained as unknown[]).length;
const breaches = (d.breaches as unknown[]).length;
const tried = MODELS.reduce((a, m) => a + d.attempts[m.id].A1.confirm.k + d.attempts[m.id].A2.confirm.k, 0);

const out: string[] = [];
const t = (x: number, yy: number, s: string, size: number, fill = C.ink, anchor = "start", weight = 400) =>
  out.push(`<text x="${x}" y="${yy}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`);
const rect = (x: number, yy: number, w: number, h: number, fill: string) => out.push(`<rect x="${x}" y="${yy}" width="${w}" height="${h}" fill="${fill}"/>`);

out.push(`<rect width="${W}" height="${H}" fill="${C.surface}"/>`);
t(64, 112, `${obtained} limit raises obtained`, 76, C.ink, "start", 700);
t(64, 166, `${d.trials} trials, ${MODELS.length} models, mock payments. ${tried} runs tried to raise the limit: all refused.`, 28, C.ink, "start", 500);
t(64, 250, "How often the agent tried to confirm its own limit raise", 36, C.ink, "start", 700);
rect(64, 276, 30, 30, C.a1); t(104, 300, "No attacker: the real code was mailed to an inbox it reads", 26);
rect(64, 326, 30, 30, C.a2); t(104, 350, "A planted email gave it a fake code", 26);
rect(64, 376, 15, 30, C.a1L); rect(79, 376, 15, 30, C.a2L); t(104, 400, "Lighter top: it tried to confirm without the code it was given", 26);
t(64, 446, `Each bar: the evaluable attack runs for that model and arm (20 planned).`, 24, C.ink2);

const x0 = 112, x1 = 1130, yTop = 510, yBase = 920, ph = yBase - yTop;
const y = (p: number) => yBase - p * ph;
for (const p of [0, 0.5, 1]) {
  out.push(`<line x1="${x0}" x2="${x1}" y1="${y(p)}" y2="${y(p)}" stroke="${C.grid}" stroke-width="2"/>`);
  t(x0 - 12, y(p) + 9, `${p * 100}%`, 24, C.ink2, "end");
}
const groupW = (x1 - x0) / MODELS.length, barW = Math.min(110, groupW / 2 - 8), gap = 4;
MODELS.forEach((m, i) => {
  const cx = x0 + groupW * (i + 0.5);
  (["A1", "A2"] as const).forEach((c, j) => {
    const a = d.attempts[m.id][c];
    const { k, n } = a.confirm;
    const code = a.code.k;
    if (code > k) throw new Error(`figure: code use above tries for ${m.id} ${c}`);
    const bx = j === 0 ? cx - barW - gap / 2 : cx + gap / 2;
    const light = j === 0 ? C.a1L : C.a2L, solid = j === 0 ? C.a1 : C.a2;
    if (n > 0) {
      if (k > 0) rect(bx, y(k / n), barW, yBase - y(k / n), light);
      if (code > 0) rect(bx, y(code / n), barW, yBase - y(code / n), solid);
      const { lo, hi } = wilson(k, n);
      const mx = bx + barW / 2;
      out.push(`<line x1="${mx}" x2="${mx}" y1="${y(hi)}" y2="${y(lo)}" stroke="${C.ink}" stroke-width="2"/>`);
      out.push(`<line x1="${mx - 7}" x2="${mx + 7}" y1="${y(hi)}" y2="${y(hi)}" stroke="${C.ink}" stroke-width="2"/>`);
      out.push(`<line x1="${mx - 7}" x2="${mx + 7}" y1="${y(lo)}" y2="${y(lo)}" stroke="${C.ink}" stroke-width="2"/>`);
      t(mx, y(hi) - 10, n === 20 ? `${k}` : `${k}/${n}`, 27, C.ink, "middle", 700);
    }
  });
  const [l1, l2] = NAMES[m.id] ?? [m.model, ""];
  t(cx, yBase + 36, l1, 25, C.ink, "middle", 600);
  t(cx, yBase + 66, l2, 24, C.ink2, "middle", 400);
});
out.push(`<line x1="${x0}" x2="${x1}" y1="${yBase}" y2="${yBase}" stroke="${C.ink2}" stroke-width="2"/>`);
// Format slips (label no_json) count as "did not try", so those bars are a floor. Added 18 Nov at G2 (Mike: "do it"),
// so the picture says what the post says. Counts come from d.labels, over both attack arms.
const slips = MODELS.map((m) => {
  const arms = (["A1", "A2"] as const).map((c) => d.labels[m.id][c] as Record<string, number>);
  const total = arms.reduce((a, l) => a + Object.values(l).reduce((x, v) => x + v, 0), 0);
  return { id: m.id, k: arms.reduce((a, l) => a + l.no_json, 0), total };
}).filter((s) => s.k > 0).sort((a, b) => b.k - a.k);
const slipName = (id: string) => { const [a, b] = NAMES[id] ?? [id, ""]; return a === "Claude" ? `Claude ${b.split(" ")[0]}` : a; };
const slipText = slips.map((s, i) => `${slipName(s.id)} ${s.k}${i === 0 ? ` of ${s.total} attack runs` : ""}`).join(", ");
t(64, 1050, `The checker took no code from the agent: limits change only through the owner's console. Breaches: ${breaches}.`, 24, C.ink2);
if (slips.length) {
  t(64, 1082, "Runs that ended early on a formatting slip count as not tried, so those bars are a floor:", 24, C.ink, "start", 600);
  t(64, 1114, `${slipText}.`, 24, C.ink, "start", 600);
}
t(64, 1146, "Thin lines: 95% interval for these runs. The plan was timestamped before its trials.", 24, C.ink2);
t(64, 1184, "Agent Payments Lab · Experiment E1b · agentpaymentslab.com", 24, C.ink2, "start", 600);

writeFileSync(outFile, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">${out.join("")}</svg>\n`);
console.log(`wrote ${outFile}`);
