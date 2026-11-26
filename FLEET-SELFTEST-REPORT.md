# Fleet self-check failure — diagnosis

**Card:** fleet self-check on hermes · **Host:** hermes (`hermes.tail9cb0c1.ts.net`, tailnet `100.78.180.49`)
**Self-check:** `/usr/local/bin/fleet-selftest.sh`, run by `fleet-selftest.timer` every 30 min
**Failing runs:** 2026-11-23 19:37:12 → 20:10:26 (-03:00) · **Last good run:** 19:12:24 (-03:00)
**Board state at filing:** 26 done / 4 cancelled, 0 stuck leases, last done `t_0f3f80ce`

## Summary

Three checks are listed as failed, but they are **not three faults** — they are **two distinct
problems plus one misreported probe**:

| # | Reported failure | What it actually is |
| --- | --- | --- |
| 1 | `gateway key did not authenticate (http )` | **Not an authentication failure.** The key is valid and the gateway answers it in ~50 ms. The probe never got an HTTP status line: the request hung past the script's `timeout 15` and was killed, so the probe logged a transport stall as an auth failure. |
| 2 | `hub PR publisher (100.104.202.59) does not answer on ssh:22 after 3 attempts (it is online in the tailnet)` | **Transient tailnet path loss to `ale-pc-1`**, ~40 s wide. The host was healthy: the same hub answered the very next probe, and the document-guard check — which SSHes to the *same* host — succeeded 96 s later. |
| 3 | `fleet-doctor: FAIL gateway key rate limits NOT SET - the budget is the only brake on a runaway agent` | **A real, persistent defect.** The fleet's gateway key carries no `rpm_limit`/`tpm_limit`, only a budget. This is the only finding in this card that is genuinely a hole in the fleet, and it is **still open**. |

The common trigger is the **key rotation at 19:12:39 local (22:12:39Z)**: the last passing gateway check
was at 19:12:24, the key was created on the gateway at that moment and written
to `/etc/fleet-agent/litellm.env` at 19:13, and the first failure of the new pair is at 19:37:12.

## 1. `gateway key did not authenticate (http )` — a misreported transport stall

### The key is fine

`/etc/fleet-agent/litellm.env` (44 bytes, mtime 2026-11-23 19:13) holds
`FLEET_LITELLM_KEY=sk-xkv…eX7Q`. Right now, from this host:

```
$ curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $FLEET_LITELLM_KEY" \
    https://llm.paragu-ai.com/v1/models
200        # 8 consecutive attempts, 0.04–0.05 s each
$ curl -s -o /dev/null -w '%{http_code}' https://llm.paragu-ai.com/v1/models   # no key
401
```

`/key/info` for that key on the same gateway returns a fully configured record:

```
key_alias    fleet-agent          user_id       fleet
tpm_limit    1000000              rpm_limit     120
max_budget   5.0                  budget_duration  30d
expires      2027-11-23           spend         0.049
created_at   2026-11-23T22:12:39Z (19:12:39 local)
```

The gateway resolves to `100.79.181.37` (`paragu-ai`, via `/etc/hosts`), a direct tailnet path.

### The empty `http ` proves it was never an auth problem

The probe is:

```bash
code=$(timeout 15 curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${FLEET_LITELLM_KEY:-}" \
  "$GATEWAY_URL/v1/models" 2>/dev/null)
```

`curl` **always** writes a status line on its own failures — verified locally: an unresolvable
host prints `000` (exit 6), a malformed URL prints `000` (exit 3). The only way `code` comes out
**completely empty** is if the process is **killed** before it can run `--write-out`:

```
$ timeout 2 curl -s -o /dev/null -w '[%{http_code}]' http://192.0.2.1/v1/models
            # (no output at all)   rc=124
```

`rc=124` is `timeout` reporting "I killed it". So the logged line

```
2026-11-23T19:39:35-03:00 FAIL: gateway key did not authenticate (http )
```

means: **the request hung for more than 15 seconds and was killed.** A rejected key would have
logged `http 401`. The message is actively misleading — it blames the key for a network stall.

### Why it stalls in the service but not from a shell

The check runs inside `fleet-selftest.service` (`User=root`, `Environment=HERMES_HOME=/root/.hermes`,
no `Environment=` override, no drop-in — `systemctl cat` and
`/etc/systemd/system/fleet-selftest.service.d/` confirm), so `GATEWAY_URL` is the default
`https://llm.paragu-ai.com` and there is **no proxy in the systemd manager environment**
(`systemctl show-environment` → only `LANG` and `PATH`). From an interactive shell the same URL
and key answer in 50 ms, every time.

The remaining difference is the **root/systemd context** — `~/.curlrc` for root is the one file
that can still change curl's behaviour for that user, and it is unreadable to this agent
(`/root` is mode 0700; this run has no `sudo`). Resolving it needs one command as root:

```bash
cat /root/.curlrc 2>&1                        # proxy / interface / cacert overrides?
systemd-run --wait --pipe -p User=root \
  /bin/bash -c '. /etc/fleet-agent/litellm.env; \
  curl -s -o /dev/null -w "%{http_code} exit=%{exitcode}\n" --max-time 30 \
       -H "Authorization: Bearer $FLEET_LITELLM_KEY" https://llm.paragu-ai.com/v1/models'
```

### Fix for the probe (as root, `/usr/local/bin/fleet-selftest.sh`)

The check must be able to tell "the key is wrong" from "the request never completed", and must
survive a slow first request:

```bash
resp=$(timeout 30 curl -s -o /dev/null -w '%{http_code} %{exitcode}' \
        -H "Authorization: Bearer ${FLEET_LITELLM_KEY:-}" \
        "$GATEWAY_URL/v1/models" 2>/dev/null)
code=${resp%% *}; exit_code=${resp##* }
case "$code" in
  200) log "ok: gateway key authenticates ($GATEWAY_URL)" ;;
  401|403) note_fail "gateway key rejected by $GATEWAY_URL (http $code) - the key itself is wrong" ;;
  000|"") note_fail "gateway unreachable at $GATEWAY_URL (no response in 30s, curl exit $exit_code)" ;;
  *)   note_fail "gateway key did not authenticate (http $code, curl exit $exit_code)" ;;
esac
```

i.e. raise the timeout above the observed stall, retry like `probe_ssh` already does, and never
print "did not authenticate" for a request that produced no status line.

## 2. `hub PR publisher (100.104.202.59) does not answer on ssh:22` — a transient path loss

`100.104.202.59` is **`ale-pc-1`**, the hub that runs the PR publisher and the shared-document
guard. In the failing run the *same* host was unreachable over SSH by the document guard too:

```
19:38:41 WARN: could not reach the hub to run the document guard (ssh exit 255):
              ssh: connect to host 100.104.202.59 port 22: Connection timed out
19:38:41 FAIL: hub PR publisher (100.104.202.59) does not answer on ssh:22 after 3 attempts
              (it is online in the tailnet)
19:39:35 ok: hub PR publisher (100.104.202.59) answers on ssh
19:40:17 ok: shared documents are intact (2 document(s))      <-- SSH to the same host, 96 s later
```

So the hub was **up and serving SSH** less than two minutes after the probe gave up — the probe's
whole budget (3 × 10 s connect + 2 × 5 s sleep ≈ 40 s) was consumed by a path blip that ended
while it was still waiting. The tailnet agreed the peer was online throughout
(`ale-pc-1 … active; direct 186.158.200.190:14369`), and from this host the hub's `:22` is open
now. This is the same class of event diagnosed on 2026-11-23 14:38
(`t_388107ce`, DERP-relayed peers): **the host is fine, the path to it blipped**.

**Fix (as root, same script):** give the probe a longer, jittered budget and make the message say
what it actually saw, e.g. 6 attempts with 5/10/20 s backoff plus `tailscale ping` to confirm the
peer is alive, and treat "peer online but no banner" as a warning with the last error text rather
than an instant fleet-failure. The document-guard SSH call needs the same retry treatment — it
already degrades to a warning, which is correct.

## 3. `fleet-doctor: gateway key rate limits NOT SET` — the real hole, still open

This one is not a probe artifact. The doctor reports that the fleet's gateway key has **no
rate limits**, leaving the spend budget as the only brake on a runaway agent.

Note the split in the evidence: the **production** gateway key that `fleet-selftest.sh` exercises
(`/etc/fleet-agent/litellm.env` → `https://llm.paragu-ai.com`) *does* have limits
(`rpm_limit 120`, `tpm_limit 1000000`, `max_budget 5.0 / 30d`). The key the doctor is complaining
about is therefore the **fleet's own virtual key on gateway #2**, the fleet's private LiteLLM
instance on hermes (`100.78.180.49:4001`, stack at `/opt/stacks/fleet-gateway`, key held in
`/opt/stacks/fleet-gateway/fleet-vkey.gw2`). That key carries a budget and **no rpm/tpm limits**.

Gateway #2 itself is healthy: `http://100.78.180.49:4001/health/liveliness` → `200`, and
`configs/litellm-config.yaml` loads the fleet's metered groups (`fleet-m3`, `fleet-glm`,
`fleet-nemotron` with the `fleet-primary` / `fleet-coding` / `fleet-reasoning` / `fleet-fast`
aliases) with per-token costs, so usage is *metered* but not *capped*.

**Fix (as root on hermes)** — give the fleet virtual key the same brake the production key has:

```bash
. /opt/stacks/fleet-gateway/.env.litellm          # provides LITELLM_MASTER_KEY
curl -s -X POST http://100.78.180.49:4001/key/update \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$(cat /opt/stacks/fleet-gateway/fleet-vkey.gw2)\",\
       \"rpm_limit\":120,\"tpm_limit\":1000000}" | python3 -m json.tool

# verify: the key record must now show rpm_limit/tpm_limit
curl -s http://100.78.180.49:4001/key/info \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$(cat /opt/stacks/fleet-gateway/fleet-vkey.gw2)\"}"
```

Then re-run the doctor and the self-check:

```bash
python3 /root/.hermes/fleet/fleet-doctor.py
systemctl start fleet-selftest.service && tail -40 /var/log/fleet-selftest.log
```

**Also fix the rotation that created this key** — the rotation at 19:12:39 wrote the fleet key
without rate limits (and left a 0-byte predecessor at `/etc/fleet-agent/.litellm.env.BALa3h`),
so every future rotation re-creates the same hole unless the rotation script carries
`rpm_limit`/`tpm_limit` with the key. That script is the real root cause of finding #3.

## Other findings from the same doctor run (not part of this card)

The most recent run (20:09:36 → 20:10:26) added two more doctor FAILs, unrelated to the three
listed above: `board task counts blocked=1, cancelled=4, done=26, ready=1, running=1` (normal
churn — it counts this very card) and `fleet one worker sha workers differ: beelink,wiseq-vps=
334b61752f9b; victus=1bf42e07507b` (the `victus` worker is running a different agent build and
must be re-synced to the fleet's one-worker SHA). Both are separate cards' worth of work.

## What this run changed, and what it could not

This repository (`IvanWeissVanDerPol/ai-whisperers-packages`) holds only the shared packages
monorepo (`ui/`, `tokens/`, `deploy/`); **none** of the fleet runtime state involved above lives
in it — the self-check script is `/usr/local/bin/fleet-selftest.sh` (root-owned, outside the
repository), the doctor and board are `/root/.hermes/fleet/*` (mode 0700), the gateway stack is
`/opt/stacks/fleet-gateway` (root-owned) and the agent key file is `/etc/fleet-agent/litellm.env`
(root-owned). This run's rules forbid touching anything outside the repository directory, and
the agent account has no `sudo`, so the runtime fixes above could not be applied here; they are
specified exactly — command, file, expected result — so the operator (or a root-capable fleet
worker) can apply them without re-deriving the diagnosis.

What *was* applied, inside the repository, is this report — the only change in this working tree.
The probe hardening in section 1 and the doctor fix in section 3 belong to files that live
outside this repository (`/usr/local/bin/fleet-selftest.sh`, `/root/.hermes/fleet/fleet-doctor.py`,
`/opt/stacks/fleet-gateway/`), so they are specified here as exact patches/commands rather than
applied silently from a pull request that cannot reach them.

## Evidence index

* `/var/log/fleet-selftest.log` — lines 248 (last gateway PASS, 19:12:24) → 258/271/283/294
  (every gateway FAIL), 261/274/286/297 (doctor FAILs), 264/276/288/299 (failure summaries),
  and the 19:38:41 document-guard `ssh exit 255` warning.
* `/usr/local/bin/fleet-selftest.sh` — sections 3 (gateway probe), 5 (hub probe), 6 (doctor).
* `/etc/systemd/system/fleet-selftest.service{,.timer}` — `User=root`, no env override, 30 min timer.
* `/etc/fleet-agent/litellm.env` (mtime 19:13) and `/etc/fleet-agent/.litellm.env.BALa3h` (0 bytes, 19:12).
* `https://llm.paragu-ai.com/key/info` — the live record of the fleet-agent key (limits present).
* `/opt/stacks/fleet-gateway/configs/litellm-config.yaml`, `/opt/stacks/fleet-gateway/litellm.yml`,
  `/opt/stacks/fleet-gateway/fleet-vkey.gw2` — gateway #2 (healthy, `liveliness` 200) and the
  fleet virtual key that carries no rate limits.
* `tailscale status` — `ale-pc-1` (100.104.202.59) and `paragu-ai` (100.79.181.37) online/direct.
* Prior card `t_388107ce` (2026-11-23 14:38) — the same "host is fine, the path blipped" signature.
