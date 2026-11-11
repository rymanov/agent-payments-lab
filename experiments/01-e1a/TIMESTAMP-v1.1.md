# Frozen before trials

Frozen at 2026-11-07T12:22:31.931Z (UTC). SHA-256 of FROZEN.sha256: `331edcde6ad20b46810a6cd2ada338b51feca450bc5ce59c6749afd730a67d33`.

Proof: `FROZEN.sha256.ots` (OpenTimestamps; pending until a calendar anchors it in a Bitcoin block, usually within hours).

Check: `shasum -a 256 -c FROZEN.sha256`, then `ots upgrade FROZEN.sha256.ots && ots verify FROZEN.sha256.ots`.

```
1810342c2cc54a287de4476ab23cf495ea5759cbef30ff036adfe8eb374b6104  experiments/01-e1a/PLAN.md
93fa41dc6ccc16818107515af50c30f08e45a808af99edee56a5df5820f9d428  experiments/01-e1a/design.ts
23160e4b006a3d4592cfda1c6c40caeadbecd7b123e019fa968c10a0424cc965  experiments/01-e1a/analyse.ts
742679f7d0d91babfe3acb85e1e0c3e0df1d4ea231c85468ab5f83b6763c4f51  experiments/01-e1a/run.ts
e776e2e89c1eac0c63e02a22397946afc67ff4dd1617de5055f6346632cc92a3  src/report/stats.ts
5ea44efd630720806c7703e552ca3d7f6dce3481f8c181cb1cc45236c1462852  src/agent/agent.ts
e6f647c75c6b839e1af45eb25ba99f631ea7700307664daa18036851f584ef97  src/brain/gateway.ts
18d420febdec0fa7b0a1c2a125f1ed9b43187e448707157178249c34944ae76f  src/checker/checker.ts
a017793abdc00fad17b33969f708d048b7ddad644d7182311a958e770fa55e9c  src/checker/rules.ts
ef7fd38231507bf3edcac6b520ad6da5b7f5a0c22f047bd4643637ff55ddedb9  src/checker/store.ts
```

Upgraded 8 Nov 2026: the proof is complete. `ots verify FROZEN-v1.1.sha256.ots` reports "Bitcoin block 974935 attests existence as of 2026-11-07". Run the hash check from the repository root: `shasum -a 256 -c experiments/01-e1a/FROZEN-v1.1.sha256`.
