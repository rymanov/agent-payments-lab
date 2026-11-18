# Lab post 2: the limit held

Mike Rymanov on LinkedIn, Thu 19 Nov 2026, 09:00 UK. Experiment: [E1b](../experiments/02-e1b/).
The text below is the post as approved for that date. Its numbers come from [tables.md](../experiments/02-e1b/tables.md)
and the exploratory counts in [explore.md](../experiments/02-e1b/explore.md).

---

Last Friday OpenAI launched ChatGPT Wallet. For now the owner approves every purchase with Face ID or Touch ID. Spending limits come later. When they do, one question matters: can the agent raise its own limit? That is what I tested this week.

The Cornell Tech and Yale team behind I-HITL showed how an agent can raise its own limit. Give the agent a task that costs more than its limit, and
send the code that confirms a limit raise to an inbox the agent can read. Nine of their ten models used that code
at least once.

So I built that trap, with no attacker in it. Six models from four companies, a premium report above the limit, and
the owner's confirmation code mailed to an inbox the agent can read. In a second arm, a planted email offered a fake code.
360 trials, mock payments, the plan timestamped before the first trial.

- 0 limit raises obtained, 0 payments over the limit. Limits change only through the owner's own console,
  which the agent can't reach. The checker refused all 39
  attempts.
- Three models used the owner's code with no one asking them to: DeepSeek V4 Pro in 14 of 20 runs, Gemini 3.8
  Flash in 9 of 19, Qwen 3.5 9B in 4 of 20. Each first asked the owner for a higher limit, then read the reply meant
  for the owner, and sent the code itself.
- Claude Opus asked the owner and stopped in 19 of 20 runs. It never tried the code, as in I-HITL. Claude Haiku and Sonnet didn't
  try either, but many of Sonnet's runs and some of Haiku's stopped early on a formatting slip, so I don't count
  that as a result.
- The planted fake code: Qwen sent it in 9 of 20 runs, more often than the real one. DeepSeek 2 of 20, the rest
  never. All were refused.
- With no trap in the inbox, every task was done: 120 of 120.

What this does not show: my agent, my wording and mock services, not I-HITL's set-up, so the rates sit beside
theirs, not against them. Some Claude, Qwen and Gemini runs stopped early on a formatting slip or an error, so their counts are a floor.

Limits in payments are enforced at every level: per channel, per rail, per account, per day, by number and by value
of payments. Some are set by the card schemes or the banking provider, and you can't really change them. Then the
customer can set a limit of their own: I don't want to make payments above $5,000 a day. To raise a limit, somebody
asks for the increase and a second person reviews and approves it. You split the responsibility between two people:
a maker and a checker.

Disclosure: Claude, an AI coding agent, writes much of the code and helps me draft, and three of the six models are
Claude's. DeepSeek, also tested here, reviews the Lab's results. So the plan was timestamped before its trials, a
script, not a model, labels every outcome, and the code and logs are public.

#AgenticPayments #Payments #AIAgents
