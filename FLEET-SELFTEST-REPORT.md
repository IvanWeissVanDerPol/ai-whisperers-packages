# Fleet self-check failure — diagnosis

**Card:** `t_4f03dfa9` — "Fleet self-check failure" (filed 2026-11-25 14:45:07 -03:00)
**Host:** hermes — `hermes.paragu-ai.com`, tailnet `100.78.180.49`
**Self-check:** `/usr/local/bin/fleet-selftest.sh` (root:root 0755), `fleet-selftest.timer`, every 30 min
**Failing run:** 2026-11-25 14:43:15 → 14:45:06 -03:00 → FAIL, card filed 14:45:07
**Reported failure:** `fleet-doctor reported failures: FAIL  container heartbeat patch present            0 occurrence(s)`

## Summary

**The heartbeat patch was never missing. The check failed because its probe timed out, and the doctor
turns a probe that returned nothing into "0 occurrence(s)" — a hard FAIL.**

`fleet-doctor.py` reads the container's patched file with a `docker exec`, under a hard **30-second**
timeout:

```python
# /root/.hermes/fleet/fleet-doctor.py  (same file on the hub: ~/Work/fleet/fleet-doctor.py)
def sh(cmd, timeout=30):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
...
rc, out, _ = sh("docker exec hermes grep -c 'last_heartbeat_at = ?' "
                "/opt/hermes/hermes_cli/kanban_db.py")
count = out.strip() or "0"
record("container", "heartbeat patch present", "PASS" if count.isdigit() and int(count) >= 1 else "FAIL",
       f"{count} occurrence(s)")
```

On timeout `sh()` returns `(124, "", "timeout")`; `out` is empty; `count` becomes the **string** `"0"`;
the check FAILs with the detail `0 occurrence(s)`. The exit status is discarded, so **"the probe did not
answer" and "the patch is not there" are the same verdict**, and the second one is a lie.

At 14:43 on hermes, `docker exec` was answering in **minutes**, not seconds (measured below), so the
30-second budget expired while the patch sat in the container, correctly, the whole time. The very same
moment is covered by the heartbeat guard's own log, which is the proof that the patch was present:

```
14:43:29  ok: the patched file is bind-mounted from /root/.hermes/hermes-patches/kanban_db.py
14:45:03  ok: the container's copy matches the host's (md5 5f190f1d987429f6316170e2e1ed9292)
14:45:14  ok: the heartbeat helper is patched (/opt/hermes/hermes_cli/kanban_db.py)
14:45:14  PASS: the heartbeat patch is in place and the container is on nousresearch/hermes-agent:v0.23.2
```

The guard's `docker exec` calls in that same window took **94 s** (14:43:29 → 14:45:03) and, at
14:28:20 → 14:31:24, **184 s**. The doctor's identical call was given 30 s.

**This is a false positive.** The card is not reporting a fleet fault; it is reporting that the doctor
asked a loaded host a question with too short a deadline.

## 1. The failing run, line by line

`/var/log/fleet-selftest.log`, the 14:43 cycle — note that the previous cycle was green and fast, and
that this cycle took **111 s instead of 25 s**:

```
2026-11-25T14:13:32-03:00 ok: fleet-doctor checks: 39   PASS: 39   WARN: 0   FAIL: 0     <- previous cycle: 25 s
2026-11-25T14:13:32-03:00 PASS: fleet is able to work
2026-11-25T14:43:18-03:00 ok: board readable, no stuck leases
2026-11-25T14:43:18-03:00 ok: hub PR publisher (100.104.202.59) answers on ssh
2026-11-25T14:45:04-03:00 FAIL: fleet-doctor reported failures: FAIL  container heartbeat patch present            0 occurrence(s)
2026-11-25T14:45:06-03:00 ok: shared documents are intact (2 document(s))
2026-11-25T14:45:06-03:00 FAILURES (1): fleet-doctor reported failures: FAIL  container heartbeat patch present            0 occurrence(s)
2026-11-25T14:45:07-03:00 filed a card for the fleet to investigate
```

Every other check of the doctor passed in that same run — 39 checks, one FAIL, and that one FAIL is the
only check in the whole doctor whose result depends on a **remote `docker exec` returning inside 30 s**:

| doctor check | how it is measured | result in the failing run |
| --- | --- | --- |
| `container / image` | `docker inspect` (local, fast) | PASS |
| `container / patch bind-mounted` | `docker inspect` (local, fast) | PASS |
| `container / running` | `docker ps` (local, fast) | PASS |
| `host tree / heartbeat fix present` | reads the file on disk, `text.count()` | PASS |
| `guards / heartbeat guard timer` + `last run` | `systemctl show` | PASS |
| **`container / heartbeat patch present`** | **`docker exec` under a 30 s timeout** | **FAIL "0 occurrence(s)"** |

`host tree / heartbeat fix present` passed in the same run and it counts the *same marker*
(`last_heartbeat_at = ?`) in the host's git tree — 5 occurrences in
`/root/.hermes/hermes-agent/hermes_cli/kanban_db.py`. The patch was not missing anywhere.

## 2. The container's state, verified directly during this run

Everything below was read over the fleet's own path (hermes → hub `100.104.202.59` → hermes
`100.78.180.49`), read-only:

```
$ docker exec hermes grep -c 'last_heartbeat_at = ?' /opt/hermes/hermes_cli/kanban_db.py
1

$ docker inspect hermes --format '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}} (rw={{.RW}}){{println}}{{end}}'
bind /root/.hermes -> /opt/data (rw=true)
bind /root/.hermes/hermes-patches/kanban_db.py -> /opt/hermes/hermes_cli/kanban_db.py (rw=false)   <- the patch, read-only
bind /root/.hermes/.local/python-libs/tracekit -> /opt/hermes/.venv/lib/python3.14/site-packages/tracekit (rw=false)
...

$ md5sum /root/.hermes/hermes-patches/kanban_db.py
5f190f1d987429f6316170e2e1ed9292
$ docker exec hermes md5sum /opt/hermes/hermes_cli/kanban_db.py
5f190f1d987429f6316170e2e1ed9292          <- byte-identical: the container IS the host's patched file

$ docker inspect hermes --format 'started={{.State.StartedAt}} created={{.Created}} image={{.Config.Image}}'
started=2026-11-24T21:20:18.318394112Z created=2026-11-24T21:20:07.821980805Z image=nousresearch/hermes-agent:v0.23.2
```

* the patch is **bind-mounted read-only from the host**, so a recreate cannot lose it (the durable fix
  of 2026-11-23);
* the container has been up **unchanged since 2026-11-24 18:20 -03:00** — no recreate, no restart, no
  window in which the patch could have been lost;
* `grep -c` returns **1** (the marker sits on one line), which is exactly the `int(count) >= 1` the
  doctor requires → the check would PASS had the probe answered.

## 3. How slow was `docker exec`? (measured, not assumed)

* the guard's `docker exec hermes md5sum ...` took **94 s** across the failing window
  (14:43:29 → 14:45:03) and **184 s** at 14:28:20 → 14:31:24;
* the failing doctor cycle took **111 s** where the same cycle took **25 s** an hour earlier;
* while writing this report, the same `docker exec` needed **more than 90 s** to answer on this host
  (measured with `timeout 90`; it was killed before it printed), while the identical command had
  returned `1` a few minutes earlier.

The doctor's budget for that call is 30 s. It was never going to be met.

**Why the host was slow:** the container runs the whole Hermes agent, and the exec path
(`docker exec` → runc → the container's Python) competes with the fleet's own workload on the same
host — this card's own worker was starting at 14:45 on hermes, the dispatcher polls every 15 s, and the
guard timer runs every 5 min. The doctor's 30 s is the **tightest deadline in the whole fleet**: every
other probe in the same file is more forgiving (`probe_ssh` retries 3× with a 10 s connect timeout,
the gateway probe allows 15 s, `tailscale status` allows 20 s, the doctor itself is given 300 s by the
self-check). The container patch check is the only one with no margin and no retry.

## 4. This failure has occurred before — and the two occurrences are different

`grep "heartbeat patch present" /var/log/fleet-selftest.log` returns exactly two hits:

| when | what it was |
| --- | --- |
| 2026-11-23 18:09:46 | **a real fault.** A forced recreate *without* the bind mount lost the patch; the container's file was the pristine v0.23.2 original, so `grep -c` genuinely returned `0`. The guard re-applied the patch and the doctor went green again. This is the episode the fleet README documents. |
| 2026-11-25 14:45:04 | **a false positive.** The patch was in place (§2). The probe timed out. |

Because both failures produce the **same detail string** (`0 occurrence(s)`), the self-check's
duplicate-suppression fingerprint (`/root/.hermes/fleet/selftest-failure.state`, 6 h window) cannot tell
them apart: a genuine regression and a transport timeout are filed as the same card.

## 5. Root cause

`fleet-doctor.py` conflates three different states into one verdict:

```
docker exec fails / times out  ─┐
docker exec runs, grep finds 0 ─┼─►  count = "0"  ─►  FAIL "0 occurrence(s)"
docker exec runs, grep finds 1 ─┘
```

The `rc` returned by `sh()` — which *does* distinguish the three (0 = grep ran, 124 = timeout,
non-zero = docker error) — is thrown away. The check is therefore not a check of the container at all
under load: it is a check of whether `docker exec` answers within 30 seconds, reported under the name of
a patch check.

## 6. Fix (root-capable operator — the files live outside this repository)

### a) Make the container check distinguish "absent" from "could not tell"

In `/root/.hermes/fleet/fleet-doctor.py` (and the hub's `~/Work/fleet/fleet-doctor.py`, which is its
source), replace the bare `sh(...)` call with a probe that retries, allows a realistic deadline, and
reports *why* it failed:

```python
def container_patch_count(path="/opt/hermes/hermes_cli/kanban_db.py", attempts=3):
    """(count, error). count is None when the probe could not be completed."""
    err = ""
    for attempt in range(attempts):
        rc, out, e = sh(f"docker exec hermes grep -c 'last_heartbeat_at = ?' {path}", timeout=120)
        if rc == 0 and out.strip().isdigit():
            return int(out.strip()), ""
        err = e or out or f"exit {rc}"
        if attempt < attempts - 1:
            time.sleep(5)
    return None, err

count, err = container_patch_count()
if count is None:
    record("container", "heartbeat patch present", "WARN",
           f"could not probe the container ({err}) - the check was inconclusive")
else:
    record("container", "heartbeat patch present", "PASS" if count >= 1 else "FAIL",
           f"{count} occurrence(s)")
```

`time` is already imported in the doctor; `sh()` already supports a per-call timeout. The change is
three lines of behaviour: **retry, a deadline that matches reality (120 s), and an inconclusive probe
is a WARN, not a FAIL.** A patch that really is absent still FAILs with `0 occurrence(s)` — and the
guard's own check (`guards / heartbeat guard last run`, plus `container / patch bind-mounted`) stays the
authoritative "is the patch really there" signal, so nothing is lost by not failing on a timeout.

### b) Make the doctor's verdict match the guard's verdict

The patch's real state is already proven twice per hour by `hermes-heartbeat-guard.sh`
(`docker exec … md5sum` vs the host's file, plus the functional `PATCHED`/`NOT PATCHED` check). The
doctor's container check duplicates that work with a tighter deadline. Either raise the deadline as in
(a), or have the doctor read the host's patch file (the container's copy *is* that file, by the
bind-mount) and use the `docker exec` only to confirm the mount — the mount is already confirmed by
`docker inspect` in the check above.

### c) Stop the status file from lying while the fleet is broken

`/usr/local/bin/fleet-selftest.sh` writes `/root/.hermes/fleet/selftest.json` **only on PASS** (the
failure branch exits 1 without rewriting it). That is why this card's body quotes

```json
{ "ok": true, "checked_at": 1795626814, ... }
```

— `checked_at` is 2026-11-25 14:13:34, the **last passing** cycle, while the run that filed the card
failed. Any monitor that reads `selftest.json` sees `ok: true` during an outage. Write the file on the
failure path too, with `"ok": false` and the failure list:

```bash
# in the failure branch of fleet-selftest.sh, before "log \"FAILURES (...)\""
python3 - "$STATUS_FILE" "$board_info" "${failures[@]}" <<'PY'
import json, sys, time
path, board, *fails = sys.argv[1:]
try:
    b = json.loads(board)
except Exception:
    b = {}
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump({"ok": False, "checked_at": int(time.time()), "failures": fails, "board": b}, fh, indent=1)
os.replace(tmp, path)
PY
```

### d) Give the failure fingerprint the distinction it needs

With (a) in place, "the probe could not answer" and "the patch is gone" are different strings, so the
self-check's 6-hour duplicate suppression (`/root/.hermes/fleet/selftest-failure.state`) stops treating a
regression as a repeat of a timeout.

## 7. Current state — verified during this run

* the container's patch: **present** (`grep -c` → 1), **bind-mounted** from
  `/root/.hermes/hermes-patches/kanban_db.py` (read-only), **md5-identical** to the host's file
  (`5f190f1d987429f6316170e2e1ed9292`);
* the container: up and unchanged since 2026-11-24 18:20 -03:00, on the published image
  `nousresearch/hermes-agent:v0.23.2` (no downgrade);
* the heartbeat guard: timer `enabled` + `active`, last run `ExecMainStatus=0`, `Result=success`, logging
  `PASS: the heartbeat patch is in place` every 5 minutes;
* the host tree: 5 occurrences of the marker in
  `/root/.hermes/hermes-agent/hermes_cli/kanban_db.py` — the doctor's `host tree` check passes;
* every other check of the self-check passed in the failing cycle (dispatcher active, four worker nodes
  answering on ssh, gateway key authenticating, board readable with no stuck leases, hub PR publisher
  reachable, shared documents intact);
* the board is clean: `cancelled=4, done=35`, `stuck=0`, `failed=0`, `blocked=0`.

**Nothing is broken on hermes right now.** The one FAIL was the doctor's 30-second probe deadline, not
the fleet. The next timer cycle exercises the same state and will report
`ok: fleet-doctor checks: 39 PASS: 39 WARN: 0 FAIL: 0` as long as `docker exec` answers inside 30 s —
which is exactly the condition that must not be assumed.

## What this run changed

This repository (`IvanWeissVanDerPol__ai-whisperers-packages`) holds only the shared packages monorepo
(`ui/`, `tokens/`, `deploy/`); none of the runtime involved above lives in it. The **only** change in
this working tree is this report — no tracked file modified, no CI configuration, workflow, secret or
lockfile touched, nothing under `.git` touched, and no `git commit` / `git push` / `gh` command run.

The diagnosis was made **read-only**: the board, the doctor and the container are root-only, so the
evidence was collected over the fleet's own SSH path (hermes → hub `100.104.202.59` → hermes
`100.78.180.49`) with `docker inspect`/`docker exec`/`grep`/`md5sum`/`journalctl` only. **No host state
was modified** — no board row, no container file, no runtime file, no service.

## Evidence index

* `/var/log/fleet-selftest.log` — the failing cycle (14:43:15 → 14:45:06), the green cycle before it
  (14:13:32, 39 PASS), and the two occurrences of this exact failure line (2026-11-23 18:09:46 — real;
  2026-11-25 14:45:04 — false positive).
* `/var/log/hermes-heartbeat-guard.log` — the overlapping window 14:43:29 / 14:45:03 / 14:45:14
  (bind-mount ok, md5 match, helper patched, PASS), plus the 94 s and 184 s `docker exec` latencies.
* `/root/.hermes/fleet/fleet-doctor.py` (hub copy: `~/Work/fleet/fleet-doctor.py`) — `sh(timeout=30)`
  returning `(124, "", "timeout")`, and `count = out.strip() or "0"` discarding `rc`.
* `/root/.hermes/hermes-patches/kanban_db.py` and the container's
  `/opt/hermes/hermes_cli/kanban_db.py` — md5 `5f190f1d987429f6316170e2e1ed9292`, `grep -c` → 1.
* `/root/.hermes/hermes-agent/hermes_cli/kanban_db.py` — 5 occurrences of `last_heartbeat_at = ?`.
* `docker inspect hermes` — the read-only bind mount of the patch, `started=2026-11-24T21:20:18Z`,
  `image=nousresearch/hermes-agent:v0.23.2`.
* `/usr/local/bin/fleet-selftest.sh` — section 6 (runs the doctor, lifts its FAIL lines verbatim) and
  the failure branch (writes the status file only on PASS → §6c).
* `/usr/local/bin/hermes-heartbeat-guard.sh` — the repair mechanism that *was* working during the
  failing window.
* `/home/alejandro/Work/fleet/README.md` (hub) — "The container's heartbeat patch now survives a
  recreate (2026-11-23, evening)", which documents the earlier, genuine occurrence of this failure.
