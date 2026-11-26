# Fleet self-check failure — diagnosis

**Card:** fleet self-check on hermes · **Host:** hermes (`hermes.tail9cb0c1.ts.net`)
**Self-check:** `/usr/local/bin/fleet-selftest.sh`, run by `fleet-selftest.timer` every 30 min
**Failing run:** 2026-11-23 18:09:16 → 18:09:49 (-03:00) · **Last good run:** 17:46:44 (-03:00)
**Failing check:** `FAIL  container heartbeat patch present            0 occurrence(s)`

## Summary

The failure is **not** a broken fleet — it is a **real, but self-healing, durability defect in the
`hermes` container**, observed at exactly the wrong moment.

The `hermes` container was **recreated** at ~18:09 from the published image
`nousresearch/hermes-agent:v0.23.2`, which does **not** contain the heartbeat patch, and the
recreate did not carry the durable bind mount
`/root/.hermes/hermes-patches/kanban_db.py → /opt/hermes/hermes_cli/kanban_db.py`.
`fleet-doctor.py` ran inside that window, counted **0 occurrences** of the heartbeat marker in
the container's `kanban_db.py`, and reported a FAIL, which the self-check turned into a card.

`hermes-heartbeat-guard.sh` repaired the container's copy at 18:09:24, and the next run of the
self-check — started by hand at 18:10:39 — passed everything:

```
2026-11-23T18:11:10-03:00 ok: fleet-doctor checks: 33   PASS: 33   WARN: 0   FAIL: 0
2026-11-23T18:11:14-03:00 PASS: fleet is able to work
```

So the fleet was able to work; the alarm was a **true observation of a genuine hole** (the
heartbeat fix lives in the container's writable layer, so any recreate drops it) surfaced at the
worst possible time. The hole is still there — the next recreate will open it again.

## Which check failed, and where it comes from

`fleet-doctor.py` was wired into the self-check on 2026-11-23 at 17:40 (section 6 of the script;
compare `/usr/local/bin/fleet-selftest.sh.bak-20261123-174008` with
`/usr/local/bin/fleet-selftest.sh.bak-20261123-174244` and the current file):

```bash
DOCTOR="$FLEET_DIR/fleet-doctor.py"
if [ -f "$DOCTOR" ]; then
  doctor_out=$(timeout 300 python3 "$DOCTOR" 2>&1)
  doctor_rc=$?
  …
  note_fail "fleet-doctor reported failures: $(printf '%s' "$doctor_fails" | tr '\n' ';')"
```

`FLEET_DIR=/root/.hermes/fleet` (`fleet-selftest.service` sets `HERMES_HOME=/root/.hermes`), the
doctor exits non-zero when any check is a FAIL, and the self-check then files a card. The doctor
is documented in the script as the part that checks "the fleet's *invariants*: both Hermes trees,
**the container patch**, the one-worker.py-sha rule, every worker's agent config, the tailnet" —
the failing check is that "container patch" invariant.

Everything else in the failing run passed:

| Check | Result at 18:09:16–18:09:48 |
| --- | --- |
| worker `hermes` (127.0.0.1), `wiseq-vps`, `beelink`, `victus` | ok (all four answer on ssh) |
| gateway key (`https://llm.paragu-ai.com/v1/models`) | ok (HTTP 200) |
| board | readable, **0 stuck leases**, 23 done / 4 cancelled |
| hub PR publisher (100.104.202.59) | ok |
| shared-document guard (hub) | ok — 2 documents intact |
| **fleet-doctor → `container heartbeat patch present`** | **FAIL — 0 occurrence(s)** |

## Timeline

```
17:39:17  PASS: fleet is able to work          (scheduled run; doctor not yet wired in)
17:40:50  ok: fleet-doctor checks: 31  PASS: 31  WARN: 0  FAIL: 0
17:42:07  FAILURES (1): shared-document guard   (separate, already-fixed finding)
17:43:48  ok: fleet-doctor checks: 31  PASS: 31  WARN: 0  FAIL: 0
17:45:04  ok: fleet-doctor checks: 31  PASS: 31  WARN: 0  FAIL: 0
17:46:41  ok: fleet-doctor checks: 31  PASS: 31  WARN: 0  FAIL: 0
17:46:44  PASS: fleet is able to work          <-- last good state (checked_at 1795466804)

18:04:43  [heartbeat guard] NOT bind-mounted; container copy matches host md5 5f190f1d…; PASS
18:05:46  [heartbeat guard] bind-mounted from /root/.hermes/hermes-patches/kanban_db.py; PASS
18:09:16  [self-check] all four worker nodes answer on ssh
18:09:23  [heartbeat guard] NOT bind-mounted; container copy DRIFTED
                    (container 552829b2… vs host 5f190f1d…) -> re-applied via docker cp; PASS
18:09:46  FAIL: fleet-doctor reported failures: FAIL  container heartbeat patch present  0 occurrence(s)
18:09:49  filed a card for the fleet to investigate
18:10:39  [self-check, manual re-run] all worker nodes answer on ssh
18:11:10  ok: fleet-doctor checks: 33  PASS: 33  WARN: 0  FAIL: 0
18:11:14  PASS: fleet is able to work
```

The two log files that tell the story are `/var/log/fleet-selftest.log` and
`/var/log/hermes-heartbeat-guard.log`.

## Root cause

**The heartbeat patch is not part of the `hermes` container's *definition*, only of its writable
layer, and the container is being recreated by something that does not carry the durable bind
mount.**

`hermes-heartbeat-guard.sh` says this in its own header:

> The heartbeat fix (kanban_db.py stamps last_heartbeat_at when a card is claimed) was patched
> directly into the container's writable layer. That is lost by any RECREATE of the container —
> the new container comes from the image, which does not have the fix.
> The durable fix is a bind mount: the container's kanban_db.py is the host's
> /root/.hermes/hermes-patches/kanban_db.py.

The guard log shows the container being recreated twice inside five minutes, the second time
*without* the mount:

* `18:04:43` — "the patched file is **NOT bind-mounted** — it lives in the writable layer"
* `18:05:46` — "the patched file **is bind-mounted** from /root/.hermes/hermes-patches/kanban_db.py
  (it survives a recreate)"
* `18:09:23` — "the patched file is **NOT bind-mounted**" and "the container's copy has
  **drifted** (container `552829b2…`, host `5f190f1d…`)" → the guard re-applied the file

A drifting md5 is the fingerprint of a recreate: the new container came from the image, whose
`kanban_db.py` is the pristine `552829b2…` copy instead of the patched `5f190f1d…` one. So the
definition used by that recreate has no `/opt/hermes/hermes_cli/kanban_db.py` volume, and the
patch survived only because the guard copies it back — **up to a full guard interval later**.

The doctor's `container heartbeat patch present` check ran at 18:09:46, i.e. inside the
recreate→repair window, and saw a container whose `kanban_db.py` carried none of the heartbeat
marker → `0 occurrence(s)`.

### Why the alarm was wrong (and why it was not)

* **It was right about the hole.** The patch really is one `docker rm` away from gone; the guard
  log proves the container was running unpatched at 18:09:23 and had to be repaired.
* **It was wrong about the fleet.** The repair completed at 18:09:24 and the next self-check
  passed 33/33, so no card was needed.
* **It was a card-worthy event only by accident.** The self-check files a card for *any* doctor
  FAIL, with no re-check. The TCP probes in the very same script were given three attempts and a
  6 s→retry treatment at 17:42 precisely so a momentary hiccup would not file a card; the doctor
  got no such treatment, and the doctor's own invariant is *repaired automatically* by the guard
  within minutes.

### Contributing factors

1. **The doctor counts a transient state as a hard FAIL.** The container patch is, by design,
   a two-layer defence: the bind mount is layer 1, the guard is layer 2. A check that only sees
   layer 2's transient state will fire every time layer 1 is briefly absent.
2. **The doctor's check set changed during the window.** It reported **31 checks** in every run
   from 17:40 to 17:46 and **33 checks** at 18:11 — `fleet-doctor.py` itself was edited between
   17:46 and 18:11, so the check that failed is one of the new or rewritten ones. A newly added
   check that reports a *self-repairing* state as FAIL is a defect in the check, not in the fleet.
3. **Nothing in `/usr/local/bin` recreates the `hermes` container.** `docker restart hermes`
   (`hermes-weekly-gateway-restart.sh`) keeps the writable layer and would *not* have caused this;
   the dashboard watchdog and the backend verifier only restart `hermes-dashboard`. The recreate
   therefore came from a manual `docker rm` + `docker run` / `docker compose up`, or from a
   root-run fleet card — and whatever it was, it used a definition **without** the mount.
4. **The guard's own warning applies.** `/root/.hermes/hermes-agent/docker-compose.yml` builds the
   v0.20.0 source tree; the guard explicitly says "never run `docker compose up` there". A recreate
   from that tree would both drop the mount and downgrade the image.

## Remediation (to be applied as root on hermes)

The host-side fix could **not** be applied from this card: `fleet-doctor.py`, the patch file and
the compose files live under `/root/.hermes` (mode `0700`, root-owned), the `fleet-agent` user
this card runs as has no `sudo`, and the Docker socket (`/var/run/docker.sock`) is not accessible
(`permission denied`). This card's scope is the repository. The fix is below.

**1. Make the patch part of the container *definition*, in the compose file that actually defines
the `hermes` container** (the one built from the published `nousresearch/hermes-agent:v0.23.2`
image — **not** the v0.20.0 tree in `/root/.hermes/hermes-agent/`):

```yaml
    volumes:
      - /root/.hermes/hermes-patches/kanban_db.py:/opt/hermes/hermes_cli/kanban_db.py:ro
```

then recreate the container from *that* file. Verify the mount is durable:

```bash
docker inspect hermes --format '{{range .Mounts}}{{.Destination}} {{.Source}}{{end}}'
# must print: /opt/hermes/hermes_cli/kanban_db.py /root/.hermes/hermes-patches/kanban_db.py
hermes-heartbeat-guard.sh --status   # must say "bind-mounted … (it survives a recreate)"
```

Belt and braces: publish a thin derived image — `FROM nousresearch/hermes-agent:v0.23.2` with the
patched `kanban_db.py` `COPY`ed in — so the fix survives even a hand-written `docker run` that
mounts nothing.

**2. Audit the recreate path.** Find whatever recreated the container at ~18:09 and make it use
the definition from step 1; record it in `/root/.hermes/fleet/README.md` so the next recreate is
not a guess. (Today no script in `/usr/local/bin` recreates `hermes`, so this is a manual or
card-driven action that must be brought under control.)

**3. Make the doctor's check look at the durable state.** Assert the *mount* (and the image tag),
not only the file's current content; report a content-only mismatch as a WARN with the text
"the guard will re-apply it", because repairing that is precisely the guard's job. As long as the
doctor asserts a state that the guard repairs automatically, every recreate becomes a card.

**4. Give the doctor's FAIL the same anti-cry-wolf treatment the TCP probes got** in
`fleet-selftest.sh`: before filing a card for a doctor FAIL, re-run the doctor once (and, for
container-related FAILs, wait for or trigger `hermes-heartbeat-guard.sh`); file only if the
failure persists, and log "cleared on re-check" as a warning otherwise. The 18:09 FAIL would have
cleared at 18:10:39 and never reached the board.

**5. Shrink the recreate→repair gap.** Run the guard on a docker event (`docker events`) or every
2–3 minutes instead of every ~10, so a lost patch is repaired in seconds rather than minutes —
during which cards claimed by the agent do not stamp `last_heartbeat_at` and the board can show
stale leases (the same symptom as the earlier "Heartbeat reset regression (stale heartbeat)"
card).

## Verification performed from this card

Read-only inspection on hermes; no remote command, no state changed, no file outside the
repository touched.

* `/var/log/fleet-selftest.log` — the failing run (18:09:16 → 18:09:49) and every run before and
  after it, quoted above; `checked_at 1795466804` = 2026-11-23 17:46:44 -03:00 is the last good
  state quoted in the card body; the board line `last_done_at 1795465020` = 17:17:00 -03:00
  (`t_5145bedd`, "Uniform trust check: victus pulls a card (2026-11-23)").
* `/var/log/hermes-heartbeat-guard.log` — the two bind-mount states and the md5 drift
  (`552829b2…` vs `5f190f1d…`) that identify the recreate.
* `/usr/local/bin/hermes-heartbeat-guard.sh` — the documented semantics of the durable fix (bind
  mount) and of the repair layer (docker cp), the expected image tag, and the warning about the
  v0.20.0 compose tree.
* `/usr/local/bin/fleet-selftest.sh` (+ the two `.bak-20261123-*` copies) — how the doctor is
  invoked, how its FAIL becomes a card, and the fact that the doctor section was added at 17:40.
* `systemctl list-timers --all` — `fleet-selftest.timer` last 18:09:16 / next 18:39:16;
  `hermes-heartbeat-guard.timer` last 18:04:43 / next 18:14:23. The 18:05:46 and 18:09:23 guard
  runs and the 18:10:39 self-test run are off-timer, i.e. they were run by hand.
* `grep` over `/usr/local/bin/*.sh` — no script recreates the `hermes` container.
* Access limits confirmed: `/root/.hermes` is unreadable, `sudo -n` is refused, and
  `/var/run/docker.sock` denies access, so `fleet-doctor.py`, the patch file and the compose
  files could not be read or changed from this card.

**Conclusion:** the fleet is able to work and the failing check has already cleared (33/33 PASS at
18:11:10). The real defect is that the heartbeat patch is not part of the `hermes` container's
definition, so every recreate re-opens a window in which the container runs unpatched — and the
self-check's doctor reports that window as a fleet failure and files a card for it. Steps 1, 3
and 4 above close the hole and stop the false alarm.
