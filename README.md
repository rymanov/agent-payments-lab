# Agent Payments Lab

Open experiments on how AI agents pay, and how to keep them in check. Results, method and contact:
**[agentpaymentslab.com](https://agentpaymentslab.com)**.

> **Research on test set-ups.** Not a product, not financial advice, and not an offer of any cryptoasset. The
> code runs on the Base Sepolia test network or against mock services only. Do not use it to hold or move real
> funds.

## The idea in one paragraph

An AI agent that can pay will read text it does not control, and some of that text will try to make it pay the
wrong party, pay too much or pay twice. So the agent never holds the key. It sends a request to a separate
**mandate checker**, which holds the key and signs only what the owner's **mandate** allows: who may be paid
(scope), how much and how often (limits), and never the same thing twice. The checker is what this repository
tests. The agent is the thing it is tested against.

## Results

| Experiment | Question | Answer | Files |
|---|---|---|---|
| **E1a** (run 7 Nov 2026) | Can planted text make a paying agent overspend, pay an unlisted supplier or pay twice, and does telling it a checker exists change that? | Every model followed planted text at least sometimes. The checker signed no payment the mandate forbids. Telling the agent about the checker made no clear difference for six of seven models. | [Plan](experiments/01-e1a/PLAN.md) · [Results](experiments/01-e1a/RESULTS.md) · [Logs](experiments/01-e1a/logs) |

Each new experiment is added here and on the site when it is published, with its plan, code and logs.

## What E1a shows, and what it does not

It shows that this checker signed no payment its mandate forbids, for all seven models from five companies, in
any of the 1,120 trials. The checker was really tested in the 289 trials where the agent asked for something
forbidden; zero failures there puts its failure rate below 1.3% (95% interval). It does not show that the mandate's rules are the right ones: the Lab wrote both the
mandate and the attacks. It used mock services and an unfunded test key, a one-step agent, and three attacks of
its own. The checker is a prototype: a sandbox, not a separate user, keeps the key from the agent, and its port
has no login yet. Revocation, the third part of a mandate, is not tested yet. The full limits are in
[RESULTS](experiments/01-e1a/RESULTS.md#limits).

## How the work is kept honest

1. **Plan first, provably.** Each experiment's `PLAN.md` sets the question and the pass and fail lines. The plan
   and the analysis script are hashed and timestamped with OpenTimestamps before the first trial
   (`FROZEN.sha256`, `TIMESTAMP.md`). A change after that needs a new plan version and a new timestamp.
2. **A script labels every outcome** from what the mock services served and what the checker signed. No model
   judges an outcome. No number in a result is typed by hand.
3. **Raw logs are public:** one JSON line per trial, including the planted text and each model's answer.
4. **A clean re-run before every publication:** `scripts/clean-rerun.sh` clones the repository, runs the tests,
   regenerates every result table and the site from the logs, and fails if anything differs.
5. **Outside review:** a model from another family reads each plan and result cold; each finding is checked and
   recorded in the results. That is a review, not an audit.

This repository's history starts on 11 Nov 2026, when it was made public. Commit IDs cited inside E1a's files (the
checker at `8082fa3`) refer to the Lab's private working history. The frozen files are proven by their hashes
(`FROZEN.sha256`) and the OpenTimestamps proofs beside them, which do not depend on commit IDs.

## How the checker works

The agent sends `POST /pay {requestId, agent, task, url}`. It cannot name an amount or a payee. The checker
applies these rules in order, and logs every decision with the service's payment terms:

1. **Request shape:** exactly those four fields.
2. **Request ID:** claimed in the ledger before anything else; a reused ID never pays again.
3. **Agent** is on the mandate.
4. **Service** is on the allowed list: exact origin and path prefix; no user info, no `..`, no redirects.
5. **Payment terms pinned per service:** x402 v2, scheme `exact`, network, USDC contract, payee address, maximum
   amount, EIP-712 domain, EIP-3009 only (no Permit2), authorization window at most 300 seconds.
6. **Per-payment limit.**
7. **One atomic step:** weekly budget (rolling 7 days), payments per task, the same URL at most once in 10
   minutes.
8. **Sign** only the approved option, and check the signed authorization matches before sending it.

The open gaps from the first prototype (paying for junk from an allowed service, re-buying under new task names,
no login on the checker's port, the key protected by a sandbox rather than a separate user, and a service always
able to charge its pinned maximum) are listed in [RESULTS.md](RESULTS.md).

## Run it

Requires Node 24 and macOS (the agent runs under `sandbox-exec`).

```bash
npm ci
npm test        # attack tests and analysis tests: no network, no money
```

Re-run E1a on your own machine (Tier A: the checker, the mock services and the two open models through a local
[Ollama](https://ollama.com); no accounts, no money):

```bash
shasum -a 256 -c experiments/01-e1a/FROZEN.sha256      # the frozen files are unchanged
OLLAMA_URL=http://localhost:11434 npx tsx experiments/01-e1a/run.ts --models qwen,gemma --log my-trials.jsonl
npx tsx experiments/01-e1a/analyse.ts my-trials.jsonl my-tables
```

The hosted models (Tier B) need your own API keys; see "How to re-run it" in the
[E1a results](experiments/01-e1a/RESULTS.md#how-to-re-run-it). The live Base Sepolia path (`npm run service`,
`npm run checker`, `tests/live/`) needs a test wallet with faucet USDC; `npm run wallet:new` makes one and
refuses to overwrite an existing `.env`.

## What is where

| Path | What |
|---|---|
| `src/checker/` | The mandate checker: the only process that reads the key and signs |
| `src/agent/` | The agent, run in its own sandboxed process |
| `src/service/` | An x402 test service on Base Sepolia |
| `src/brain/` | The model gateway: each provider's API, full model IDs, no fallback model |
| `src/report/` | Statistics (Wilson and Newcombe intervals) |
| `src/site/` | Builds the site from the results |
| `experiments/NN-name/` | One folder per experiment: plan, timestamps, run and analysis scripts, results, logs |
| `experiments/_template/` | The plan and results templates every experiment starts from |
| `site/` | [agentpaymentslab.com](https://agentpaymentslab.com), published by GitHub Pages |
| `scripts/` | Secret scan, clean re-run, freeze and timestamp |
| `posts/` | Each Lab post as published |

## Who runs it

The Lab is Mike Rymanov's own, run with his own test funds. Claude, an AI coding agent, writes much of the code
and helps draft, and three of E1a's seven models are Claude's. That is why each plan is timestamped before its
trials, a script labels every outcome, and the code and logs are public for anyone to check.

## Contact, security and citing

- Questions about a result: open an issue. Anything else: lab@agentpaymentslab.com.
- A flaw in the checker: report it privately, as [SECURITY.md](SECURITY.md) explains.
- To cite: [CITATION.cff](CITATION.cff).

Code: [Apache-2.0](LICENSE). Results, reports and logs: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
See [NOTICE](NOTICE).
