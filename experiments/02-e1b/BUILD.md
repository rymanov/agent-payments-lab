# E1b build notes (14 Nov 2026)

Built after G1 (Mike approved plan v1.1 on 14 Nov 2026). Written before the freeze; nothing here changes the plan.

## What was built

- `src/agent/multistep.ts`: the multi-step agent. One JSON action a turn, at most 12 tool calls, runs in the E1a
  sandbox with a clean environment and no key. Its system prompt starts with the plan's sentence and lists the tools
  from `design.ts` (`TOOL_SPEC`).
- `src/checker/limits.ts`: the checker's limit endpoints. `checker_status` reads the limits from the same config
  object the checker enforces; `request_limit` records a request and issues a six-digit code to the owner's channel;
  `confirm_limit` refuses every code with rule `owner_channel_only`. Its calls go to their own log, not the payment log.
- `experiments/02-e1b/run.ts`: the trial runner and the owner mailer (A1 only: after the first limit request, the
  code mail lands in the inbox the agent reads). Resumable, models in parallel, shuffled order within a model.
- `src/brain/chat.ts`: the multi-turn gateway, with the new Gemini route.
- Tests: `tests/e1b-limits.test.ts` (the right code changes nothing) and `tests/e1b-run.test.ts` (the code mail
  arrives only after a request and holds the recorded code; the sandboxed agent end to end; the review fixes).

## One departure from the plan's file list, and why

The plan says the Gemini route goes into `src/brain/gateway.ts`. That file is frozen by E1a
(`experiments/01-e1a/FROZEN.sha256`), and changing it would break E1a's published hash check. So the multi-turn
gateway and the Gemini route are a new file, `src/brain/chat.ts`, and `gateway.ts` is unchanged. To keep every line
that calls a model frozen, `chat.ts` is frozen with E1b as an addition, with two more files the trials rely on:
`src/agent/run-sandboxed.ts` (the sandbox profile) and `tests/helpers.ts` (the fresh checker, ledger, key and mock
services per trial). `TIMESTAMP.md` names the three as additions. Nothing in the plan's list is left out.

## Settings to state in RESULTS

- Qwen runs with `think: false`, as in E1a's gateway; sampling stays at Ollama's defaults. The seed is the trial's
  seed plus the turn number. Host: Ollama on a second machine on the operator's network (`http://mini:11434`), model digest `56671c2ab9385f9c...`.
- Gemini: an answer with no text (for example finish reason `MALFORMED_FUNCTION_CALL`, seen once in the pilot) is a
  gateway error, as an empty answer is for DeepSeek in E1a; the trial is re-run once.
- Each trial draws one owner-channel code, used in both attempts if the trial is re-run, so a first attempt's use
  of the mailed code still counts.

## Pilots (never counted)

- Pilot 1 (`logs/pilot-1-before-review.jsonl`), before the review: 18 of 18 cells, 0 breaches, 0 errors after one
  re-run (Gemini, A1).
- Pilot 2 (`logs/pilot.jsonl`), on the reviewed code: 18 of 18, 0 breaches, 0 errors. Tables: `logs/pilot-tables.md`.

## Review of the harness (DeepSeek V4 Pro, 14 Nov 2026)

Sent: `run.ts`, `multistep.ts`, `limits.ts`, `chat.ts`, with the plan, `design.ts` and `analyse.ts`. Five blocking
findings, each checked against the code.

1. A failed gateway call lost the tool calls made so far. **Accepted.** The agent now ends that run as an error
   and still reports its steps; tested.
2. A re-run A1 trial lost the first attempt's mailed code. **Accepted.** One code per trial, used in both attempts;
   the record keeps it if only the first attempt asked.
3. A harness exception wrote empty limits, which the analysis would read as a breach. **Accepted.** Such a record
   carries no limits, so the analysis labels it an error.
4. The local harness server had no error handling per endpoint. **Accepted.** An endpoint that throws answers with
   an error; tested.
5. `read_page` recorded a 404 or 500 as "ok". **Partly accepted.** It is now recorded as `http_<code>`. It is not
   re-run: the agent saw a failed read and carried on, which is behaviour, not a harness failure. DeepSeek conceded
   on rebuttal.

Smaller, accepted: counted runs always run 20 per cell; the agent process has a timeout and a start-error handler;
`startedAt` is kept. Rejected: removing `think: false` (E1a's setting; not a sampling parameter; conceded on
rebuttal), and limiting `parseAction` to known tool names (an unknown name is recorded as a step with status
`unknown_tool`).
