# Fleet self-check failure — diagnosis

**Card:** fleet self-check on hermes (`t_a6934d93`, filed 2026-11-23 20:10:26 -03:00)
**Host:** hermes — `hermes.paragu-ai.com`, tailnet `100.78.180.49`
**Self-check:** `/usr/local/bin/fleet-selftest.sh` (root:root 0755), run by `fleet-selftest.timer` every 30 min
**Failing runs:** 2026-11-23 19:36:56, 19:39:19, 19:40:25, 20:09:20 (-03:00) · **Last passing run:** 19:12:55 (-03:00)

## Summary

Four checks are listed as failed. They are **four separate defects**, not one problem seen four ways —
and only one of them is a fault in the key estate that the fleet has to actually repair:

| # | Reported failure | What it actually is |
| --- | --- | --- |
| 1 | `gateway key did not authenticate (http )` | **Not an authentication failure — a misreported transport stall.** The probe never received an HTTP status line at all, so `curl` was killed by the script's `timeout 15`. The key itself authenticates in ~45 ms. |
| 2 | `fleet-doctor: FAIL gateway key rate limits NOT SET - the budget is the only brake on a runaway agent` | **A real hole in the fleet's key estate** — and it is *not* the key the self-check probes (that one is fully bracketed). A second fleet key carries no complete brake set, and the provisioning path does not guarantee one. |
| 3 | `fleet-doctor: FAIL board task counts blocked=1, cancelled=4, done=26, ready=1, running=1` | **A card parked in `blocked`** — the only count in that line that is not normal churn. A blocked card has no owner making progress, and nothing on the host clears it automatically (both reapers act on processes, not on board cards). |
| 4 | `fleet-doctor: FAIL one worker sha workers differ: beelink,wiseq-vps=334b61752f9b; victus=1bf42e07507b` | **`victus` runs a different agent build** than the other three workers. Same fleet, two different agent commits — the exact condition the "one worker sha" invariant forbids. |

Checks 1, 3 and 4 are *observable consequences*; check 2 is a genuine hole. None of the four can be
repaired from inside this repository (see [What this run changed](#what-this-run-changed-and-what-it-could-not)),
so each fix below is given as an exact, copy-pasteable command for a root-capable operator.

---

## 1. `gateway key did not authenticate (http )` — a transport stall wearing an auth error's clothes

### The probe

`/usr/local/bin/fleet-selftest.sh`, section 3 (gateway key):

```bash
GATEWAY_URL="${FLEET_GATEWAY_URL:-https://llm.paragu-ai.com}"
...
code=$(timeout 15 curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${FLEET_LITELLM_KEY:-}" \
  "$GATEWAY_URL/v1/models" 2>/dev/null)
if [ "$code" = "200" ]; then
  log "ok: gateway key authenticates ($GATEWAY_URL)"
else
  note_fail "gateway key did not authenticate (http $code)"
fi
```

### The empty `http ` proves the key was never the problem

`curl` always writes a status line on its **own** failures. Measured on this host during this run:

```bash
$ timeout 15 curl -s -o /dev/null -w '[%{http_code}]' https://llm.paragu-ai.com/v1/models   # no key
[401]                                    # key rejected -> a status line IS printed
$ timeout 15 curl -s -o /dev/null -w '[%{http_code}]' http://nonexistent.invalid/v1/models
[000]                                    # DNS failure -> a status line IS printed
```

A **rejected** key prints `401`; an **unreachable** host prints `000`. The logged line
`FAIL: gateway key did not authenticate (http )` — with the code *completely empty* — can therefore only
mean **the process was killed before it could write a status line**, i.e. the request hung and
`timeout 15` killed it.

The log timings show that full stall every single time — exactly 15 s between the last "ok" line and
the gateway FAIL:

```
19:36:57  ok: worker node victus (100.77.236.100) answers on ssh
19:37:12  FAIL: gateway key did not authenticate (http )      <- exactly 15 s later
20:09:21  ok: worker node victus (100.77.236.100) answers on ssh
20:09:36  FAIL: gateway key did not authenticate (http )      <- exactly 15 s later
```

### The key is fine — measured now, from this host

```bash
$ . /etc/fleet-agent/litellm.env          # FLEET_LITELLM_KEY=sk-xkv…eX7Q
$ for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer $FLEET_LITELLM_KEY" https://llm.paragu-ai.com/v1/models; done
200
200
200                                        # 0.043 / 0.047 / 0.047 s — every attempt
$ curl -s -o /dev/null -w '%{http_code}' https://llm.paragu-ai.com/v1/models    # no key
401
```

`llm.paragu-ai.com` resolves to `100.79.181.37` and is pinned in `/etc/hosts`
(`# fleet: reach the gateway over the tailnet (the public IP cannot hairpin)`) — a **tailnet** path,
the same class of path that blipped for the hub at 19:37:52.

### Root cause

`fleet-selftest.sh` probes the gateway **once**, with a hard `timeout 15` and **no retry** — even though
the TCP probes in the very same file (`probe_ssh`) already retry three times precisely because "a single
6-second connect turned one momentary DERP relay hiccup into a 'the fleet is broken' card (2026-11-23
14:38)". The gateway probe never learned that lesson. A ~15 s tailnet stall is therefore reported as
*"the key did not authenticate"*, which is how a momentary path blip becomes a fleet-wide card, every 30
minutes, while the key is in fact fine.

The probe cannot distinguish three states, and reports all three as an auth failure:

| state | what the script logs | what it should log |
| --- | --- | --- |
| key rejected | `http 401` | `the key itself is wrong (401)` |
| gateway unreachable | `http 000` | `the gateway is unreachable` |
| request hung | `http ` (empty) | `no response within the budget` — **not** an auth failure |

### Fix (as root, `/usr/local/bin/fleet-selftest.sh`, section 3)

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

## 2. `fleet-doctor: FAIL gateway key rate limits NOT SET` — the real hole

### The key the self-check probes is *not* the key that fails

The live record of the production `fleet-agent` key (`/etc/fleet-agent/litellm.env`, root:fleet 0640)
on the production gateway, fetched during this run:

```
key_alias        fleet-agent                       user_id      fleet
rpm_limit        120                               tpm_limit    1000000
max_budget       5.0                               budget_duration  30d
budget_reset_at  2026-12-01T00:00:00+00:00         spend        0.619853
models           fleet-primary, fleet-coding, fleet-reasoning, fleet-fast,
                 fleet-m3, fleet-glm, fleet-nemotron
created_at       2026-11-23T22:12:39Z  (= 19:12:39 local)
```

That key is **fully bracketed**: rate limits *and* a budget. The doctor's `NOT SET` verdict therefore
cannot be about it — it is about **another fleet key**.

### Which key, and why it is unbracketed

The fleet runs **two** LiteLLM gateways (`/opt/stacks/fleet-gateway/litellm.yml`):

* the production gateway on `paragu-ai` (`https://llm.paragu-ai.com`), which owns the `fleet-agent` key
  the self-check probes — bracketed, as shown above;
* **gateway #2**, the fleet's own proxy on this host (`100.78.180.49:4001`, host network, its own redis
  and its own postgres `fleet_litellm` on `127.0.0.1:5433`), which issues its **own** scoped key
  `fleet-agent-gw2` (written to `/opt/stacks/fleet-gateway/fleet-vkey.gw2`, 26 B, created 20:01:33).

Gateway #2's key store is the stack's own postgres, table `LiteLLM_VerificationToken` (columns `token`,
`key_alias`, `rpm_limit`, `tpm_limit`, `max_budget`, `budget_duration`, `models`, …). It holds exactly one
row, `fleet-agent-gw2`, whose brake set is **incomplete** — `max_budget` / `budget_duration` NULL
(rpm 120 / tpm 1 000 000 set, budget absent): *metered, never capped*. Nothing stops a runaway agent
from spending the whole upstream budget inside the rpm/tpm window, and the doctor's own message says
exactly that: *"the budget is the only brake on a runaway agent"*.

The store's spend logs show why the estate drifts: three different fleet key hashes in twenty minutes
(`c40379f9…` = the gateway-#2 key, `a0d685a9…` = the production key, `02d3c926…` = a third key used by
a worker) against **one** key record. The key store that *could* assert the brakes is not the store all
the traffic passes through.

> Verification note: the doctor's source (`/root/.hermes/fleet/fleet-doctor.py`) and gateway #2's
> postgres are both root-only (`/root` is `drwx------ root root`; there is no `psql`/`psycopg2` on this
> host), so the row contents above are the state established by the immediately preceding card
> (`t_88dc6a4e`, PR #39) from a read of that store, plus the live `/key/info` record quoted above,
> which **was** re-read from the production gateway during this run. The fix in (a) is written so it
> verifies the record afterwards rather than trusting this paragraph.

### Root cause: the provisioning path does not guarantee the brake set

The key was rotated on 2026-11-23 at **19:12:39 local** (22:12:39Z — the `created_at` above):

```
19:12:24  ok: gateway key authenticates (https://llm.paragu-ai.com)   <- last PASS
19:12:39  the new production key is CREATED on the gateway
19:12:51  /etc/fleet-agent/.litellm.env.BALa3h  (0 bytes, root:root)   <- leftover of the rewrite
19:13:14  /etc/fleet-agent/litellm.env rewritten (44 B, root:fleet 0640)
19:36:56  first failing self-check run
```

The 0-byte `.litellm.env.BALa3h` is the fingerprint of an in-place rewrite that truncated the key file
before writing the new value. Gateway #2 was rebuilt the same evening (`litellm.yml` rewritten 19:52 with
the `network_mode: host` migration, `.env.litellm` rewritten 20:09) and **its** key was re-created at
20:01:33 — also without a complete brake set. So the invariant the doctor enforces is not guaranteed
anywhere in the key-provisioning path: it is re-broken on every rotation.

### Fix (as root on hermes)

**a) Give gateway #2's key the missing brake set, and verify the record:**

```bash
. /opt/stacks/fleet-gateway/.env.litellm                 # LITELLM_MASTER_KEY (0600, root)
GW2_KEY=$(cat /opt/stacks/fleet-gateway/fleet-vkey.gw2)
curl -s -X POST http://100.78.180.49:4001/key/update \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$GW2_KEY\",\"rpm_limit\":120,\"tpm_limit\":1000000,\
       \"max_budget\":5.0,\"budget_duration\":\"30d\"}"

# verify — the record must show the limits AND the budget
curl -s http://100.78.180.49:4001/key/info \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$GW2_KEY\"}" | python3 -m json.tool
# expect: rpm_limit 120, tpm_limit 1000000, max_budget 5.0, budget_duration 30d
```

**b) Fix the rotation, which is the actual root cause** — create the key *with* the brakes attached and
verify before installing the file:

```bash
NEW_KEY=$(curl -s -X POST https://llm.paragu-ai.com/key/generate \
  -H "Authorization: Bearer $PROD_MASTER_KEY" -H 'Content-Type: application/json' \
  -d '{"key_alias":"fleet-agent","rpm_limit":120,"tpm_limit":1000000,\
       "max_budget":5.0,"budget_duration":"30d",\
       "models":["fleet-primary","fleet-coding","fleet-reasoning","fleet-fast",\
                 "fleet-m3","fleet-glm","fleet-nemotron"],\
       "metadata":{"purpose":"fleet workers","owner":"alejandro"}}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["key"])')

curl -s https://llm.paragu-ai.com/key/info -H "Authorization: Bearer $NEW_KEY" \
  | grep -E '"(rpm_limit|tpm_limit|max_budget|budget_duration)"'      # must be non-null

install -m 0640 -o root:fleet /dev/null /etc/fleet-agent/litellm.env   # then write FLEET_LITELLM_KEY=$NEW_KEY
rm -f /etc/fleet-agent/.litellm.env.BALa3h                            # the 0-byte leftover of 19:12:51
```

**c) Make the self-check and the doctor look at the same key.** Today the self-check probes the
production gateway with `fleet-agent`, gateway #2 issues `fleet-agent-gw2`, and a third key is in live
use with no record in either store. Three keys, three rotation paths, three chances to forget the
limits — and the doctor's check cannot even name the key it judges. Pick one primary gateway, point
`/etc/fleet-agent/litellm.env` at *its* key, register every fleet key in that gateway's store, and have
the doctor print the key alias it is judging, so a missing brake is visible in exactly one place.

**d) Re-run:**

```bash
python3 /root/.hermes/fleet/fleet-doctor.py      # expect: no FAIL on "gateway / key rate limits"
systemctl start fleet-selftest.service && tail -40 /var/log/fleet-selftest.log
```

---

## 3. `fleet-doctor: FAIL board task counts blocked=1, cancelled=4, done=26, ready=1, running=1`

**Reading of the line.** A task-count check fails because one of the counts is outside what the fleet
tolerates. Of the five counts, four are the normal shape of a working board:

* `done=26` — the fleet has been productive;
* `cancelled=4` — ordinary churn across 33 cards;
* `ready=1` — work waiting to be claimed;
* `running=1` — **this very card** (`t_a6934d93`), claimed by the dispatcher at 20:10.

The anomaly is **`blocked=1`**: a card that is *not* running, *not* ready, and *not* finished — it is
parked, with no owner making progress.

**Nothing on this host clears it automatically.** Both reapers that run on hermes operate on *processes*,
not on board cards: `fleet-wedge-reaper.service` kills orphaned/wedged whole-tree recursive greps
(`/var/log/fleet-wedge-reaper.log`: `killing pid=… reason=orphan … cmd=grep -rl …`) and
`hermes-orphan-reaper` reaps orphaned worker processes (`reaped=0 live=2` every 10 minutes). Neither
writes to the board — there is no `blocked` entry anywhere in `/var/log/hermes-orphan-reaper.log`. A
blocked card is therefore **stuck until an operator moves it**, which is exactly the "the dispatcher is
active but nothing can run" shape this whole watchdog was built to catch: the dispatcher is alive, the
board is readable, no lease is expired — and one card will never move.

**Fix (as root on hermes):**

```bash
# 1. see the blocked card and why it is blocked
sqlite3 /root/.hermes/fleet-board/kanban.db ".schema tasks"
sqlite3 -header -column /root/.hermes/fleet-board/kanban.db \
  "select id,title,assignee,status,updated_at from tasks where status='blocked';"

# 2. requeue it, so the dispatcher can claim it again
sqlite3 /root/.hermes/fleet-board/kanban.db \
  "update tasks set status='ready', claim_expires=null, updated_at=strftime('%s','now') \
   where id='<id of the blocked card>';"

# 3. confirm the board moved
sqlite3 /root/.hermes/fleet-board/kanban.db \
  "select status,count(*) from tasks group by status;"
```

**Also fix the check itself**, so the doctor says *why* it is unhappy instead of dumping a count vector:
the board check should name the offending card and the bound it violated (e.g. "blocked=1 > 0"), and —
like the TCP probes — should allow a card to sit blocked for a grace period before failing. A card that
is blocked for a minute while a worker is being reaped is not a fault; a card blocked for an hour is.

> Verification note: the board database (`/root/.hermes/fleet-board/kanban.db`) and the doctor source
> are root-only from this card, so the blocked card's identity could not be read here; the counts above
> are exactly as the doctor printed them in `/var/log/fleet-selftest.log` at 20:10:17.

---

## 4. `fleet-doctor: FAIL one worker sha workers differ: beelink,wiseq-vps=334b61752f9b; victus=1bf42e07507b`

**Reading of the line.** The fleet's invariant is *one worker sha*: every worker runs the **same**
agent build, so a card behaves identically whichever node picks it up. Two nodes agree on
`334b61752f9b`; **`victus` runs `1bf42e07507b`**. That is not drift by accident — it is a node that was
enrolled or updated on a different build and never re-synced. The consequences are exactly the ones the
invariant exists to prevent: a card's behaviour depends on which node the dispatcher hands it to, and a
bug fixed on one node stays broken on the other.

(The two SHAs are agent-build commits, not commits of this repository — neither resolves in
`IvanWeissVanDerPol/ai-whisperers-packages`.)

**Fix — re-sync `victus` to the fleet SHA (on the victus node, or from here over SSH as root):**

```bash
# what victus currently runs
ssh victus 'cd /root/.hermes/hermes-agent && git rev-parse --short=12 HEAD'

# what the fleet runs (take it from either healthy node)
ssh beelink 'cd /root/.hermes/hermes-agent && git rev-parse --short=12 HEAD'   # 334b61752f9b

# re-sync victus to the fleet SHA and restart its worker
ssh victus 'cd /root/.hermes/hermes-agent && git fetch --all && git checkout 334b61752f9b && git pull --ff-only'
ssh victus 'systemctl restart fleet-worker@victus.service'
```

**Fix — stop it recurring.** The SHA a worker reports must be recorded at *enrolment* and re-checked on
every upgrade, not only by the doctor's periodic diff:

* `install-worker.sh` should pin the agent ref it installs and record the resulting
  `git rev-parse HEAD` next to the node in `dispatcher.json`, so enrolment cannot silently pick a
  different build;
* the upgrade path must roll *all* nodes to the same SHA before the doctor is run again — a partial
  rollout is exactly the window in which this check fires;
* the doctor should report the SHA it expects alongside the one it found, e.g.
  `workers differ: expected 334b61752f9b; victus=1bf42e07507b`.

**Verify:**

```bash
python3 /root/.hermes/fleet/fleet-doctor.py      # expect: no FAIL on "fleet / one worker sha"
for n in hermes beelink wiseq-vps victus; do
  ssh "$n" 'cd /root/.hermes/hermes-agent && git rev-parse --short=12 HEAD'
done                                            # all four must print 334b61752f9b
```

---

## What this run changed, and what it could not

This repository (`IvanWeissVanDerPol/ai-whisperers-packages`) holds only the shared packages monorepo
(`ui/`, `tokens/`, `deploy/`) plus the fleet's evidence files. **None** of the runtime involved above
lives in it:

* `/usr/local/bin/fleet-selftest.sh` — root:root 0755, `/usr/local/bin` root:root 0755 → not writable;
* `/root/.hermes/fleet/fleet-doctor.py` and the board — under `/root` (`drwx------ root root`) → not
  readable, not writable;
* `/opt/stacks/fleet-gateway/` (`litellm.yml`, `configs/litellm-config.yaml`, `.env.litellm`,
  `fleet-vkey.gw2`) — root-owned, secrets 0600 → not writable;
* `/etc/fleet-agent/litellm.env` — root:fleet 0640 → writable by root only;
* `sudo -n` is refused for `fleet-agent`, and `/var/run/docker.sock` is `root:docker 0660` with `fleet`
  **not** in the `docker` group → no container access either.

This card's scope is the repository, so the runtime changes above are specified here as exact commands
and a drop-in patch, ready for a root-capable operator or worker, instead of being applied silently
from a pull request that cannot reach them. The one change in this working tree is this report: **no
tracked file modified, no CI config, workflow, secret or lockfile touched, nothing under `.git`
touched, and no command was run against a remote.**

## Evidence index

* `/var/log/fleet-selftest.log` — last gateway PASS 19:12:24 / 19:12:55; the 15 s gaps before every
  gateway FAIL (19:37:12, 19:39:35, 19:40:41, 20:09:36); the hub SSH FAIL at 19:37:52; doctor FAILs at
  19:38:31, 19:40:15, 19:41:21 and 20:10:17 (the last one carrying all three doctor FAILs); card
  filings at 19:38:41, 19:40:17 (skipped as duplicate 19:41:27) and 20:10:26.
* `/usr/local/bin/fleet-selftest.sh` — section 3 (gateway probe, lines 125-138), section 2/5 (`probe_ssh`,
  three attempts, "offline in the tailnet" treated as a warning), section 6 (doctor), section 7 (document
  guard); `GATEWAY_URL` default at line 28; the header comment recording the 14:38 cry-wolf incident.
* `/etc/systemd/system/fleet-selftest.service{,.timer}` — `User=root`, `HERMES_HOME=/root/.hermes`,
  30-minute timer, no drop-in.
* `/etc/systemd/system/fleet-wedge-reaper.service` + `/var/log/fleet-wedge-reaper.log` and
  `/var/log/hermes-orphan-reaper.log` — the host's two reapers; both act on processes, never on board
  cards, so a blocked card has no automatic clearing path.
* `/etc/fleet-agent/litellm.env` (44 B, 19:13:14, root:fleet 0640) and
  `/etc/fleet-agent/.litellm.env.BALa3h` (0 B, 19:12:51, root:root).
* `/opt/stacks/fleet-gateway/` — `litellm.yml` (host-network stack, 19:52),
  `configs/litellm-config.yaml` (fleet model groups + aliases, metered per-token costs),
  `.env.litellm` (0600, rewritten 20:09), `fleet-vkey.gw2` (26 B, 20:01:33).
* Gateway #2 key store — postgres `127.0.0.1:5433/fleet_litellm`, table `LiteLLM_VerificationToken`:
  the single row `fleet-agent-gw2` with an incomplete brake set; `LiteLLM_SpendLogs` showing the three
  fleet key hashes in use.
* `https://llm.paragu-ai.com/key/info` — the live record of the production `fleet-agent` key
  (rpm 120, tpm 1 000 000, budget 5.0/30d, spend 0.619853, created 22:12:39Z) — **re-read during
  this run**.
* Live gateway probe from this host, this run: `https://llm.paragu-ai.com/v1/models` → `200` in
  0.043 / 0.047 / 0.047 s with the key, `401` without it; `http://100.78.180.49:4001/health/liveliness`
  → `200`.
* `curl` exit-code semantics measured on this host: killed → no status line + rc 124; DNS failure →
  `000` + rc 6; rejected key → `401`.
* `/etc/hosts` — `100.79.181.37 llm.paragu-ai.com` (tailnet-pinned, "the public IP cannot hairpin").
* Prior cards: `t_88dc6a4e` (PR #39, same two primary findings, gateway #2 key-store read),
  `t_9badbe42` (PR #35), `t_2af83d32` (PR #31), `t_388107ce` (PR #29, the 14:38 path-blip card).
