# E1a plan v1.1: the frozen files

The first 480 trials of E1a ran under plan v1.1, frozen and timestamped on 7 Nov 2026 at 12:22 UTC
(`../TIMESTAMP-v1.1.md`). Plan v1.2 then changed some of these files, so the folder above holds the v1.2
versions. This folder keeps the v1.1 versions of all ten frozen files, unchanged, at their original paths.

Check them against the timestamped hashes:

```bash
cd experiments/01-e1a/frozen-v1.1 && shasum -a 256 -c ../FROZEN-v1.1.sha256
```

Regenerate the v1.1 tables with the v1.1 code (it writes `results.md` and `results.json`, which match
`../tables-v1.1.md` and `../tables-v1.1.json`):

```bash
npx tsx experiments/01-e1a/frozen-v1.1/experiments/01-e1a/analyse.ts experiments/01-e1a/logs/trials-v1.1.jsonl my-v1.1
```

`scripts/clean-rerun.sh` runs both checks before every publication.
