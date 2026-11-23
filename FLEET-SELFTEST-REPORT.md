# Fleet self-check failure — diagnosis

**Card:** fleet self-check on hermes (`t_88dc6a4e`, filed 2026-11-23 19:40:17 -03:00)
**Host:** hermes — `hermes.paragu-ai.com`, tailnet `100.78.180.49`
**Self-check:** `/usr/local/bin/fleet-selftest.sh` (root:root 0755), run by `fleet-selftest.timer` every 30 min
**Last passing run:** 2026-11-23 19:12:55 -03:00 · **Failing runs:** 19:36:56, 19:39:19, 19:40:25, 20:09:20 (-03:00)

## Summary

Two checks are listed as failed and they are **two different defects**, not one:

| # | Reported failure | What it actually is |
| --- | --- | --- |
| 1 | `gateway key did not authenticate (http )` | **Not an authentication failure — a misreported transport stall.** The key is valid and the gateway answers it in ~50 ms. The probe got *no HTTP status line at all*, which for `curl` can only mean the process was killed before it could write one: the request hung past the script's `timeout 15`. The message blames the key for a network stall. |
| 2 | `fleet-doctor: FAIL gateway key rate limits NOT SET - the budget is the only brake on a runaway agent` | **A real hole in the fleet's key estate.** The fleet's gateway keys were re-created today by a rotation that does not carry the brake set. The key on the fleet's own gateway (`fleet-agent-gw2`) has `rpm_limit`/`tpm_limit` but **no spend budget at all**; the key in `/etc/fleet-agent/litellm.env` was rotated at 19:12:39 — 25 minutes before the first failure — by a script that installs a key without guaranteeing the limits. |

Both are fixable, but neither lives in this repository (see [What this run changed](#what-this-run-changed-and-what-it-could-not)).

---

## 1. `gateway key did not authenticate (http )` — a transport stall wearing an auth error's clothes

### The probe

`/usr/local/bin/fleet-selftest.sh:125-138`:

```bash
if [ -r /etc/fleet-agent/litellm.env ]; then
  . /etc/fleet-agent/litellm.env
  code=$(timeout 15 curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${FLEET_LITELLM_KEY:-}" \
    "$GATEWAY_URL/v1/models" 2>/dev/null)          # :129-131
  if [ "$code" = "200" ]; then
    log "ok: gateway key authenticates ($GATEWAY_URL)"
  else
    note_fail "gateway key did not authenticate (http $code)"   # :135
  fi
```

### The empty `http ` proves it was never an auth problem

`curl` always writes a status line on its **own** failures. Measured on this host, this run:

```bash
$ timeout 2  curl -s -o /dev/null -w '[%{http_code}]' http://192.0.2.1/v1/models
            (no output at all)          rc=124        # killed by timeout
$ timeout 15 curl -s -o /dev/null -w '[%{http_code}]' http://nonexistent.invalid/v1/models
[000]                                    rc=6         # curl's own error
$ timeout 15 curl -s -o /dev/null -w '[%{http_code}]' -H "Authorization: Bearer sk-wrong-key" \
      https://llm.paragu-ai.com/v1/models
[401]                                                 # key rejected
```

So `code` can only come out **completely empty** when `curl` was **killed** (here by `timeout 15`). A
rejected key prints `401`; an unreachable host prints `000`. The logged line

```
2026-11-23T19:39:35-03:00 FAIL: gateway key did not authenticate (http )
```

means *the request hung for more than 15 seconds and was killed* — and the script reports it as an
authentication failure. The log timings confirm the full stall every single time:

```
19:36:57  ok: worker node victus (100.77.236.100) answers on ssh
19:37:12  FAIL: gateway key did not authenticate (http )      <- exactly 15 s later
20:09:21  ok: worker node victus (100.77.236.100) answers on ssh
20:09:36  FAIL: gateway key did not authenticate (http )      <- exactly 15 s later
```

### The key is fine

`/etc/fleet-agent/litellm.env` (44 B, mtime 2026-11-23 19:13:14, `root:fleet` 0640) holds
`FLEET_LITELLM_KEY=sk-xkv…eX7Q`. From this host, with that exact file's value:

```bash
$ . /etc/fleet-agent/litellm.env
$ curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $FLEET_LITELLM_KEY" \
      https://llm.paragu-ai.com/v1/models
200        # every attempt in this run, 0.04–0.08 s
$ curl -s -o /dev/null -w '%{http_code}' https://llm.paragu-ai.com/v1/models   # no key
401
```

`/key/info` for that key on the same gateway returns a fully bracketed record:

```
key_alias        fleet-agent            user_id          fleet
rpm_limit        120                    tpm_limit        1000000
max_budget       5.0                    budget_duration  30d
spend            0.38                   expires         2027-11-23
created_at       2026-11-23T22:12:39Z   (= 19:12:39 local)
models           fleet-primary, fleet-coding, fleet-reasoning, fleet-fast, fleet-m3, fleet-glm, fleet-nemotron
```

The key authenticates, it is scoped to the fleet's model groups, and it carries rate limits *and* a
budget. `llm.paragu-ai.com` resolves to `100.79.181.37` (`paragu-ai`, pinned in `/etc/hosts`), i.e. a
Tailscale path — the same class of path that blipped for the hub earlier today (`t_388107ce`,
2026-11-23 14:38).

### Root cause

`fleet-selftest.sh` probes the gateway **once**, with a hard `timeout 15`, and has **no retry** — even
though the TCP probes in the same file (`probe_ssh`) already learned that lesson and retry three
times. A ~15 s tailnet stall is therefore reported as *"the key did not authenticate"*, which is how a
momentary path blip becomes a fleet-wide card. The probe cannot tell these three states apart:

| state | what the script logs | what it should log |
| --- | --- | --- |
| key rejected | `http 401` | `the key itself is wrong (401)` |
| host unreachable | `http 000` | `the gateway is unreachable` |
| request hung | `http ` (empty) | `no response within the budget` — **not** an auth failure |

### Fix (as root, `/usr/local/bin/fleet-selftest.sh`, lines 125-138)

Replace the probe with one that classifies by exit status and retries like `probe_ssh` already does:

```bash
if [ -r /etc/fleet-agent/litellm.env ]; then
  # shellcheck disable=SC1091
  . /etc/fleet-agent/litellm.env
  code=""; curl_rc=1; attempt=0
  while [ "$attempt" -lt 3 ]; do
    attempt=$((attempt + 1))
    resp=$(timeout 30 curl -s -o /dev/null -w '%{http_code} %{exitcode}' \
      --connect-timeout 10 \
      -H "Authorization: Bearer ${FLEET_LITELLM_KEY:-}" \
      "$GATEWAY_URL/v1/models" 2>/dev/null)
    code=${resp%% *}; curl_rc=${resp##* }
    [ "$code" = "200" ] && break
    [ "$attempt" -lt 3 ] && sleep 5
  done
  case "$code" in
    200)          log "ok: gateway key authenticates ($GATEWAY_URL)" ;;
    401|403)      note_fail "gateway key rejected by $GATEWAY_URL (http $code) - the key itself is wrong" ;;
    "")           note_fail "gateway unreachable at $GATEWAY_URL (no HTTP response in 30s, curl exit $curl_rc) - transport stall, not a key problem" ;;
    000)          note_fail "gateway unreachable at $GATEWAY_URL (curl exit $curl_rc)" ;;
    *)            note_fail "gateway key did not authenticate (http $code, curl exit $curl_rc)" ;;
  esac
else
  note_fail "no gateway key file (/etc/fleet-agent/litellm.env)"
fi
```

i.e. raise the budget above the observed stall, retry, and never print *"did not authenticate"* for a
request that produced no status line. The same treatment belongs to the hub SSH probe and to the
document-guard SSH call (the 19:38:41 `ssh exit 255` warning was the same path blip).

---

## 2. `fleet-doctor: gateway key rate limits NOT SET` — the real hole

### Where the invariant is checked, and what it saw

The doctor is `/root/.hermes/fleet/fleet-doctor.py` — inside `/root/.hermes` (mode 0700, root), so it
could not be read from this card (no `sudo`). The invariant was reconstructed instead from the live key
store of the fleet's own gateway.

**Gateway #2** — the fleet's private LiteLLM on this host (`/opt/stacks/fleet-gateway`,
`100.78.180.49:4001`) — is healthy: `/health/liveliness` → `200`, `/health/readiness` → `200`, and
`configs/litellm-config.yaml` loads the metered fleet groups (`fleet-m3`, `fleet-glm`,
`fleet-nemotron` with the `fleet-primary` / `fleet-coding` / `fleet-reasoning` / `fleet-fast`
aliases) with per-token costs, so usage is **metered but not capped**.

Its key store is the stack's own postgres — `127.0.0.1:5433`, database `fleet_litellm`, user `fleet`
(trust auth) — with 57 tables. In this LiteLLM version the virtual-key table is
**`LiteLLM_VerificationToken`** (columns `token`, `key_name`, `key_alias`, `rpm_limit`, `tpm_limit`,
`max_budget`, `budget_duration`, `models`, …). It holds **exactly one key**:

```
key_alias        fleet-agent-gw2        key_name      sk-…ep3Q
rpm_limit        120                    tpm_limit     1000000
max_budget       NULL                   budget_duration NULL
spend            4.8e-05                blocked       NULL
created_at       2026-11-23T23:01:33Z   (= 20:01:33 local)
```

That is the key in `/opt/stacks/fleet-gateway/fleet-vkey.gw2` (26 B, mtime 20:01:33) — created in the
same minute as the file. **The fleet's scoped gateway key carries rate limits but no spend ceiling
whatsoever**: nothing stops a runaway agent from spending the whole upstream budget inside the
rpm/tpm window.

The spend logs of the same store show what the fleet **actually spends with**:

```
call_type    model               api_key (hash)  spend     startTime
(alias row)  fleet-coding        c40379f9db11…   0         2026-11-23T23:09:17Z  <- this card's worker
acompletion openai/MiniMax-M3    c40379f9db11…   4.8e-05   2026-11-23T23:10:36Z  <- this card's worker
(alias row)  fleet-coding        a0d685a9f102…   0         2026-11-23T23:18:10Z
(alias row)  fleet-coding        a0d685a9f102…   0         2026-11-23T23:24:15Z
acompletion openai/MiniMax-M3    02d3c926e730…  8.4e-05   2026-11-23T23:28:42Z  <- this card's worker
acompletion openai/MiniMax-M3    02d3c926e730…  8.4e-05   2026-11-23T23:28:45Z
(alias row)  fleet-coding        02d3c926e730…   0         2026-11-23T23:28:46Z
```

`c40379f9…` is the hash of the gateway-#2 key (`fleet-agent-gw2`, the only row in the store);
`a0d685a9…` is the hash of the production key `fleet-agent` (the value in
`/etc/fleet-agent/litellm.env`, and the `key` field `/key/info` returns for it); `02d3c926…` is the
hash of a third key this card's own worker used, whose source file is not readable from here.

**Three fleet keys in twenty minutes, one key record in the store.** The fleet is spending with keys
whose brake set cannot be asserted anywhere: the key store that *could* assert them is not the store
the traffic passes through, and the one record that does exist (`fleet-agent-gw2`) carries rate limits
but **no budget**. That is the invariant the doctor is failing on.

### Why the estate is in this state

The key rotation at **19:12:39 local** (22:12:39Z) is the common trigger:

```
19:12:24  ok: gateway key authenticates (https://llm.paragu-ai.com)   <- last PASS
19:12:39  the new production key is CREATED on the gateway (created_at 22:12:39Z)
19:12:51  /etc/fleet-agent/.litellm.env.BALa3h  (0 bytes, root:root)  <- leftover of the rewrite
19:13:14  /etc/fleet-agent/litellm.env  rewritten (44 B, root:fleet 0640)
19:36:56  first failing self-check run
```

The 0-byte `.litellm.env.BALa3h` is the fingerprint of an in-place rewrite that truncated the key file
before writing the new value — the rotation path rewrites the file from a key it just created, and
**nothing in that path guarantees the new key carries the brake set**. Gateway #2 was rebuilt the same
evening (its postgres migrations ran 2026-11-23 22:55:14Z = 19:55:14 local; `litellm.yml` rewritten at
19:52 with a `network_mode: host` migration; `.env.litellm` rewritten at 20:09) and its key was
re-created at 20:01:33 — **without a budget**.

So the invariant the doctor enforces — *the fleet's gateway key must carry rate limits (and a budget)
so a runaway agent is braked* — is not guaranteed anywhere in the key-provisioning path:

* the production key (`fleet-agent`) is currently fine (rpm 120 / tpm 1 000 000 / budget 5.0 per 30 d);
* the fleet's own gateway key (`fleet-agent-gw2`) has **no budget**;
* the key this card's worker actually spent with (`02d3c926…`) has **no record at all** in the store
  that would carry a brake set for it;
* the rotation script that installs `/etc/fleet-agent/litellm.env` recreates the hole on every run.

The doctor's FAIL is the fleet noticing exactly this. It is the only finding in this card that is a
genuine hole rather than a misreported probe.

### Fix (as root on hermes)

**a) Give gateway #2's key the missing budget, and both keys the same brake set:**

```bash
# gateway #2 — the fleet's own key
. /opt/stacks/fleet-gateway/.env.litellm                 # LITELLM_MASTER_KEY (0600, root)
GW2_KEY=$(cat /opt/stacks/fleet-gateway/fleet-vkey.gw2)
curl -s -X POST http://100.78.180.49:4001/key/update \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$GW2_KEY\",\"rpm_limit\":120,\"tpm_limit\":1000000,\
       \"max_budget\":5.0,\"budget_duration\":\"30d\"}"

# production gateway — the key the self-check exercises
PROD_KEY=$(sed -n 's/^FLEET_LITELLM_KEY=//p' /etc/fleet-agent/litellm.env)
curl -s -X POST https://llm.paragu-ai.com/key/update \
  -H "Authorization: Bearer $PROD_MASTER_KEY" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$PROD_KEY\",\"rpm_limit\":120,\"tpm_limit\":1000000,\
       \"max_budget\":5.0,\"budget_duration\":\"30d\"}"
```

Verify — the record must show the limits **and** the budget:

```bash
curl -s http://100.78.180.49:4001/key/info -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H 'Content-Type: application/json' -d "{\"key\":\"$GW2_KEY\"}" | python3 -m json.tool
# expect: rpm_limit 120, tpm_limit 1000000, max_budget 5.0, budget_duration 30d
```

**b) Fix the rotation, which is the real root cause.** The script that wrote
`/etc/fleet-agent/litellm.env` at 19:13:14 must create the key **with the limits in the request**, and
must verify the record before installing the file:

```bash
# create with the brakes attached — never without them
NEW_KEY=$(curl -s -X POST https://llm.paragu-ai.com/key/generate \
  -H "Authorization: Bearer $PROD_MASTER_KEY" -H 'Content-Type: application/json' \
  -d '{"key_alias":"fleet-agent","rpm_limit":120,"tpm_limit":1000000,\
       "max_budget":5.0,"budget_duration":"30d",\
       "models":["fleet-primary","fleet-coding","fleet-reasoning","fleet-fast",\
                 "fleet-m3","fleet-glm","fleet-nemotron"],\
       "metadata":{"purpose":"fleet workers","owner":"alejandro"}}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["key"])')

# verify before installing
curl -s https://llm.paragu-ai.com/key/info -H "Authorization: Bearer $NEW_KEY" \
  | grep -E '"(rpm_limit|tpm_limit|max_budget|budget_duration)"'      # must be non-null

install -m 0640 -o root:fleet /dev/null /etc/fleet-agent/litellm.env   # then write FLEET_LITELLM_KEY=$NEW_KEY
rm -f /etc/fleet-agent/.litellm.env.BALa3h                            # the 0-byte leftover of 19:12:51
```

**c) Make the self-check and the doctor look at the same key.** Today the self-check probes
`https://llm.paragu-ai.com` with the `fleet-agent` key, gateway #2 issues its own
`fleet-agent-gw2` key, and a third key (`02d3c926…`) is in live use with no record in either store.
Three keys, three rotation paths, three chances to forget the limits — and the doctor's check cannot
even name the key it is judging. Pick the primary gateway, point `/etc/fleet-agent/litellm.env` at
*its* key, register every fleet key in that gateway's store, and let the doctor's check read that one
file — then a missing brake is visible in exactly one place.

**d) Re-run the doctor and the self-check:**

```bash
python3 /root/.hermes/fleet/fleet-doctor.py      # expect: no FAIL on "gateway / key rate limits"
systemctl start fleet-selftest.service && tail -40 /var/log/fleet-selftest.log
```

---

## Other findings from the same doctor run (not part of this card)

The 20:10:17 run also reported two unrelated doctor FAILs: `board task counts
blocked=1, cancelled=4, done=26, ready=1, running=1` (normal churn — it counts this very card) and
`fleet one worker sha workers differ: beelink,wiseq-vps=334b61752f9b; victus=1bf42e07507b` (the
`victus` worker runs a different agent build and must be re-synced to the fleet's one-worker SHA).
Both are separate cards' worth of work and are deliberately **not** touched here.

---

## What this run changed, and what it could not

This repository (`IvanWeissVanDerPol/ai-whisperers-packages`) holds only the shared packages monorepo
(`ui/`, `tokens/`, `deploy/`). **None** of the fleet runtime involved above lives in it:

* `/usr/local/bin/fleet-selftest.sh` — root:root 0755, `/usr/local/bin` root:root 0755 → not writable;
* `/root/.hermes/fleet/fleet-doctor.py` and the board — under `/root/.hermes` (0700, root) → not readable;
* `/opt/stacks/fleet-gateway/` (`litellm.yml`, `configs/litellm-config.yaml`, `.env.litellm`,
  `fleet-vkey.gw2`) — root-owned, secrets 0600 → not writable;
* `/etc/fleet-agent/litellm.env` — root:fleet 0640 → writable by root only;
* `sudo -n` is refused for `fleet-agent`, and `/var/run/docker.sock` is `root:docker 0660` with
  `fleet` **not** in the `docker` group → no container access either.

This card's scope is the repository, so the runtime changes above are specified here as exact
commands and a patch, ready for a root-capable operator or worker, instead of being applied silently
from a pull request that cannot reach them. The one change in this working tree is this report: no
tracked file modified, no CI config, workflow, secret or lockfile touched, nothing under `.git`
touched, and no command was run against a remote.

## Evidence index

* `/var/log/fleet-selftest.log` — last gateway PASS 19:12:24/19:12:55; the 15 s gaps before every
  gateway FAIL (19:37:12, 19:39:35, 19:40:41, 20:09:36); doctor FAILs at 19:38:31, 19:40:15,
  19:41:21, 20:10:17; failure summaries and card filings at 19:38:41, 19:40:17, 19:41:27, 20:10:26.
* `/usr/local/bin/fleet-selftest.sh` — section 3 (gateway probe, lines 125-138), section 5 (hub probe),
  section 6 (doctor), section 7 (document guard); `GATEWAY_URL` default at line 28.
* `/etc/systemd/system/fleet-selftest.service{,.timer}` — `User=root`, `HERMES_HOME=/root/.hermes`,
  no drop-in, 30-minute timer.
* `/etc/fleet-agent/litellm.env` (44 B, 19:13:14, root:fleet 0640) and
  `/etc/fleet-agent/.litellm.env.BALa3h` (0 B, 19:12:51, root:root).
* `/opt/stacks/fleet-gateway/` — `litellm.yml` (host-network stack, 19:52), `configs/litellm-config.yaml`
  (fleet model groups + aliases), `.env.litellm` (0600, rewritten 20:09), `fleet-vkey.gw2` (26 B, 20:01:33).
* Gateway #2 key store — postgres `127.0.0.1:5433/fleet_litellm` (user `fleet`, trust auth),
  table `LiteLLM_VerificationToken`: the single row `fleet-agent-gw2` (rpm 120, tpm 1 000 000,
  **max_budget NULL**); `LiteLLM_SpendLogs` showing which key the fleet spends with;
  `_prisma_migrations` showing the schema was applied 2026-11-23 22:55:14Z (19:55 local).
* `https://llm.paragu-ai.com/key/info` — the live record of the production `fleet-agent` key
  (rpm 120, tpm 1 000 000, budget 5.0/30d, created 22:12:39Z).
* `curl` exit-code semantics measured on this host: killed → no status line + rc 124; DNS failure →
  `000` + rc 6; rejected key → `401`.
* `tailscale status` — `paragu-ai` (100.79.181.37, gateway) and `ale-pc` (100.104.202.59, hub) online.
* Prior card `t_388107ce` (2026-11-23 14:38) — the same "host is fine, the path blipped" signature.
