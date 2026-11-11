#!/usr/bin/env bash
# Secret scan before any push to the public repo (operations rule 4; foundation section 7).
# Scans every committed change in the whole history, plus files staged or modified now.
# Exit 1 if anything matches that is not in scripts/secret-scan-allow.txt, and also if the scan itself cannot
# run properly (a bad pattern, an unreadable list): it fails closed, never open.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "SECRET SCAN FAILED: $*"; exit 1; }
# Lines of a pattern or allow list, without comments or blank (or whitespace-only) lines.
entries() { grep -v '^[[:space:]]*#' "$1" | sed '/^[[:space:]]*$/d' || true; }

# Generic patterns: keys and tokens, and any 0x-prefixed 64-hex value (private keys look like transaction hashes,
# so each public hash must be on the allow list). The search ignores case (API_KEY, Private Key). Private names from the operator's machines come
# from lab-private/scan-private.txt, which is never committed; without it the scan refuses to pass.
PATTERNS='(sk-ant-[A-Za-z0-9_-]{10,}|PRIVATE_KEY *= *0x[0-9a-fA-F]{8,}|BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key["'"'"']? *[:=] *["'"'"']?[A-Za-z0-9_-]{16,}|0x[0-9a-fA-F]{64}\b)'
private=lab-private/scan-private.txt
[ -s "$private" ] || fail "$private is missing (private name patterns)."
extra="$(entries "$private" | paste -sd'|' -)"
[ -n "$extra" ] || fail "$private has no patterns."
PATTERNS="${PATTERNS%)}|$extra)"

# grep exits 0 on a match, 1 on none, 2 on an error such as an invalid pattern. Only 0 and 1 are acceptable.
rc=0; printf 'probe\n' | grep -E -i -q -- "$PATTERNS" || rc=$?
[ $rc -le 1 ] || fail "the combined pattern is not a valid extended regular expression."

{ git log --all -p --format= ; git diff HEAD; git diff --cached; } > "$tmp/text"
rc=0; grep -E -i -o -- "$PATTERNS" "$tmp/text" > "$tmp/hits" || rc=$?
[ $rc -le 1 ] || fail "the search did not run (grep status $rc)."
sort -u "$tmp/hits" | sed '/^$/d' > "$tmp/unique"

allow=scripts/secret-scan-allow.txt
if [ -f "$allow" ]; then
  entries "$allow" > "$tmp/allow"
  rc=0; grep -v -x -F -f "$tmp/allow" "$tmp/unique" > "$tmp/left" || rc=$?
  [ $rc -le 1 ] || fail "the allow list could not be applied (grep status $rc)."
  # grep -f with an empty pattern file matches nothing, so every hit stays: correct, and fails closed.
  [ -s "$tmp/allow" ] || cp "$tmp/unique" "$tmp/left"
else
  cp "$tmp/unique" "$tmp/left"
fi
if [ -s "$tmp/left" ]; then
  echo "SECRET SCAN FAILED. Matches not on the allow list:"
  sed 's/^/  /' "$tmp/left"
  exit 1
fi
echo "Secret scan clean: $(git rev-list --all --count) commits and the working tree."
