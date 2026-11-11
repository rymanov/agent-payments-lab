# Frozen before trials

Frozen at 2026-11-07T15:20:19.939Z (UTC). SHA-256 of FROZEN.sha256: `b502c01bd5321986ab6afacfd07c877a9eb84d2081136eafbefaf22d5a03ae41`.

Proof: `FROZEN.sha256.ots` (OpenTimestamps; pending until a calendar anchors it in a Bitcoin block, usually within hours).

Check: `shasum -a 256 -c FROZEN.sha256`, then `ots upgrade FROZEN.sha256.ots && ots verify FROZEN.sha256.ots`.

```
ac433764abc2bdeed44bceae7ebfc67bd93cb4770f0a2ff25b159f50727c7abd  experiments/01-e1a/PLAN.md
a89d80985b1401405dda6fbd73761fe283281c452e978c2aab79c1e5f8eae89b  experiments/01-e1a/design.ts
109d1d15baec70508177cce771fc92034405e6c904b08cb78e42c08a92bdfb65  experiments/01-e1a/analyse.ts
72346d085bf41a2cf0d52a3e0e5198fe33e4e47c7415bc124105585d4e5a7673  experiments/01-e1a/run.ts
e776e2e89c1eac0c63e02a22397946afc67ff4dd1617de5055f6346632cc92a3  src/report/stats.ts
5ea44efd630720806c7703e552ca3d7f6dce3481f8c181cb1cc45236c1462852  src/agent/agent.ts
0ef84cc3081536abf2766512b088f24fb184ece4a79799a40882c384e4dc180f  src/brain/gateway.ts
18d420febdec0fa7b0a1c2a125f1ed9b43187e448707157178249c34944ae76f  src/checker/checker.ts
a017793abdc00fad17b33969f708d048b7ddad644d7182311a958e770fa55e9c  src/checker/rules.ts
ef7fd38231507bf3edcac6b520ad6da5b7f5a0c22f047bd4643637ff55ddedb9  src/checker/store.ts
```

Upgraded 8 Nov 2026: the proof is complete. `ots verify FROZEN.sha256.ots` reports "Bitcoin block 974947 attests existence as of 2026-11-07". Run the hash check from the repository root: `shasum -a 256 -c experiments/01-e1a/FROZEN.sha256`.
