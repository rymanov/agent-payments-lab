// Link check before any push. Every link that points into this repository must reach a file that is in it.
// It reads only the files git tracks, so in the public repository (built from the approved file list) a link to
// a file that was held back fails here, before anyone meets a GitHub 404.
//
// Checks:
//   1. Links to github.com/rymanov/agent-payments-lab: blob/main/<file> must be a tracked file, tree/main/<dir>
//      a tracked folder; security/policy needs SECURITY.md; any other page of the repository is refused.
//   2. Relative links in Markdown files: the target must be a tracked file or folder.
//   3. The site (site/*.html): every relative href and src must be a tracked file in site/, and every #anchor an
//      id on the same page.
// Outside links (other sites) are not checked here: they need the network and change on their own.
//
// Usage: npx tsx scripts/check-links.ts      (from the repository root; exit 1 on any broken link)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

const REPO = "https://github.com/rymanov/agent-payments-lab";
const TEXT = /\.(md|html|cff|ts|yml|yaml|json|txt|sh|css|svg)$/;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const tracked = new Set(files);
const dirs = new Set<string>([""]);
for (const f of files) {
  const parts = f.split("/");
  for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
}

const broken: string[] = [];
let repoLinks = 0;
let relativeLinks = 0;
let anchors = 0;

const stripTail = (u: string) => u.replace(/[.,;:!?]+$/, "");
const pathOnly = (u: string) => decodeURIComponent(u.replace(/[#?].*$/, ""));

function checkRepoLink(file: string, url: string) {
  repoLinks++;
  const rest = stripTail(url).slice(REPO.length).replace(/[#?].*$/, "").replace(/\/$/, "");
  if (rest === "" || rest === "/issues" || rest === "/issues/new" || rest === "/security/advisories/new") return;
  if (rest === "/security/policy") {
    if (!tracked.has("SECURITY.md")) broken.push(`${file}: ${url} (SECURITY.md is not in the repository)`);
    return;
  }
  const m = rest.match(/^\/(blob|tree)\/main(?:\/(.*))?$/);
  if (!m) { broken.push(`${file}: ${url} (not a page this check knows: add it here if it is meant)`); return; }
  const target = decodeURIComponent(m[2] ?? "");
  if (m[1] === "blob" && !tracked.has(target)) broken.push(`${file}: ${url} (no such file: ${target})`);
  if (m[1] === "tree" && !dirs.has(target)) broken.push(`${file}: ${url} (no such folder: ${target})`);
}

function resolveFrom(file: string, target: string): string | null {
  const p = target.startsWith("/") ? posix.normalize(target.slice(1)) : posix.normalize(posix.join(posix.dirname(file), target));
  return p.startsWith("..") ? null : p.replace(/\/$/, "").replace(/^\.$/, "");
}

// Code blocks and inline code are examples, not links.
const withoutCode = (md: string) => md.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");

for (const file of files) {
  if (!TEXT.test(file)) continue;
  const text = readFileSync(file, "utf8");

  for (const m of text.matchAll(/https:\/\/github\.com\/rymanov\/agent-payments-lab(?![\w-])[^\s)"'<>`\]]*/g)) {
    checkRepoLink(file, m[0]);
  }

  if (file.endsWith(".md")) {
    const md = withoutCode(text);
    const targets = [
      ...[...md.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
      ...[...md.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm)].map((m) => m[1]),
      ...[...md.matchAll(/<(?:a|img)\b[^>]*?\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
    ];
    for (const t of targets) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("#") || t.startsWith("//")) continue;
      relativeLinks++;
      const p = resolveFrom(file, pathOnly(t));
      if (p === null) broken.push(`${file}: ${t} (points outside the repository)`);
      else if (!tracked.has(p) && !dirs.has(p)) broken.push(`${file}: ${t} (no such file or folder: ${p})`);
    }
  }

  if (file.startsWith("site/") && file.endsWith(".html")) {
    const ids = new Set([...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const t = m[1];
      if (t.startsWith("#")) {
        anchors++;
        if (!ids.has(t.slice(1))) broken.push(`${file}: ${t} (no element with that id)`);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//")) continue;
      relativeLinks++;
      const p = resolveFrom(file, pathOnly(t));
      if (p === null || !p.startsWith("site/") || !tracked.has(p)) broken.push(`${file}: ${t} (not a file of the site)`);
    }
  }
}

if (broken.length) {
  console.log("BROKEN LINKS:");
  for (const b of broken) console.log(`  ${b}`);
  process.exit(1);
}
console.log(`Links: ${repoLinks} to the repository, ${relativeLinks} relative, ${anchors} anchors on the site; all reach a tracked file.`);
