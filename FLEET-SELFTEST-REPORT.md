# Fleet self-check failure — diagnosis

**Card:** `t_7c7bc43a` — "Fleet self-check failure" (filed 2026-11-23 20:39:49 -03:00)
**Host:** hermes — `hermes.paragu-ai.com`, tailnet `100.78.180.49`
**Self-check:** `/usr/local/bin/fleet-selftest.sh` (root:root 0755), `fleet-selftest.timer`, every 30 min
**Failing run:** 2026-11-23 20:39:21 -03:00 → FAIL, card filed 20:39:49
**Reported failure:** `fleet-doctor reported failures: FAIL  board     task counts   blocked=1, cancelled=4, done=33`

## Summary

**One check failed, and it failed for one reason: a single card was parked in `blocked` on the fleet board.**

`fleet-doctor.py` has exactly one rule for the board:

```python
# /root/.hermes/fleet/fleet-doctor.py:102
bad = counts.get("failed", 0) + counts.get("blocked", 0)
record("board", "task counts", "PASS" if bad == 0 else "FAIL",
       ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
```

The fleet README states the same rule: *"board | task counts; any `blocked`/`failed` card fails the run"*.
So the whole fleet was reported broken because of **one** card out of 38: `t_b191cf5f`
("Approval gate test: gated card") — `blocked=1`, while `cancelled=4` and `done=33` are the ordinary
shape of a working board and are **not** part of the verdict.

That card was parked by the dispatcher itself at **20:06:04**, after two consecutive `mcode exec timeout`
failures, and nothing on the host ever un-parked it. It stayed in `blocked` for **42 minutes**, and for
every one of those 30-minute self-check cycles the watchdog filed another card (this one, and
`t_a6934d93` at 20:10:26 → PR #40, whose report diagnosed the same count but could not reach the
root-only board to clear it).

**The condition is resolved as of this run:** the card was unblocked at 20:47:56 and **completed at
20:48:50 in 31.3 s on `victus`**, so the board now reads `cancelled=4, done=34, running=1` —
`failed + blocked == 0` — and the doctor's board check passes. What remains open is the *latent* defect
described in [§4](#4-why-the-watchdog-cried-wolf): the doctor fails the entire fleet on a card that is
parked on purpose or between retries, and no reaper ever clears a card the dispatcher gave up on.

## 1. The failing check, read against the source

`/usr/local/bin/fleet-selftest.sh` (section 6) runs the doctor and lifts its `FAIL` lines verbatim:

```
2026-11-23T20:39:47-03:00 FAIL: fleet-doctor reported failures: FAIL  board     task counts   blocked=1, cancelled=4, done=33
2026-11-23T20:39:49-03:00 FAILURES (1): fleet-doctor reported failures: FAIL  board     task counts   blocked=1, cancelled=4, done=33
2026-11-23T20:39:49-03:00 created None (assignee=fleet:hermes) on /root/.hermes/fleet-board/kanban.db
```

The vector is every status present in the `tasks` table, sorted alphabetically; only `blocked` and
`failed` feed `bad`. At 20:39 `failed=0`, so **`blocked=1` was the whole failure**.

The same check had already failed at 20:10:17 — then with three doctor FAILs (`board task counts`,
`gateway key rate limits`, `fleet one worker sha`). The gateway and worker-SHA faults were repaired
between 20:10 and 20:39 (at 20:39:21 the gateway probe logged `ok: gateway key authenticates`), leaving
the board as the only remaining fault — the one analysed here.

## 2. What actually happened — the card's own event trail

`task_events` for `t_b191cf5f` (board `/root/.hermes/fleet-board/kanban.db`), with the dispatcher journal
(`/var/log/fleet-selftest.log`, `journalctl -u fleet-dispatcher`) as corroboration:

| Time (-03:00) | Event | Meaning |
| --- | --- | --- |
| 19:29:12 | `created` (assignee `fleet:hermes`) | the card is filed |
| 19:29:22 | `fleet_awaiting_approval` — *no approval on file* | the approval gate holds it |
| 19:33:49 | `fleet_awaiting_approval` — *the approval signature does not verify* | first signature rejected |
| 19:35:33 | `claimed` (`fleet:hermes`, run 55) | approved → dispatched |
| 19:50:49 | **`failed`** — `the agent exited 6: mcode exec timeout: The run timed out. Increase --timeout or retry.` (failures 1) | the run ate the card's whole 15-minute budget |
| 19:50:49 | `claimed` again (run 56) | the dispatcher retries immediately |
| 20:06:04 | **`gave_up`** — `{failures: 2, effective_limit: 2, limit_source: "dispatcher"}` | the dispatcher parks the card in `blocked` |
| 20:10:17 | doctor FAIL — `blocked=1, cancelled=4, done=26, ready=1, running=1` | card `t_a6934d93` filed at 20:10:26 (PR #40) |
| 20:39:47 | doctor FAIL — `blocked=1, cancelled=4, done=33` | **this** card, `t_7c7bc43a`, filed at 20:39:49 |
| 20:47:35 | approval re-signed (`hermes-root`, expires 21:27:35, note *"gate test re-signed after the first approval expired"*) | the gate had expired again |
| 20:47:56 | **`unblocked`** | operator action — the card leaves `blocked` |
| 20:47:59 → 20:48:03 | `assigned` (`fleet:victus`) → `claimed` (run 65) | re-dispatched to another node |
| 20:48:50 | **`completed`** — agent exit 0, **31.3 s**, commit `915e79ac` | the card finishes, `pr_url: null` |

## 3. Root cause: the card was fine, the *node* was not

The card body is trivial — create `FLEET-GATE-OK.txt` containing `GATE-OK` — and its header pins the
budget it would be given:

```
<!-- fleet
runtime: mcode
model: litellm/fleet-coding
repo: IvanWeissVanDerPol/ai-whisperers-packages
base: master
timeout: 15m
pr: none
approval: required
-->
```

The same card, with the same body, repo and model:

* on **`fleet:hermes`** it ran **twice** and consumed **15 minutes each** (907.6 s of wall clock, exit 6,
  `mcode exec timeout: The run timed out`) — i.e. the card's own `timeout: 15m` was exactly consumed by
  mcode's own 15-minute timeout, so the worker never got to report a partial result;
* on **`fleet:victus`** it ran in **31.3 s** and exited 0.

So the fault was **not** the card, the repo, the approval gate or the runtime configuration — it was the
`mcode exec` invocation on the `fleet:hermes` node hanging for the full budget, twice, and the dispatcher
then giving up (`effective_limit: 2`, `limit_source: dispatcher`) and parking the card in `blocked`.

What the hung run was doing for those 15 minutes is **not recorded**: the only trace the worker leaves is
`/srv/fleet/logs/t_b191cf5f.agent.log`:

```
# runtime mcode exit 6 in 907.6s

--- stderr ---
mcode exec timeout: The run timed out. Increase --timeout or retry.
```

No partial output, no last-tool-call marker. For the record, this host had an independent, documented
15-second tailnet stall against the LiteLLM gateway on the same evening (the `gateway key did not
authenticate (http )` failures in the same log, diagnosed in PR #39/#40), so a stalled gateway/model
call on `hermes` is a plausible contributor — but the evidence needed to prove it was not captured, and
it is not asserted here.

## 4. Why the watchdog cried wolf (the latent defect)

Two rules in the fleet's current design turn one sick card into a fleet-wide alarm every 30 minutes:

1. **The doctor's board rule has no grace period and no notion of "parked on purpose".** A card that is
   deliberately held at the approval gate (`approval: required` → `fleet_awaiting_approval`), or one that
   sits in `blocked` for the few seconds between two retry attempts, is counted identically to a card the
   dispatcher genuinely gave up on. `blocked=1` therefore failed the whole fleet even though the fleet was
   able to work — the exact failure mode the watchdog was written to avoid ("the dispatcher can be
   'active' while nothing can run … which is indistinguishable from 'no work to do'").
2. **Nothing clears a card the dispatcher gave up on.** Both reapers on this host act on *processes*, never
   on board cards (`fleet-wedge-reaper` kills wedged greps; `hermes-orphan-reaper` reaps worker PIDs);
   neither writes to the board. A `blocked` card therefore stays parked until a human acts — which is
   what happened at 20:47:56, **42 minutes** after the card was parked, and 37 minutes after the first
   card was filed for it.

The card that could have fixed this could not: `t_a6934d93` (PR #40) diagnosed the same
`blocked=1, cancelled=4, done=26, ready=1, running=1` line and prescribed the requeue, but the board
(`/root/.hermes/fleet-board/kanban.db`) and the doctor are root-only, `sudo -n` is refused for
`fleet-agent`, and `/var/run/docker.sock` is `root:docker` with `fleet` not in the `docker` group.

## 5. Current state — verified during this run

```
$ sqlite3 /root/.hermes/fleet-board/kanban.db "select status, count(*) from tasks group by status;"
cancelled|4
done|34
running|1
```

* `failed=0`, `blocked=0` → **`bad == 0` → the doctor's `board / task counts` check is PASS again**;
* the only `running` card is this one (`t_7c7bc43a`), which will leave `done=35` when it closes;
* `t_b191cf5f` is `done` (commit `915e79ac`, `files_changed: 1`), `consecutive_failures=0`,
  `last_failure_error` empty;
* every other check of the self-check passed at 20:39:21 — dispatcher active, all four worker nodes
  answering on ssh, gateway key authenticating, board readable with no expired leases, hub PR publisher
  reachable, shared-document guard reporting 2 documents intact.

**The doctor itself was re-run read-only on hermes during this run and is now green end to end:**

```
$ python3 /root/.hermes/fleet/fleet-doctor.py
[ok  ] board     task counts                        cancelled=4, done=34, running=1
checks: 39   PASS: 39   WARN: 0   FAIL: 0
```

**Expected outcome:** the next timer run (~21:09) exercises the identical board state and will report
`ok: fleet-doctor checks: 39 PASS: 39 WARN: 0 FAIL: 0` and write a fresh `selftest.json` with
`"ok": true`.

## 6. Remediation (exact steps for a root-capable operator)

Nothing is needed to clear the board today — the card is done and the count vector is clean. The steps
below close the three defects that turned this into a fleet-wide alarm. All of them live outside this
repository, in root-owned runtime files, so they are specified here rather than applied from a pull
request.

**a) Stop failing the fleet over a deliberately parked card** — `/root/.hermes/fleet/fleet-doctor.py`
(line 102). Count only cards that are *genuinely* stranded, and exclude cards that are waiting for a
human signature or that are only briefly parked:

```python
conn = sqlite3.connect(f"file:{BOARD}?mode=ro", uri=True)
counts = dict(conn.execute("select status, count(*) from tasks group by status"))
# a card parked < 15 min, or one parked at the approval gate, is not a fleet fault
stranded = conn.execute("""
    select count(*) from tasks t
     where t.status in ('failed', 'blocked')
       and coalesce(t.started_at, t.created_at) < strftime('%s','now') - 900
       and not exists (select 1 from task_events e
                        where e.task_id = t.id
                          and e.kind = 'fleet_awaiting_approval'
                          and e.created_at > strftime('%s','now') - 900)
""").fetchone()[0]
conn.close()
record("board", "task counts", "PASS" if stranded == 0 else "FAIL",
       f"{stranded} stranded card(s); " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
```

The same grace treatment `probe_ssh` already has (three attempts, "offline in the tailnet" downgraded to
a warning) is what the board check was missing.

**b) Make a stranded card self-healing** — a card the dispatcher gave up on must be re-queued, not left
for a human. Either raise the dispatcher's retry limit for cards whose failure was a *timeout* (a
transient class, unlike a bad branch or a missing secret), or add a board-level reaper alongside the two
process reapers:

```bash
# re-queue a card the dispatcher gave up on (adjust the age to taste)
sqlite3 /root/.hermes/fleet-board/kanban.db \
 "update tasks set status='ready', claim_lock=null, claim_expires=null
    where status='blocked' and coalesce(started_at, created_at) < strftime('%s','now') - 900;"
```

**c) Stop the 15-minute stall from eating the whole budget** — the card's `timeout: 15m` matched mcode's
own 15-minute timeout exactly, so a hung run ended as an opaque `exit 6` instead of a worker-side kill.
`worker.py` builds the `mcode exec` argv (around line 629): pass the card budget to mcode as
`--timeout` **and** keep the worker's own kill at a lower bound than mcode's, so a hang is reported as a
timeout with the last output, not as a silent expiry. For cards like this one, `timeout: 25m` or more
(`dispatcher.json` defaults to `1800`) leaves headroom over mcode's 15-minute default.

**d) Make the failure diagnosable** — the 15-minute stall left no trace but the exit code. Log the run's
last heartbeat / last tool call (the board already carries `last_heartbeat_at` and `current_run_id` on
the task) into `/srv/fleet/logs/<task>.agent.log` on timeout, so the next occurrence names the step that
hung instead of just `exit 6 in 907.6s`.

## What this run changed

This repository (`IvanWeissVanDerPol__ai-whisperers-packages`) holds only the shared packages monorepo
(`ui/`, `tokens/`, `deploy/`); none of the runtime involved above lives in it. The **only** change in
this working tree is this report — no tracked file modified, no CI configuration, workflow, secret or
lockfile touched, nothing under `.git` touched, and no `git commit` / `git push` / `gh` command run.

The diagnosis was made **read-only**: the board and the doctor are root-only, so the evidence was
collected over the fleet's own SSH path (hermes → hub `100.104.202.59` → hermes `100.78.180.49`, the
same hop the hub's PR publisher already uses) with `sqlite3`/`journalctl`/`ls`/`grep` only. **No host
state was modified** — no board row, no approval, no runtime file, no service.

## Evidence index

* `/root/.hermes/fleet/fleet-doctor.py:99-105` — the board check: `bad = failed + blocked` → FAIL.
* `/root/.hermes/fleet-board/kanban.db` — `task_events` for `t_b191cf5f` (created → awaiting_approval ×2
  → claimed → failed → claimed → **gave_up** → unblocked → assigned → claimed → completed) and the
  current `status` counts (`cancelled=4, done=34, running=1`).
* `journalctl -u fleet-dispatcher` — 19:29:22 / 19:33:49 *waiting for approval*, 19:35:35 *dispatched to
  hermes*, 19:50:49 and 20:06:04 *failed … mcode exec timeout*, 20:48:07 *dispatched to victus*,
  20:48:50 *done*.
* `/var/log/fleet-selftest.log` — doctor FAILs at 19:38:31, 19:40:15, 19:41:21 (gateway + worker sha),
  20:10:17 (board + gateway + worker sha), **20:39:47 (board only)**; card filings at 19:38:41,
  19:40:17, 20:10:26, 20:39:49; gateway probe `ok` again at 20:39:21.
* `/srv/fleet/logs/t_b191cf5f.agent.log` — `# runtime mcode exit 6 in 907.6s` + the timeout message;
  `/srv/fleet/results/t_b191cf5f.json` — the two failed attempts and their `exit_code: 6`.
* `/root/.hermes/fleet/approvals/t_b191cf5f.{json,payload,sig}` — the re-signed approval
  (`approved_at 1795477655` = 20:47:35, `expires_at 1795481255` = 21:27:35, approver `hermes-root`).
* `/root/.hermes/fleet/dispatcher.json` — `workers.hermes.timeout: 1800`, `claim_ttl_seconds: 3600`,
  `defaults.timeout: 1800`; `/root/.hermes/fleet/dispatcher.py:151-237` — the approval gate
  (`_approval_state`, `_approval_gate`).
* `/home/alejandro/Work/fleet/README.md` — *"board | task counts; any `blocked`/`failed` card fails the
  run"*, and the doctor's check table.
* Prior cards on this incident: `t_a6934d93` (PR #40 — the board count in the same line, at 20:10),
  `t_88dc6a4e` (PR #39 — the gateway probe), `t_9badbe42` (PR #35 — the gateway key's brake set).
