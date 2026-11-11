#!/usr/bin/env bash
# Clean re-run before any push (method rule 14). From a fresh clone of the current commit:
# install exactly, run every test, and regenerate each experiment's RESULTS tables from its
# committed logs, and the site from those. If any regenerated file differs from the committed one, nothing is pushed.
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone -q "$src" "$tmp/repo"
cd "$tmp/repo"
npm ci --silent
npm test >/dev/null
status=0
# Every link into this repository (site, README, results) must reach a file the clone holds. Built from the
# approved list, the public repository fails here if a link points at a file that was held back.
npx tsx scripts/check-links.ts || status=1
# Every experiment's current frozen files must match their timestamped hashes (paths are from the repo root).
for f in experiments/[0-9]*/FROZEN.sha256; do
  [ -f "$f" ] || continue
  shasum -a 256 -c "$f" >/dev/null 2>&1 || { echo "DIFFERS: files listed in $f no longer match it"; status=1; }
done
for d in experiments/[0-9]*/; do
  [ -f "$d/analyse.ts" ] && [ -f "$d/logs/trials.jsonl" ] || continue
  mkdir -p "$tmp/out/$d"
  npx tsx "$d/analyse.ts" "$d/logs/trials.jsonl" "$tmp/out/$d" >/dev/null
  for f in tables.md tables.json; do
    if ! cmp -s "$tmp/out/$d/$f" "$d/$f"; then echo "DIFFERS: $d$f"; status=1; fi
  done
done
# Earlier plan versions kept as snapshots: frozen-vX/ holds the files listed in FROZEN-vX.sha256 at their
# original paths. Each must match its timestamped hashes and regenerate that version's tables.
for snap in experiments/[0-9]*/frozen-v*/; do
  [ -d "$snap" ] || continue
  exp="${snap%/frozen-v*/}"; v="${snap#"$exp"/frozen-}"; v="${v%/}"
  if ! (cd "$snap" && shasum -a 256 -c "../FROZEN-$v.sha256" >/dev/null 2>&1); then
    echo "DIFFERS: $snap does not match FROZEN-$v.sha256"; status=1; continue
  fi
  log="$exp/logs/trials-$v.jsonl"
  [ -f "$log" ] || continue
  mkdir -p "$tmp/out/$snap"
  npx tsx "$snap$exp/analyse.ts" "$log" "$tmp/out/$snap" >/dev/null
  for ext in md json; do
    gen="$tmp/out/$snap/tables.$ext"; [ -f "$gen" ] || gen="$tmp/out/$snap/results.$ext"
    if ! cmp -s "$gen" "$exp/tables-$v.$ext"; then echo "DIFFERS: $exp/tables-$v.$ext"; status=1; fi
  done
done
# The site (agentpaymentslab.com) is built from the same tables and logs; it must regenerate the same too.
if [ -f src/site/build.ts ]; then
  mkdir -p "$tmp/site"
  npx tsx src/site/build.ts "$tmp/site" >/dev/null
  for f in "$tmp"/site/*; do
    if ! cmp -s "$f" "site/$(basename "$f")"; then echo "DIFFERS: site/$(basename "$f")"; status=1; fi
  done
fi
[ $status -eq 0 ] && echo "Clean re-run matches: tests pass, and every RESULTS table and the site regenerate the same."
exit $status
