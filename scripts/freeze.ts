/**
 * Freeze an experiment before its counted trials (method rule 1). Hashes each file named in the
 * plan's "Files frozen" section, writes the list to FROZEN.sha256, and timestamps that list with
 * OpenTimestamps (free, no account, later anchored in Bitcoin). Writes TIMESTAMP.md and the
 * proof FROZEN.sha256.ots. Anyone can check: `sha256sum -c FROZEN.sha256` and `ots verify`.
 * Usage: npx tsx scripts/freeze.ts experiments/01-e1a
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
// @ts-ignore: the package ships no types
import OpenTimestamps from "opentimestamps";

const dir = process.argv[2];
if (!dir) throw new Error("usage: freeze.ts <experiment folder>");
const plan = readFileSync(path.join(dir, "PLAN.md"), "utf8");
const section = plan.split(/^## 10\. Files frozen/m)[1];
if (!section) throw new Error("PLAN.md has no '## 10. Files frozen' section");
const files = [...section.matchAll(/`([^`]+\.(?:md|ts|json))`/g)].map((m) => m[1]).filter((f) => f.includes("/")); // paths only, not the TIMESTAMP.md the section mentions
if (!files.length) throw new Error("no files listed to freeze");

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const manifest = files.map((f) => `${sha(f)}  ${f}`).join("\n") + "\n";
const manifestPath = path.join(dir, "FROZEN.sha256");
writeFileSync(manifestPath, manifest);
const digest = createHash("sha256").update(manifest).digest();

const detached = OpenTimestamps.DetachedTimestampFile.fromHash(new OpenTimestamps.Ops.OpSHA256(), digest);
await OpenTimestamps.stamp(detached);
writeFileSync(manifestPath + ".ots", Buffer.from(detached.serializeToBytes()));

const when = new Date().toISOString();
writeFileSync(
  path.join(dir, "TIMESTAMP.md"),
  `# Frozen before trials\n\nFrozen at ${when} (UTC). SHA-256 of FROZEN.sha256: \`${digest.toString("hex")}\`.\n\n` +
    "Proof: `FROZEN.sha256.ots` (OpenTimestamps; pending until a calendar anchors it in a Bitcoin block, usually within hours).\n\n" +
    "Check: `shasum -a 256 -c FROZEN.sha256`, then `ots upgrade FROZEN.sha256.ots && ots verify FROZEN.sha256.ots`.\n\n" +
    "```\n" + manifest + "```\n",
);
console.log(`Frozen ${files.length} files; manifest hash ${digest.toString("hex")}; proof written.`);
