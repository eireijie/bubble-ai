# Agents that work on their own, without running up usage

A Wisp agent left alone notices things in the person's apps, does the work, and writes first. This
page is about what that costs and how the cost is kept down. The rule: **code watches, a model only
wakes when something really changed, and never past the person's limits or their plan's.**

## What wakes a model

| What happens | Who looks | Model calls |
|---|---|---|
| Nothing changes in a watched app or page | The hub polls and compares (`watches.ts`, `page-diff.ts`) | 0 |
| The agent has a computer and nothing in particular to look at | Nobody, after its first look | 0 |
| Something changes in a watched app or page | A **sort** on the smallest model, then a check only on a yes | 1 small, sometimes 1 full |
| A change addressed to the person (a mention, a review request) | Straight to a check | 1 full |
| A follow-up the agent promised comes due | A check, which takes any waiting changes along | 1 full |
| A team's schedule comes due | The team's steps | 1 per step |
| A connected app with no watch (Wisp can't see when it changes) | A check at the agent's pace, doubling up to 12 hours while quiet | a few a day at most |

## Sorting before a full check (`triage.ts`)

A full check wakes the agent with all its tools, its memory and its notes. With Codex on its small
model that measured 47,000 to 190,000 tokens per check, whether or not the change mattered. So a
batch of changes first goes to the harness's smallest model (`smallestModel` in `@wisp/core`) as a
**bare run**: a few lines, no Wisp tools, no browser, no connectors, read-only, low effort. It
answers `{"wake": true|false, "why": "…"}`.

- A no: the changes are kept on record (titles and links, as always) and nothing else happens.
- A yes: the usual check starts with those changes. They are marked as sorted, so they are never sorted twice.
- It fails open. No answer, an answer that can't be read, or a failed run all count as yes.
- Skipped for changes addressed to the person and for sites only the agent's own browser can see.
- Everything in the prompt that came from an app or a page is framed as outside data.
- `WISP_TRIAGE=off` turns sorting off (every batch goes straight to a check, as before).

A sort is a `runs` row of kind `triage`, so it shows in Usage under the agent's background work,
and counts against the allowances below, but not as a check.

## Limits, and what the person hears

All of these stop work cleanly: what was waiting keeps waiting, nothing is retried in a loop, and
the person gets **one** status line in the agent's chat.

| Limit | Default | Where |
|---|---|---|
| Checks a day, per agent and person | 24 | `background.daily_cap` |
| Tokens a day for one agent's unattended work | 500,000 | `background.daily_tokens` (null = default) |
| Tokens a day for all of a person's agents | 1,000,000 | the allowance in Settings → Usage |
| Follow-ups (promises) run past the first two, but stop at | 2 × the agent's token limit | `FOLLOWUP_HARD_STOP` |
| The plan the agent runs on | stops at 90% of a window; stops completely when the harness says the limit is reached | `limits.ts` |

### The plan comes first (`limits.ts`)

Each sign-in an agent runs on (a model connection, or a harness's own sign-in on a device) is
watched: the harness reports how full each of its windows is after every run, and a failed run is
read for "limit reached" in any harness's words (`limitProblem` in `@wisp/core`), with the reset
time when it gives one.

- At 90% of a window, work nobody asked for (checks, sorts) waits until that window resets, so the
  rest is the person's. Their own messages are still answered. An owner can move that line
  (`PUT /api/settings/agents { planReserve: 50–100 }`; 100 means only stop when the limit is reached).
- When the limit is reached, follow-ups wait too, and stay due. Nothing is tried again before the
  reset time (or, when the harness gave none, an hour, doubling to six).
- A reply the person asked for that fails this way says so in plain words, with when it's back.

## Tools that arrive late

Codex starts a turn without an MCP server that is slow to come up, and Wisp's own tool server can
take a long time to start on a busy or small computer (47 seconds was measured on a loaded Mac).
The agent then ran with no way to message, set a follow-up or ask for approval, and said so only in
its reply. Runs now mark Wisp's tool servers as required and give every tool server three minutes
to start (`required` and `startup_timeout_sec` for Codex, `MCP_TIMEOUT` for Claude Code): the run
waits for them, and fails loudly if they can't start.

## Proving it with a real model

`apps/hub/test/live/agents-work.live.ts` starts a hub in a throwaway folder and a device on this
computer, and plays four scenarios with a real harness and nobody answering: a watched page changes;
the agent keeps a promise; a team runs on its schedule; something needs permission. It prints, for
each, whether it worked, how long it took and the model calls and tokens it used.

```
npx tsx apps/hub/test/live/agents-work.live.ts            # Codex on its small model
npx tsx apps/hub/test/live/agents-work.live.ts watch      # one scenario
LIVE_HARNESS=claude-code LIVE_MODEL=haiku npx tsx apps/hub/test/live/agents-work.live.ts
```

`apps/hub/test/usage-day.test.ts` is the same idea without a model: three agents left alone for a
simulated day, counting the calls each makes.
