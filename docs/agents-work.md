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
| The agent asked to look again at a time (`next_check`) | A check at that time, whatever the hub can see | 1 full |
| Only notes changed in the memory it shares (other agents' memory passes write there) | A sort, then a check only on a yes | 1 small, sometimes 1 full |
| A connected app with no watch (Wisp can't see when it changes) | A check at the agent's pace, doubling up to 12 hours while quiet | a few a day at most |

## Sorting before a full check (`triage.ts`)

A full check wakes the agent with all its tools, its memory and its notes. With Codex on its small
model that measured 47,000 to 190,000 tokens per check, whether or not the change mattered. So a
batch of changes first goes to the harness's smallest model (`smallestModel` in `@wisp/core`) as a
**bare run**: a few lines, no Wisp tools, no browser, no connectors, read-only, low effort. It
answers `{"wake": true|false, "why": "…"}`.

- A no: the changes are kept on record (titles and links, as always) and nothing else happens.
- A yes: the usual check starts with those changes. They are marked as sorted, so they are never sorted twice.
- It fails open. No answer, an answer that can't be read, a failed run, or no answer within ten minutes all count as yes.
- A yes still obeys what holds any check: the plan, the day's limits, quiet hours, background work turned off. A sort
  that failed because the plan ran out does not start a check that would fail the same way. The changes wait, already
  sorted, and go out when the hold ends.
- What it decided is kept with the run ("no: a small edit") and shows in the agent's activity list.
- Skipped for changes addressed to the person and for sites only the agent's own browser can see.
- Everything in the prompt that came from an app or a page is framed as outside data.
- `WISP_TRIAGE=off` turns sorting off (every batch goes straight to a check, as before).

A sort is a `runs` row of kind `triage`, so it shows in Usage under the agent's background work,
and counts against the allowances below, but not as a check.

## When a check fails (`Background.failed`)

A failed check isn't a look, and what it carried isn't lost.

- Its changes go back in line (previews kept, not sorted again) and the follow-ups it was woken for are due again.
- It is tried up to three times, 15 minutes and then an hour apart. The person hears on the first failure, once.
- After the third failure it gives up, says what wasn't done (the follow-ups and changes, by name), and rests six
  hours. A reply that works ends the rest: the harness is fine again.
- A failure isn't a quiet check, so the wait between regular checks doesn't stretch.
- When the failure is the plan's limit it doesn't count as a try: the plan's pause decides when, and says so itself.
- The first look at its computer only counts when it worked (`background.looked_at`). Agents from before this owe
  that look once.

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

**How tokens are counted** (`spentTokens` in `@wisp/core`): fresh input and output in full, input
read from the harness's cache at a tenth (`CACHED_INPUT_WEIGHT`), about what plans charge for it.
Harnesses report every turn's whole context as input, so a check that takes ten turns re-reads the same
prefix ten times; counting that in full made one quiet Codex check-back (283k read, 259k of it cached,
about 26k really new) look like 28% of the day. The Usage page counts the same way.

**The "on pace to run out" line** says something only when it's real: at least 40% of the day's
allowance is used, at least 3 runs in the last 3 hours of today and at least 2 hours of the day gone
(never a projection from one run or from the minutes after midnight), and that pace would use the rest
before midnight. Once a day, not in quiet hours (10pm–7am when the agent has no settings of its own).

### The plan comes first (`limits.ts`)

Each sign-in an agent runs on (a model connection, or a harness's own sign-in on a device) is
watched: the harness reports how full each of its windows is after every run, and a failed run is
read for "limit reached" in any harness's words (`limitProblem` in `@wisp/core`), with the reset
time when it gives one.

- At 90% of a window, work nobody asked for (checks, sorts) waits until that window resets, so the
  rest is the person's. Their own messages are still answered. An owner can move that line
  (`PUT /api/settings/agents { planReserve: 50–100 }`; 100 means only stop when the limit is reached).
- When the limit is reached, follow-ups wait too, and stay due. Nothing is tried again before the
  reset time (or, when the harness gave none, an hour, doubling to six). A reset more than about a
  week away isn't believed.
- Memory passes are work nobody asked for too: they wait for the plan and for the agent's own tokens,
  and keep what they had to save.
- A scheduled routine or a team's scheduled run is skipped while the limit is reached (it would only
  fail), with one line where it would have run. A new agent's hello falls back to Wisp's plain one.
- The pause is said once per sign-in until it is over, however often runs fail and however the reset
  time the harness reports moves; again only when "leaving you the rest" becomes "the limit is reached".
- Changes waiting for a paused plan are kept up to two weeks (others go after two days, as before).
- A reply the person asked for that fails this way says so in plain words, with when it's back on
  their own clock.
- Only the plan's own limit counts: a full disk, a model's context window, or another service's
  rate limit (a connected app answering 429) isn't read as one.

## Tools that arrive late

Codex starts a turn without an MCP server that is slow to come up, and Wisp's own tool server can
take a long time to start on a busy or small computer (47 seconds was measured on a loaded Mac).
The agent then ran with no way to message, set a follow-up or ask for approval, and said so only in
its reply. For Codex, Wisp's own tool server is now `required` and every tool server gets three
minutes to start (`startup_timeout_sec`): the run waits for Wisp's tools and fails loudly if they
can't start. A browser or connector that can't start doesn't fail the run. Claude Code only gets the
longer wait (`MCP_TIMEOUT`); it has no "required" setting, and this wasn't run with Claude Code.

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

`apps/hub/test/usage-day.test.ts` is the same idea without a model: four agents left alone for a
simulated day, counting the calls each makes.
