# Security policy

The Agent Payments Lab tests a mandate checker: the software that holds an agent's payment key and signs only
what the owner's mandate allows. If you find a payment the checker should have refused but did not, that is the
most useful thing you can tell us.

## What to report

- **A flaw in the Lab's checker or harness:** a way to get a payment signed that the mandate forbids, to reach
  the key, to change the mandate from the agent's side, or to make the trial labels wrong.
- **A mistake in a published result:** a number that does not follow from the logs, or a label that is wrong.
  These can go in a public issue unless they reveal a flaw above.

The checker runs on test networks and against mock services only. Nothing here holds real funds.

## How to report

Report a flaw privately:

1. Use GitHub's private reporting: the **Report a vulnerability** button on this repository's **Security** tab.
2. Or email **lab@agentpaymentslab.com** with "Security" in the subject.

Please include the commit, the steps or test that show the problem, and what you expected the checker to do.
Do not open a public issue for a flaw until it is fixed.

## What happens next

- We reply within 5 working days.
- A confirmed flaw in the Lab's own checker is fixed and then published at once: in the affected experiment's
  results, in the repository and on [agentpaymentslab.com](https://agentpaymentslab.com). We credit you, unless
  you would rather not be named.
- If a result changes, the correction goes where the result was published, the same day.

## Flaws in someone else's code

If a Lab experiment finds a flaw in someone else's code (an SDK, a facilitator, a wallet or a protocol), the
Lab reports it to that maintainer first, through their own security contact, and publishes it after a fix or
after 90 days. If you find one through this repository, please report it to its maintainer, not here.

How often an AI model follows planted text is model behaviour, already widely published, not a vulnerability.
The Lab reports it with the prompts.
