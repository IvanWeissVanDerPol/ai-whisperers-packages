# Fleet self-check failure — diagnosis

**Card:** `t_388107ce` · **Host:** hermes (`hermes.tail9cb0c1.ts.net`, tailnet IP `100.78.180.49`)
**Self-check:** `/usr/local/bin/fleet-selftest.sh`, run by `fleet-selftest.timer` every 30 min
**Failing run:** 2026-11-23 14:38:51 → 14:39:04 (-03:00) · **Last good run:** 14:08:50 (-03:00)

## Summary

Both failing checks are TCP-reachability probes to the same two hosts, and **neither host was
actually down**. At 14:38 the path from hermes to both of them degraded, and the self-check's
single-shot 6-second connect timeout turned a momentary Tailscale relay hiccup into a
"the fleet is broken" verdict and a card.

* `100.85.215.6` is **`ivan-beelink-1`** — the `beelink` worker node, `tag:control`.
* `100.104.202.59` is **`ale-pc-1`** — the hub that runs the PR publisher
  (`/home/alejandro/bin/fleet-publish-pr`, invoked over SSH as `pr_publisher`).

Both are reached **only through the Tailscale DERP relay in region `sao`**
(`186.158.200.190`), whereas the hosts that passed in the same run are not:

| Peer | IP | Tags | Path from hermes | Result at 14:38 |
| --- | --- | --- | --- | --- |
| `hermes` | 127.0.0.1 | — | loopback | ok |
| `wiseq-vps` | 100.107.160.19 | `tag:operator`, `tag:prod-wiseq` | **direct** `148.113.156.16:41641` | ok |
| `ivan-beelink-1` | 100.85.215.6 | `tag:control` | **DERP `sao`** `186.158.200.190:4844` | **FAIL (6 s timeout)** |
| `ale-pc-1` | 100.104.202.59 | `tag:control` | **DERP `sao`** `186.158.200.190:14369` | **FAIL (6 s timeout)** |

The fleet was demonstrably able to work 34 minutes earlier: the last completed card
(`t_08fdb3a4`, "Node onboarding check: beelink") finished at 14:04:59 and opened
[PR #17](https://github.com/IvanWeissVanDerPol/ai-whisperers-packages/pull/17) **through the same
hub publisher**, and the 14:08:50 run of the very same script passed all five checks.

## Timeline (from `/var/log/fleet-selftest.log`)

```
14:08:50  ok: node beelink (100.85.215.6) answers on ssh
14:08:50  ok: hub publisher reachable (100.104.202.59)
14:08:50  PASS: fleet is able to work
14:38:51  ok: node hermes (127.0.0.1) answers on ssh
14:38:51  ok: node wiseq-vps (100.107.160.19) answers on ssh
14:38:57  FAIL: worker node beelink (100.85.215.6) does not answer on ssh:22   <- 6.0 s timeout
14:38:57  ok: gateway key authenticates (https://llm.paragu-ai.com)
14:38:57  ok: board readable, no stuck leases
14:39:03  FAIL: hub PR publisher not reachable at 100.104.202.59               <- 6.0 s timeout
14:39:04  FAILURES (2): ... filed a card for the fleet to investigate
```

Both probes consumed the full 6 s budget and the two peers behind them are the two
DERP-only peers; the direct peer and loopback passed in the same run. That is the signature of a
degraded relay path, not of two hosts dying simultaneously.

## Root cause

**A transient degradation of the Tailscale DERP relay path to the `sao` region
(`186.158.200.190`), amplified by a brittle probe in the self-check.**

Evidence collected from this card (Tailscale 1.104.7, `tailscale status --json`):

* `ivan-beelink-1` and `ale-pc-1` both report `Relay: "sao"`, `CurAddr: 186.158.200.190:…`,
  `Active: true`, `Online: true` — the peers were up, the path to them was not.
* At the time of the alarm both peers showed `rx 0` bytes received from hermes, while
  `wiseq-vps` and `paragu-ai` (direct paths) showed hundreds of MB of traffic.
* `tailscale ping 100.85.215.6` timed out three times and only then answered
  `pong from ivan-beelink-1 (100.85.215.6) via 186.158.200.190:4844 in 202ms` — the peer was
  alive, the relayed round trip was not reliable. `tailscale ping 100.104.202.59` timed out on
  every attempt.
* Re-running the exact probe the script uses, five times in a row, right after the card was
  filed: **both hosts answer on `:22` in ~0.25 s** (versus ~0.03 s for the direct `wiseq-vps`),
  with valid banners `SSH-2.0-OpenSSH_10.6` (beelink) and `SSH-2.0-Tailscale` (hub).
  Both sshd's and the publisher host were healthy again within minutes.

So the fleet is able to work; the check misreported it.

## The latent defect that produced the false alarm

`/usr/local/bin/fleet-selftest.sh`:

1. **Single attempt, hard 6 s timeout, no retry** — line 57 (workers) and line 124 (hub):
   `timeout 6 bash -c "exec 3<>/dev/tcp/$host/22"`. A relayed path with a momentarily slow
   DERP round trip (> 6 s, which `tailscale ping` reproduced) is reported as "does not answer".
   The probe also never reads the SSH banner, so it cannot tell "no sshd answered" from
   "the path is degraded".
2. **The hub address is a hard-coded default** — line 29:
   `HUB_IP="${FLEET_HUB_IP:-100.104.202.59}"`. It is not checked against the address the fleet
   actually publishes to (the `pr_publisher` target carried in the card payload) nor against the
   tailnet's current mapping for the host that runs `fleet-publish-pr`. Any host move, IP change
   or rename of the hub is reported as "pull requests cannot be opened".
3. **Structural risk** — the one worker node that failed and the PR publisher are both
   `tag:control`, laptop-grade, **DERP-only** hosts. The resilient members of the fleet
   (`hermes` itself, `wiseq-vps` direct, `paragu-ai` direct) are the ones that were never in
   trouble. Fleet availability currently depends on a relay region and on two laptops staying
   awake.

## Remediation

No host-side change could be applied from this card: the self-check script, its systemd unit
and the dispatcher config (`/root/.hermes/fleet/dispatcher.json`) are root-owned and unreadable
and unwritable by the `fleet-agent` user this card runs as (no sudo, no docker access), and
this card's scope is the repository. The following is the fix, to be applied as root on hermes.

**1. Make the reachability probe tolerant of a relayed path and able to say *why* it failed**
(`/usr/local/bin/fleet-selftest.sh`, lines 57 and 124) — retry, longer timeout, and read the
banner:

```bash
probe_ssh() {           # $1 = host, $2 = label
  local host="$1" attempt
  for attempt in 1 2 3; do
    if banner=$(timeout 15 bash -c \
         "exec 3<>/dev/tcp/$host/22 && head -c 16 <&3" 2>/dev/null) \
       && [[ "$banner" == SSH-* ]]; then
      log "ok: $2 ($host) answers on ssh [$banner]"
      return 0
    fi
    sleep 5
  done
  note_fail "$2 ($host) does not answer on ssh:22 after 3 attempts (15 s each)"
  log "diagnostic: $(tailscale ping --timeout 5s "$host" 2>&1 | tail -2)"
  log "diagnostic: $(tailscale status --json | python3 -c \
      'import json,sys; d=json.load(sys.stdin); \
       [print(p.get("DNSName"), "relay=", p.get("Relay"), "curaddr=", p.get("CurAddr")) \
        for p in d.get("Peer",{}).values() if "$host" in (p.get("TailscaleIPs") or [])]')"
  return 1
}
```

**2. Stop hard-coding the hub address** — resolve the publisher host from the live fleet
configuration instead of the literal default on line 29 (the dispatcher knows the
`pr_publisher` target it hands to workers), and fail with a distinct message when the pinned IP
no longer matches the tailnet's current mapping for that host, so a *moved* publisher is not
reported as a dead one.

**3. Remove the single point of failure** — run `fleet-publish-pr` on an always-on host
(hermes itself, tailnet IP `100.78.180.49`) and keep `ale-pc-1` as a fallback; same for the
`beelink` worker — enroll `wiseq-vps` (direct path) or `kiki-fedora` (`tag:worker`,
`100.114.210.99`) so the fleet no longer depends on the `sao` DERP region.

**4. Make the check distinguish "host down" from "path degraded"** — include the relay/direct
path in the failure message, so the next operator does not have to re-derive this.

## Verification performed from this card

Read-only checks; no remote, no state changed:

* `fleet-selftest.service` — failed run at 14:39:04 with exit code 1 (`systemctl status`);
  the previous run at 14:08:50 exited 0 and wrote `selftest.json`
  (`checked_at 1795453730` = 2026-11-23T14:08:50-03:00, `ok: true`).
* Board healthy in the failing run as well — 10 done / 4 cancelled, **0 stuck leases**; the last
  done card was `t_08fdb3a4` at 14:04:59 with PR #17 published by the hub.
* Gateway key authenticated and the dispatcher were **not** among the failures; only the two
  TCP probes failed.
* `tailscale status --json` — peer/tag/relay mapping and reachability as quoted above;
  `tailscale ping` behaviour; `tailscale version` 1.104.7.
* Re-ran the script's own probe 5× against both failed hosts: both answer on `:22` in ~0.25 s
  with valid SSH banners; the direct peer answers in ~0.03 s.

**Conclusion:** the fleet is able to work and is able to open pull requests. The failure was a
false alarm caused by a degraded Tailscale DERP path to the two relay-only `tag:control` hosts,
surfaced by a probe that gives a relayed path no second chance.
