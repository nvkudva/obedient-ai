---
name: analyze-coding-agent-logs
description: >
  Audit a coding agent's own session logs for failures, repeated work, wasted calls and lost time.
  Ships a working adapter for OpenCode's SQLite store and for Claude Code JSONL transcripts, and
  points at the Codex and T3 Code stores.
  Produces ranked findings with counts, and a fixed-cutoff baseline you can re-run later.
  Use when the user asks to analyse agent logs, review tool usage, find tool failures or tool
  repetition, audit latency or token waste, or compare agent behaviour before and after a change.
---

# Analyze coding agent logs

Count first, then explain. Never eyeball transcripts and call it an audit — every claim needs a
number and the query that produced it.

## 1. Find the store

| Agent | Path | Shape | Adapter |
|---|---|---|---|
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite, `session_message` | `queries/opencode.sql` |
| OpenCode legacy | same DB, `part` table | SQLite, frozen at the v1→v2 migration | none |
| Claude Code | `~/.claude/projects/<slug>/<uuid>.jsonl` | one JSON object per line | `queries/claude-code.sql` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL, shape varies by version | none, verify before use |
| T3 Code | `~/.t3/userdata/statev2.sqlite` | SQLite, `orchestration_v2_events` + `projection_*` | none, inspect first |

`ls` the path before trusting it. These move between versions, and a missing store is a finding,
not a reason to guess a schema. Do not ship an adapter for a store you have not run against real
data — an unverified one produces confident, wrong numbers.

T3 and Codex rows are deliberately adapter-free: both were checked on this machine and their
tool-call shape did not match the two shipped adapters.

## 2. Normalize to one shape

Every analysis runs on the same columns, whatever the source:
`session, ts, tool, status, input, duration_ms, error, exit_code`.

Adapters for the two common shapes:

- SQLite + JSON parts → `queries/opencode.sql`
- JSONL with `message.content[]` → `queries/claude-code.sql`

Run the adapter for each agent present, then the analyses below against the `t` view it creates.
Both adapters were run end to end before shipping; if one returns zero rows, the store changed
shape — report that instead of adjusting the query until numbers appear.

## 3. The six analyses

1. **Call mix.** Count by tool, share of total, error count. This sets the ceiling on any other win —
   optimising a tool that is 0.5% of calls is worthless.
2. **Failures.** Group by `tool` and error class. Bucket anything matching
   `No tool named` → tool-name guess, `Could not find oldString` → edit anchor miss,
   `identical` → no-op edit, `File not found` → path guess. Unbucketed failures are not actionable.
3. **Repetition.** Same `session` + same `input` → wasted calls. Report per tool, and separately
   the count that occurred inside a single turn (same `msg_created`), because those are dispatched
   in parallel and cost context twice.
4. **Latency.** p50 and p95 per tool. Never report an average alone: one 10-minute outlier hides a
   0.2 s p50 and looks like a systemic problem.
5. **Silent failures.** Shell calls with `exit_code <> '0'` but `status = 'completed'`. These are
   wasted round trips the model never saw as errors, and they are invisible in every error count.
6. **Infra noise.** Grep the agent's own log for `mcp connect failed`, `failed to load plugin`,
   `failed to fetch`, `rate limit`. Each is startup latency or a retry the user paid for.

## 4. Traps that produce wrong conclusions

- **Per-call duration is not turn duration.** If a turn dispatches many tools at once, every call
  inherits the turn's wall clock. Check for clusters sharing one start second before blaming a tool.
  A "slow read" that is 99% of a p95 is usually one stalled turn.
- **Sliding windows destroy before/after.** `now() - 15 DAY` mixes pre- and post-change data. Pin a
  literal cutoff at the moment of the change and compare fixed windows.
- **A stored timestamp is not a duration.** OpenCode tool parts moved from `time.start/end` to
  `time.created/completed`; a query reading only the old fields returns NULLs, not errors.
- **`status = 'completed'` does not mean success** for shell calls. See analysis 5.
- **Legacy and current tables coexist.** In OpenCode, `part` stops at the v1→v2 migration while
  `session_message` continues. Reading only `part` silently truncates the audit to old data.
- **Duplicate calls are not always waste.** A re-read after an edit is correct. Only count a
  duplicate as waste when nothing modified the file between the two calls.

## 5. Report

Rank by wasted calls or wasted minutes, not by category order. For each finding give:

- what happened, with the count
- the mechanism, in one sentence
- the fix, and whether it is a prompt rule, a config change, or code

Then state the baseline numbers and the one-line change needed to re-run the audit later. Without
that, the next audit has nothing to compare against.

Do not report model/token cost unless the store has it. Do not infer cost from call counts.

## 6. Finish

Write the adapter SQL and the baseline output to `$SCRATCH` or the repo's `tools/`, not to the repo
root. A Python or SQL snippet run twice belongs in a file. State plainly which agents were audited,
which were skipped and why, and the window covered.
