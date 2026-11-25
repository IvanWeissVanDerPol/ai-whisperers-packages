# Fleet self-check failure — diagnosis

**Card:** `t_5fd7a9d6` — "Fleet self-check failure" (filed 2026-11-25 16:13:52 -03:00)
**Host:** hermes — `hermes.paragu-ai.com`, tailnet `100.78.180.49`
**Self-check:** `/usr/local/bin/fleet-selftest.sh` (root:root 0755), `fleet-selftest.timer`, every 30 min
**Failing run:** 2026-11-25 16:13:18 → 16:13:52 -03:00 → FAIL, card filed 16:13:52
**Reported failure:** `fleet-doctor reported failures: FAIL  guards    heartbeat guard last run           exit 1`

## Summary

**The fleet is fine; the `hermes` *container* ran out of tasks.** A leaked pytest run inside the
container is holding **~7,850 of the container's 8,179 allowed tasks** (threads), so the kernel refuses
to start any new process in it. `docker exec` therefore fails with `EAGAIN`, the heartbeat guard's
functional probe cannot run, the guard exits 1, and the doctor faithfully reports the guard's exit
code — `FAIL guards heartbeat guard last run exit 1`.

This is **not** a missing heartbeat patch and **not** a fleet fault: the patch is present and
md5-identical to the host's copy, the dispatcher, the four worker nodes, the gateway key and the
board were all healthy in the same cycle. The failing check is the doctor observing a *symptom*
(the guard could not talk to the container) without naming the cause.

```
4 pytest-xdist workers leaked ~7,850 threads  ->  container cgroup pids.current 8178 / pids.max 8179
                                                 ->  clone() in the container returns EAGAIN
                                                 ->  runc cannot spawn stage-1 for `docker exec`
                                                 ->  hermes-heartbeat-guard.sh exits 1
                                                 ->  doctor: FAIL guards heartbeat guard last run exit 1
                                                 ->  self-check files a card
```

**Immediate remediation:** kill the runaway pytest tree from the host (§6, one command). **Fleet-level
fix:** contain task explosions in the container (a pids guard) and make the guard and the doctor report
the cause instead of a bare exit code (§6.2–§6.4).

## 1. The failing check, line by line

`/var/log/fleet-selftest.log`, the 16:13 cycle:

```
2026-11-25T16:13:16-03:00 ok: worker node hermes (127.0.0.1) answers on ssh
2026-11-25T16:13:16-03:00 ok: worker node wiseq-vps (100.107.160.19) answers on ssh
2026-11-25T16:13:16-03:00 ok: worker node beelink (100.85.215.6) answers on ssh
2026-11-25T16:13:16-03:00 ok: worker node victus (100.77.236.100) answers on ssh
2026-11-25T16:13:17-03:00 ok: gateway key authenticates (https://llm.paragu-ai.com)
2026-11-25T16:13:17-03:00 ok: board readable, no stuck leases
2026-11-25T16:13:19-03:00 ok: hub PR publisher (100.104.202.59) answers on ssh
2026-11-25T16:13:50-03:00 FAIL: fleet-doctor reported failures: FAIL  guards    heartbeat guard last run           exit 1
2026-11-25T16:13:51-03:00 ok: shared documents are intact (2 document(s))
2026-11-25T16:13:52-03:00 FAILURES (1): fleet-doctor reported failures: FAIL  guards    heartbeat guard last run           exit 1
2026-11-25T16:13:52-03:00 filed a card for the fleet to investigate
```

Everything a card needs was healthy in that same cycle. The doctor's check is:

```python
# /root/.hermes/fleet/fleet-doctor.py  (hub source: ~/Work/fleet/fleet-doctor.py)
rc, out, _ = sh("systemctl show hermes-heartbeat-guard.service -p ExecMainStatus --value")
status = out.strip()
record("guards", "heartbeat guard last run", "PASS" if status in ("0", "") else "FAIL",
       f"exit {status}" if status else "not run yet")
```

The doctor only reads the guard's **exit code**. It never asks *why* the guard failed — which is
exactly why this card's body says nothing more than `exit 1` and the whole diagnosis had to be
reconstructed from the guard's journal.

## 2. Why the guard exited 1

`/usr/local/bin/hermes-heartbeat-guard.sh` ends with a functional probe that runs **Python inside the
container**. That probe could not start:

```
16:04:36  OCI runtime exec failed: exec failed: unable to start container process: error executing
          setns process: exit status 1; runc init error(s): nsexec-0[1879909]: unable to spawn
          stage-1: Resource temporarily unavailable
16:09:46  OCI runtime exec failed: exec failed: unable to start container process: procReady not received
16:15:12  OCI runtime exec failed: ... unable to spawn stage-1: Resource temporarily unavailable
```

`EAGAIN` from `clone()` is the kernel's "no task slots left" answer. The guard's own log for the
same minutes:

```
16:04:35  ok: the patched file is bind-mounted from /root/.hermes/hermes-patches/kanban_db.py
16:04:36  the container's copy has drifted (container OCI, host 5f190f1d987429f6316170e2e1ed9292)
16:04:36  re-applying the patch from the host copy...
16:04:36  Error response from daemon: RemoveAll kanban_db.py: device or resource busy
16:04:36  FAIL: could not copy the patch into the container
16:04:36  FAIL: could not import hermes_cli.kanban_db inside the container
16:09:42  ok: the container's copy matches the host's (md5 5f190f1d987429f6316170e2e1ed9292)
16:09:46  FAIL: could not import hermes_cli.kanban_db inside the container
16:15:11  ok: the container's copy matches the host's (md5 5f190f1d987429f6316170e2e1ed9292)
16:15:12  FAIL: could not import hermes_cli.kanban_db inside the container
```

**Note the 16:04 line: `container OCI`.** The guard read a *checksum* of `OCI` — that is the first
word of the daemon's error text `OCI runtime exec failed: ...`, which reached the guard's stdout
capture (the guard only redirects stderr to `/dev/null`, and `cut -d' ' -f1` kept the first word).
So the guard mistook a failed probe for a **patch drift**, tried to repair it with `docker cp` into a
**bind-mounted** path (`docker cp` can never replace a bind-mounted file — hence `device or resource
busy`), and then reported a bogus "drift" for a file that was never broken. §6.3 fixes that.

The 16:19:37 run **passed** (`PASS: the heartbeat patch is in place`, `ExecMainStatus=0`): a window
with headroom opened between two thread bursts. The fault is therefore **intermittent and
marginal** — it recurs whenever the container is at its task ceiling, which is most of the time.

## 3. Root cause: the container is at its task ceiling

The container's cgroup (docker's systemd driver):

```
$ cat /sys/fs/cgroup/system.slice/docker-de3c8967fa1977f589c54ccb7920aa86513067ab53244211811878079050cc92.scope/pids.max
8179
$ cat .../pids.current
8178            <- 1 task of headroom
$ cat .../pids.events
max 640         <- at 16:20 ; 972 at 16:24 ; 1815 at 16:29 — the limit is being hit continuously
```

`pids.events:max` is the kernel's counter of **how many times the task limit was hit**. It is
already in the thousands, and it climbs by hundreds per minute. `pids.current` sits at the ceiling
and oscillates around it, which is why `docker exec` succeeds sometimes and fails minutes later.

The limit is **systemd's**, not Docker's: `docker inspect` reports `HostConfig.PidsLimit: null`, and
the scope's `TasksMax=8179` is exactly 15 % of the kernel's `threads-max=54529` — systemd's
`DefaultTasksMax` default. (This also means the limit applies to the *whole* container scope,
including the agent's own processes.)

### Who is consuming the 7,850 tasks

Four `pytest` **xdist workers**, each leaking thousands of threads:

```
$ ps -o pid,ppid,nlwp,etime,pcpu,rss,comm -p 1649649,1649678,1649703,1649708,1649712
    PID    PPID    NLWP     ELAPSED    %CPU     RSS COMMAND
1649649 1649635      5    03:56:24    0.1   29940 pytest
1649678 1649649   1358    03:56:19   11.9  562228 python
1649703 1649649   1391    03:56:18   11.3  716080 python
1649708 1649649   1381    03:56:17   10.0  738028 python
1649712 1649649   3719    03:56:16   46.7 1080128 python
```

Their parent chain:

```
$ tr '\0' ' ' < /proc/1649649/cmdline
/opt/data/work/saskia-app/.venv/bin/python /opt/data/work/saskia-app/.venv/bin/pytest tests/ -q --no-header --no-cov -n 4 -p no:cacheprovider --tb=no -rfE
$ tr '\0' ' ' < /proc/1649635/cmdline
uv run pytest tests/ -q --no-header --no-cov -n 4 -p no:cacheprovider --tb=no -rfE
```

All five processes live in the **container's** cgroup (`docker-de3c8967fa….scope`), were started at
**12:25:20 -03:00** and are still running ~4 hours later. `/opt/data` is the container's bind mount
of the host's `/root/.hermes`, so this is the `saskia-app` workspace at
`/root/.hermes/work/saskia-app` — a test suite that leaks a thread per iteration somewhere and never
stops. It is **not** a fleet card: the board shows exactly one running card, this one
(`t_5fd7a9d6`), plus `cancelled=4, done=36`.

Their RSS alone is **≈3.1 GB**, which is why the host is also thrashing:

```
$ free -m                       # 16:18
               total   used   free   shared  buff/cache  available
Mem:             7936   4988   1576        3        1681       2948
Swap:            5119   4818    301                     <- 94 % of swap in use
$ uptime
16:18:09 up 6 days, 18:50, 97 users, load average: 1509.86, 1271.44, 933.59   # 2 CPUs
$ cat /proc/pressure/cpu
some avg10=55.17 avg60=79.70 avg300=93.60
$ cat .../docker-….scope/memory.events
low 0  high 0  max 0  oom 0  oom_kill 2  oom_group_kill 0  sock_throttled 515374
```

Load 1509 on two CPUs, 94 % of swap consumed, two OOM kills already inside the container, and the
host's own CPU pressure at 55 % — **the whole host is starved by this one leaked test suite.** Every
other fleet activity on hermes (including this card's worker) is running on top of that.

## 4. What is *not* broken (verified during this run, read-only)

| thing | state | evidence |
| --- | --- | --- |
| heartbeat patch in the container | **present** | `docker exec hermes md5sum …` → `5f190f1d987429f6316170e2e1ed9292`, identical to the host's `/root/.hermes/hermes-patches/kanban_db.py` |
| patch bind mount | **intact** | `docker inspect` → `bind /root/.hermes/hermes-patches/kanban_db.py -> /opt/hermes/hermes_cli/kanban_db.py (rw=false)` |
| container | up, never recreated | `StartedAt=2026-11-24T21:20:18Z`, `Created=2026-11-24T21:20:07Z`, `Restarts=0`, image `nousresearch/hermes-agent:v0.23.2` |
| dispatcher | active | `systemctl is-active fleet-dispatcher.service` → `active` |
| worker nodes | all four answer on ssh | hermes, wiseq-vps, beelink, victus |
| gateway key | authenticates | `http 200` on `https://llm.paragu-ai.com/v1/models` |
| board | readable, 0 stuck leases | `stuck=0`, `cancelled=4`, `done=36` |
| hub PR publisher / shared documents | reachable / intact | 2 documents ok |

The heartbeat fix this guard protects is **in place**; the guard failed because it could not *ask*
the container anything.

## 5. Two defects, one symptom

1. **Trigger (external to the fleet):** a test suite in `/opt/data/work/saskia-app` leaks thousands
   of threads and eats the container's entire task budget. The fleet cannot fix another project's
   test suite, but it *can* stop the host from being taken down by it.
2. **Detection/response gap (the fleet's own):** the fleet has guards for disk (`hermes-disk-guard.sh`),
   tmpfs (`hermes-tmpfs-guard.sh`) and wedged greps (`fleet-wedge-reaper.sh`) — **but nothing that
   watches the container's task count**. So a thread leak runs for four hours, degrades the whole
   host, and the only thing that notices is a guard that fails for an unrelated-looking reason.

The doctor's wording hides all of it: `exit 1` says nothing about tasks, threads or the container.

## 6. Fix

The runtime files are **root-owned and live outside this repository** (`/usr/local/bin/hermes-heartbeat-guard.sh`,
`/etc/systemd/system/*`, `/root/.hermes/fleet/fleet-doctor.py`), and this run's rules forbid touching
anything outside the repository directory, so the fix below is specified as drop-in patches for a
root-capable operator. Nothing on the host was modified by this run.

### 6.1 Stop the bleed (immediate — one command, from the host as root)

`docker exec` cannot be used (that is the symptom), but the runaway processes are visible in the
**host** PID namespace, so kill them from the host:

```bash
# the 4 xdist workers + the pytest main process
pkill -TERM -f 'saskia-app/.venv/bin/pytest'
# the 'uv run pytest' wrapper
pkill -TERM -f 'uv run pytest'
sleep 5
pkill -KILL -f 'saskia-app/.venv/bin/pytest' 2>/dev/null || true   # if anything survived
```

Verify (all read-only):

```bash
C=/sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' hermes).scope
cat "$C/pids.current" "$C/pids.max"     # expect pids.current back to ~100-200 of 8179
systemctl start hermes-heartbeat-guard.service
systemctl show hermes-heartbeat-guard.service -p ExecMainStatus -p Result   # expect 0 / success
docker exec hermes md5sum /opt/hermes/hermes_cli/kanban_db.py               # expect 5f190f1d…
python3 /root/.hermes/fleet/fleet-doctor.py                                # expect FAIL: 0
```

Note: `pids.events:max` is a **cumulative** counter — it stays at 1815+ after the kill and must not
be read as "still broken". Judge health by `pids.current / pids.max`.

### 6.2 Contain task explosions in the container (the fleet-level fix)

Add a guard in the style of the existing ones (`hermes-disk-guard.sh`, `hermes-tmpfs-guard.sh`),
running every 5 minutes next to the heartbeat guard:

`/usr/local/bin/hermes-container-pids-guard.sh`

```bash
#!/usr/bin/env bash
# hermes-container-pids-guard.sh — keep the Hermes container's task budget free.
#
# Why this exists: the container's cgroup task limit is systemd's DefaultTasksMax
# (15 % of threads-max = 8179). One leaked pytest run held 7,850 of those tasks for
# four hours: the kernel refused to create any new task (EAGAIN), so `docker exec`
# failed, the heartbeat guard could not probe the container, and every other
# process on the host was starved by the resulting load (1509 on two CPUs, 94 % of
# swap in use). Nothing in the fleet watched the task count.
#
# It kills ONLY a process tree inside the container that is using an absurd share
# of the task budget (default: 400 threads) and that is not part of the Hermes
# agent's own services. It never touches the agent, the dispatcher or the worker.
set -uo pipefail

CONTAINER="${HERMES_CONTAINER:-hermes}"
THRESHOLD="${HERMES_PIDS_GUARD_THREADS:-400}"
HIGH_WATER="${HERMES_PIDS_GUARD_HIGH_WATER:-0.90}"
LOG=/var/log/hermes-container-pids-guard.log
log() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG" >&2; }

CGROUP=$(docker inspect "$CONTAINER" --format '{{.State.CgroupParent}}' 2>/dev/null)
[ -n "$CGROUP" ] || { log "FAIL: cannot read the cgroup of '$CONTAINER'"; exit 1; }
[ -r "$CGROUP/pids.max" ] || { log "FAIL: $CGROUP/pids.max is not readable"; exit 1; }

MAX=$(cat "$CGROUP/pids.max")
CUR=$(cat "$CGROUP/pids.current")
[ "$MAX" = "max" ] && { log "ok: the container has no task limit"; exit 0; }

if [ "$CUR" -lt $(( MAX * HIGH_WATER / 100 )) ]; then
  log "ok: task usage $CUR/$MAX is below the high-water mark"
  exit 0
fi

log "WARN: the container is at $CUR/$MAX tasks - looking for a runaway thread owner"

# docker top reads the daemon's view of the cgroup; it does not need to start a
# process inside the container, so it still works when the container is full.
docker top "$CONTAINER" -o pid,nlwp,comm 2>/dev/null \
  | awk -v THRESHOLD="$THRESHOLD" 'NR>1 && $2+0 > THRESHOLD {print $1, $2, $3}' \
  | while read -r pid threads cmd; do
    [ -n "$pid" ] || continue
    case "$cmd" in
      *hermes*|*gateway*|*s6-*|*python3*|uv) continue ;;   # never the agent's own services
    esac
    log "killing $pid ($cmd) which holds $threads threads"
    kill -TERM "$pid" 2>/dev/null || true
  done

sleep 5
NEW=$(cat "$CGROUP/pids.current")
log "task usage after the cleanup: $NEW/$MAX"
[ "$NEW" -lt $(( MAX * HIGH_WATER / 100 )) ] && log "PASS: the container has its task budget back"
exit 0
```

`/etc/systemd/system/hermes-container-pids-guard.service` + `.timer` (copy the heartbeat guard's
units; `OnCalendar=*:0/5`):

```ini
[Unit]
Description=Hermes container task-budget guard
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/hermes-container-pids-guard.sh
StandardOutput=journal
StandardError=journal
```

```ini
[Unit]
Description=Run the Hermes container task-budget guard every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=false

[Install]
WantedBy=timers.target
```

### 6.3 Make the heartbeat guard tell the truth (two latent bugs it hit today)

In `/usr/local/bin/hermes-heartbeat-guard.sh`:

**(a) The checksum must be validated, and the exec's exit code must be honoured.** A failed
`docker exec` put the literal string `OCI` into the checksum variable and produced a bogus "the
container's copy has drifted" line. Replace:

```bash
CUR_MD5=$(docker exec "$CONTAINER" md5sum "$CONTAINER_PATH" 2>/dev/null | cut -d' ' -f1)
if [ -z "$CUR_MD5" ]; then
  log "FAIL: cannot read $CONTAINER_PATH inside the container"
  exit 1
fi
```

with:

```bash
CUR_MD5=""
if exec_out=$(docker exec "$CONTAINER" md5sum "$CONTAINER_PATH" 2>&1); then
  case "$exec_out" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*)
      CUR_MD5="${exec_out%% *}" ;;
    *)
      log "FAIL: cannot read $CONTAINER_PATH inside the container: $exec_out"
      exit 1 ;;
  esac
else
  log "FAIL: cannot read $CONTAINER_PATH inside the container: $exec_out"
  exit 1
fi
```

**(b) Never `docker cp` into a bind-mounted path.** When the file is bind-mounted, the container's
copy *is* the host's file: a mismatch means the mount source changed, and `docker cp` can only fail
(`RemoveAll … device or resource busy`). Replace the drift/repair block with:

```bash
if [ "$CUR_MD5" != "$PATCH_MD5" ]; then
  if [ -n "$MOUNTED" ]; then
    log "FAIL: the container's copy of $CONTAINER_PATH does not match the mount source $MOUNTED"
    log "      (container $CUR_MD5, host $PATCH_MD5). The bind mount is in place, so the"
    log "      source file was changed - re-apply the patch on the host, not with docker cp."
    rc=1
  elif [ "$MODE" = "status" ]; then
    log "FAIL: the heartbeat patch is not in place and --status forbids repairing it"
    exit 1
  else
    log "re-applying the patch from the host copy..."
    if docker cp "$PATCH_FILE" "$CONTAINER:$CONTAINER_PATH" 2>>"$LOG"; then
      NEW_MD5=$(docker exec "$CONTAINER" md5sum "$CONTAINER_PATH" 2>/dev/null | cut -d' ' -f1)
      if [ "$NEW_MD5" = "$PATCH_MD5" ]; then
        log "ok: the patch was re-applied (md5 $NEW_MD5)"
      else
        log "FAIL: the patch did not take (container now $NEW_MD5)"
        rc=1
      fi
    else
      log "FAIL: could not copy the patch into the container"
      rc=1
    fi
  fi
else
  log "ok: the container's copy matches the host's (md5 $CUR_MD5)"
fi
```

**(c) Separate "the container cannot spawn processes" from "the helper is not patched".** The two
are different faults with different fixes; today they were both reported as the latter. Replace the
functional check's `else` branch with:

```bash
else
  case "$(cat /tmp/hbg-check.$$ 2>/dev/null)" in
    *"OCI runtime exec failed"*|*"Resource temporarily unavailable"*|*"procReady not received"*)
      log "FAIL: the container cannot start new processes (task limit or resource exhaustion)"
      log "      $(tail -1 /tmp/hbg-check.$$ 2>/dev/null)"
      log "      Check the container's cgroup: pids.current vs pids.max, and pids.events." ;;
    *)
      log "FAIL: the heartbeat helper could not be checked inside the container"
      cat /tmp/hbg-check.$$ >&2 2>/dev/null || true ;;
  esac
  rm -f /tmp/hbg-check.$$
  rc=1
fi
```

### 6.4 Make the doctor name the cause (so the next card is self-explanatory)

In `/root/.hermes/fleet/fleet-doctor.py`, the failing check reports only `exit 1`. Replace it with a
version that carries the guard's own last words, and add a check for the container's task headroom:

```python
rc, out, _ = sh("systemctl show hermes-heartbeat-guard.service -p ExecMainStatus --value")
status = out.strip()
if status in ("0", ""):
    record("guards", "heartbeat guard last run", "PASS", "exit 0" if status else "not run yet")
else:
    _, tail, _ = sh("tail -n 1 /var/log/hermes-heartbeat-guard.log")
    detail = tail.strip() or "no log line"
    record("guards", "heartbeat guard last run", "FAIL", f"exit {status}: {detail}")

# The container's task budget: the class of fault that makes every probe of the
# container fail at once (docker exec -> EAGAIN -> every guard exits 1).
rc, out, _ = sh("docker inspect hermes --format '{{.State.CgroupParent}}'")
cg = out.strip()
if cg:
    rc, out, _ = sh(f"cat {cg}/pids.max {cg}/pids.current")
    parts = out.split()
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
        mx, cur = int(parts[0]), int(parts[1])
        pct = int(cur * 100 / mx) if mx else 0
        record("guards", "container task headroom", "PASS" if pct < 90 else "FAIL",
               f"{cur}/{mx} tasks used ({pct} %)")
```

With §6.4, this card would have read
`FAIL guards heartbeat guard last run exit 1: FAIL: the container cannot start new processes
(task limit or resource exhaustion)` — the whole diagnosis in one line.

### 6.5 Still outstanding from the previous card (`t_4f03dfa9`, PR #42)

The doctor's container probe still treats a timed-out probe as "the patch is absent" (`count = out.strip() or "0"`),
and `fleet-selftest.sh` still writes `selftest.json` **only on PASS**, which is why this card quotes
the 15:43 green cycle (`checked_at 1795632223`) as the "last report" while the fleet was failing. Both
fixes are already specified in `FLEET-SELFTEST-REPORT.md` on PR #42 and are unaffected by this failure.

## 7. Current state — verified during this run

* the container is **saturated**: `pids.max 8179` with `pids.current` oscillating right at the
  ceiling (8178 at 16:20, 7933 at 16:21, 7951 at 16:29), `pids.events:max` climbing
  (640 → 972 → 1815 between 16:20 and 16:29);
* the heartbeat guard's last run at 16:19:37 happened to **PASS** (`ExecMainStatus=0`), so the check
  is green-or-red depending on the instant it is read — the next saturated window will fail it again;
* the board shows exactly one running card (`t_5fd7a9d6`), `stuck=0`, `cancelled=4`, `done=36`; the
  duplicate-suppression fingerprint (`/root/.hermes/fleet/selftest-failure.state`) still holds the
  16:13 failure string, so the next identical failure will **not** file a duplicate card for 6 hours;
* the runaway pytest tree is **still running** (§3) — the host is still at load ~1500 with 94 % of
  swap in use. Until it is killed, the fleet's probes of the container will keep failing at random.

**The fleet's own machinery is healthy; the `hermes` container is starved of tasks by a leaked test
suite, and the fleet has no guard that watches for that.**

## What this run changed

This repository (`IvanWeissVanDerPol__ai-whisperers-packages`) holds only the shared packages
monorepo (`ui/`, `tokens/`, `deploy/`); none of the runtime involved above lives in it. **The only
change in this working tree is this report** — no tracked file modified, no CI configuration,
workflow, secret or lockfile touched, nothing under `.git` touched, and no `git commit` / `git push` /
`gh` command run.

The diagnosis was made **read-only**: the board, the doctor, the guard and the container are
root-only, so the evidence was collected over the fleet's own SSH path (hermes → hub `100.104.202.59`
→ hermes `100.78.180.49`) with `docker inspect`/`docker top`/`docker exec`/`ps`/`cat`/`systemctl show`
only. **No host state was modified** — no process was killed, no file, service, cgroup limit or
container was touched.

## Evidence index

* `/var/log/fleet-selftest.log` — the 16:13 failing cycle, the green 15:43 cycle, the card filing.
* `journalctl -u hermes-heartbeat-guard.service` — 16:04:36 / 16:09:46 / 16:15:12 `OCI runtime exec
  failed` errors (`unable to spawn stage-1: Resource temporarily unavailable`, `procReady not
  received`) and the 16:19:37 passing run.
* `/var/log/hermes-heartbeat-guard.log` — `container OCI` drift, `docker cp` `device or resource
  busy`, `could not import hermes_cli.kanban_db inside the container`.
* `/usr/local/bin/hermes-heartbeat-guard.sh` — the checksum read that accepts `OCI` (§6.3a), the
  `docker cp` into a bind mount (§6.3b), the import probe (§6.3c).
* `/root/.hermes/fleet/fleet-doctor.py` — the `guards / heartbeat guard last run` check (line ~194)
  that reports only `exit 1`.
* `/sys/fs/cgroup/system.slice/docker-de3c8967fa….scope/pids.{max,current,events}` — 8179 / 8178 /
  `max 1815`.
* `ps -o pid,ppid,nlwp,etime,rss,comm` for pids 1649635, 1649649, 1649678, 1649703, 1649708, 1649712
  — the leaked pytest-xdist tree.
* `docker inspect hermes` — the read-only bind mount of the patch, `StartedAt=2026-11-24T21:20:18Z`,
  `image=nousresearch/hermes-agent:v0.23.2`, `HostConfig.PidsLimit: null`.
* `/root/.hermes/fleet/selftest.json` and `selftest-failure.state` — the stale `ok: true` status and
  the 6-hour duplicate fingerprint.
* `free -m`, `uptime`, `/proc/pressure/{cpu,memory}`, `…/memory.events` — the host-level impact.
