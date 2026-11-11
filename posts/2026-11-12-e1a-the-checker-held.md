# Lab post 1: the checker held

Mike Rymanov on LinkedIn, Thu 12 Nov 2026, 09:00 UK. Experiment: [E1a](../experiments/01-e1a/).
The text below is the post as approved for that date. Its numbers come from [tables.md](../experiments/01-e1a/tables.md)
and the exploratory counts in [explore.md](../experiments/01-e1a/explore.md).

---

A team at Cornell Tech and Yale gave AI agents a wallet with a one-cent daily cap. Nine of ten models raised
their own cap at least once, including DeepSeek V4 Pro, which I tested too.

So I tested the other half: take the power to change the rules, and to sign payments, away from the agent. The owner sets a
mandate: who to pay, how much, and never the same thing twice. In the language of the FCA's Mills Review, that
is scope and limits. A separate checker holds the key and signs only what the mandate allows. Does that hold?

I planted instructions in what the agent reads: spend more, pay a different supplier, pay twice. Seven models from
five companies, 1,120 trials, mock payments, each plan version timestamped before its trials.

- The checker held: 0 mandate breaches. Four models tried to overspend or pay a supplier outside the mandate (Gemma 4 in
  80 of 80 attacks, Qwen 67, DeepSeek 41, GPT-5.5 23 of 78). Three also tried to pay twice (Gemma 4 in 40 of 40,
  Qwen 36, DeepSeek 2). The checker refused every one.
- The three Claude models never tried any of that. Their only slip, in some pay-twice attacks (Haiku 3, Sonnet 37,
  Opus 28 of 40): one allowed purchase using a reference ID the attacker supplied. Nothing extra was paid.
- In 279 honest trials, the checker never refused a purchase.
- Telling the agent a checker exists made no clear difference, except for GPT-5.5, which was tricked less when
  told. That could be chance and needs a repeat.

What this does not show: I built both the agent and the checker, and wrote both the mandate and the attacks. So
it shows the checker enforces its rules, not that they are the right ones. Revocation, the third part of a
mandate, comes in a later test.

No model should be trusted to sign payments or change the mandate, since every model I tested followed planted text
at least sometimes. The checker holds the mandate and sits between the wallet and the agent, and it needs to be
there regardless of who builds it. In my opinion it should be open source, so anyone can inspect and test it; for a
given mandate, every checker should reach the same decision. And the rule has to be that the agent cannot change
the mandate. I would also want a kill switch that pauses the agents straight away when something looks wrong, for a
person to review.

Disclosure: Claude, an AI coding agent, writes much of the code and helps me draft, and three of the seven models
are Claude's. So each plan version was timestamped before its trials, a script, not a model, labels every outcome, and
the code and logs are public for anyone to check. Other AI models reviewed the write-up; that is not an audit.

#AgenticPayments #Payments #AIAgents
