#!/usr/bin/env bash
# Builds the public repository's fresh history from one commit of the Lab's private working repository.
# The working history names the operator's machines, so the public repository starts from a single new commit
# (foundation, section 7). It exports exactly the files on the approved list, commits them, tags the release,
# and then runs every pre-push check inside the new repository: the secret scan over its whole history, the
# leak-marker check and the clean re-run. It never pushes; pushing is a separate, approved step.
#
# Usage:  AUTHOR_NAME="..." AUTHOR_EMAIL="..." scripts/public-tree.sh <commit> <list-file> <out-dir> <tag> <tag-message>
#   <list-file>  one path per line ('#' comments allowed): the file list approved at G2
#   <out-dir>    must not exist yet
# Private inputs, never committed: lab-private/scan-private.txt and lab-private/leak-markers.txt.
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -eq 5 ] || { echo "usage: AUTHOR_NAME=.. AUTHOR_EMAIL=.. $0 <commit> <list-file> <out-dir> <tag> <tag-message>"; exit 2; }
commit="$1"; list="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; tag="$4"; tagmsg="$5"
# The out-dir is made absolute here, before any cd, so the check below and the mkdir later name the same folder.
outparent="$(dirname "$3")"
[ -d "$outparent" ] || { echo "REFUSED: $outparent does not exist."; exit 1; }
out="$(cd "$outparent" && pwd)/$(basename "$3")"
: "${AUTHOR_NAME:?set AUTHOR_NAME}" "${AUTHOR_EMAIL:?set AUTHOR_EMAIL}"
[ -e "$out" ] && { echo "REFUSED: $out already exists."; exit 1; }
for f in scan-private.txt leak-markers.txt; do
  [ -s "$src/lab-private/$f" ] || { echo "REFUSED: lab-private/$f is missing."; exit 1; }
done

cd "$src"
full="$(git rev-parse --verify "$commit^{commit}")"
paths=()
while IFS= read -r p; do paths+=("$p"); done < <(grep -v '^[[:space:]]*#' "$list" | sed '/^[[:space:]]*$/d' || true)
[ ${#paths[@]} -gt 0 ] || { echo "REFUSED: the list is empty."; exit 1; }

# 1. Every listed path is a file in that commit; nothing is listed twice.
dups=$(printf '%s\n' "${paths[@]}" | sort | uniq -d)
[ -z "$dups" ] || { echo "REFUSED: listed twice:"; printf '%s\n' "$dups" | sed 's/^/  /'; exit 1; }
missing=0
for p in "${paths[@]}"; do
  [ "$(git cat-file -t "$full:$p" 2>/dev/null)" = blob ] || { echo "NOT IN $commit: $p"; missing=1; }
done
[ $missing -eq 0 ] || { echo "REFUSED: listed files missing from the commit."; exit 1; }

# 2. Say what the commit holds that the list leaves out, so nothing is held back silently.
held=$(git ls-tree -r --name-only "$full" | grep -v -x -F -f <(printf '%s\n' "${paths[@]}") || true)
echo "Held back (in $commit, not on the list):"; printf '%s\n' "${held:-none}" | sed 's/^/  /'

# 3. Export the listed files and make the one commit.
mkdir -p "$out"
git archive "$full" -- "${paths[@]}" | tar -x -C "$out"
cd "$out"
git init -q -b main
git add -A
[ "$(git ls-files | wc -l | tr -d ' ')" -eq ${#paths[@]} ] || { echo "REFUSED: staged count differs from the list."; exit 1; }
GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -c commit.gpgsign=false commit -q -m "Agent Payments Lab: public start" -m \
"The Lab's checker, agent and attack tests; experiment E1a (plan, timestamps, run and analysis scripts, trial
logs and results); and the site at agentpaymentslab.com. The public history starts here: see the README."
GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -c tag.gpgsign=false tag -a "$tag" -m "$tagmsg"
echo "Fresh history: $(git rev-parse --short HEAD) on main, tag $tag, ${#paths[@]} files, from $commit."

# 4. Pre-push checks, inside the new repository. The private inputs are copied in for the checks only:
#    .gitignore must ignore the whole folder, nothing else may be left untracked, and the folder is removed after.
cp -R "$src/lab-private" ./lab-private
trap 'rm -rf "$out/lab-private"' EXIT
for f in lab-private lab-private/*; do
  git check-ignore -q "$f" || { echo "REFUSED: $f is not ignored by .gitignore."; exit 1; }
done
[ -z "$(git status --porcelain)" ] || { echo "REFUSED: the new repository has untracked or changed files:"; git status --short; exit 1; }
bash scripts/secret-scan.sh
markers=$(grep -v '^[[:space:]]*#' lab-private/leak-markers.txt | sed '/^[[:space:]]*$/d' | paste -sd'|' -)
[ -n "$markers" ] || { echo "REFUSED: lab-private/leak-markers.txt has no markers."; exit 1; }
rc=0; git grep -q -E -e "$markers" HEAD || rc=$?
case $rc in
  0) echo "LEAK MARKERS FOUND in:"; git grep -l -E -e "$markers" HEAD | sed 's/^HEAD:/  /'; exit 1 ;;
  1) echo "Leak markers: none." ;;
  *) echo "REFUSED: the leak-marker search did not run (git grep status $rc)."; exit 1 ;;
esac
# The timestamp proofs must verify against Bitcoin (network needed). Each .ots sits beside the file it proves.
# The verifier asks public block explorers, which sometimes fail for a moment, so each proof gets three tries;
# if all three fail, nothing goes further.
ots="$src/node_modules/.bin/ots-cli.js"
[ -f "$ots" ] || { echo "REFUSED: $ots is missing (npm ci in the working repository)."; exit 1; }
for proof in experiments/*/FROZEN*.sha256.ots; do
  [ -f "$proof" ] || continue
  for try in 1 2 3; do
    result=$(cd "$(dirname "$proof")" && node "$ots" verify "$(basename "$proof")" 2>&1 || true)
    printf '%s\n' "$result" | grep -q '^Success! Bitcoin block' && break
    [ $try -lt 3 ] && sleep 10
  done
  printf '%s\n' "$result" | grep -q '^Success! Bitcoin block' || { echo "REFUSED: $proof does not verify after 3 tries:"; printf '%s\n' "$result" | tail -3; exit 1; }
  echo "Timestamp: $proof: $(printf '%s\n' "$result" | grep '^Success!' | head -1)"
done
bash scripts/clean-rerun.sh
echo "READY: $out passes every check. Nothing has been pushed."
