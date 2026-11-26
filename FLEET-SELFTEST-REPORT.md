# Fleet self-check failure — diagnosis

**Card:** fleet self-check on hermes (`t_a8cf4b5b`)
**Host:** hermes — `hermes.paragu-ai.com`, tailnet `100.78.180.49`
**Self-check:** `/usr/local/bin/fleet-selftest.sh` (root:root 0755), `fleet-selftest.timer`, every 30 min
**Failing runs:** 2026-11-25 21:44:19 and 21:50:51 (-03:00) · **Last passing run:** 21:14:16 (-03:00)
**Watchdog:** `/root/.hermes/fleet/fleet-doctor.py` — byte-identical to `fleet-runtime` `master` (`md5 f84eeaed35d0fe7e405f80b2b8c31288`)

## Summary

The single failing check is the doctor's **board task-count rule**, and `blocked=2` is the whole
verdict. `cancelled=4`, `done=38` and `running=1` are ordinary churn and are not part of the failure.

```python
# fleet-doctor.py:100-104
counts = dict(conn.execute("select status, count(*) from tasks group by status"))
bad = counts.get("failed", 0) + counts.get("blocked", 0)
record("board", "task counts", "PASS" if bad == 0 else "FAIL", ...)
```

The two blocked cards are cards the **dispatcher gave up on** after their agent turn died on a
**gateway error**, not cards waiting for a human. The chain is:

```
upstream token-plan quota exhausted on model group "fleet-coding"
   -> mcode exec exits 4 (RateLimitError / 502 Bad Gateway)
   -> dispatcher retries, hits its give-up limit (effective_limit: 2), releases the claim
      and parks the card in status=blocked
   -> doctor's board rule: bad = failed + blocked = 2  ->  FAIL
   -> watchdog files "Fleet self-check failure" every 30 minutes
```

**The upstream quota was transient.** The same call that failed at 21:23 succeeds now (HTTP 200,
see [§5](#5-verification-reproduced-live)), so the cards are already parked and will not clear
themselves — there is no reaper for `blocked` cards. That is why the check is *still* failing
although the gateway is healthy again.

Two separate defects are involved, and the watchdog/doctor are looking at the wrong one:

| # | Defect | Where |
| --- | --- | --- |
| **A** | The fleet has **no working gateway fallback**, although the estate is built with two. The fleet key is unknown to the fleet's own gateway #2, so the one upstream quota is a single point of failure for the whole fleet. | runtime, outside this repo |
| **B** | The doctor's board rule reports a **symptom as a cause**: it FAILs on any `blocked` card, cannot say *which* card or *why*, and its gateway checks measure a brake that was not the one that broke. | `fleet-doctor.py` in `fleet-runtime` |

---

## 1. The failing check, exactly

`/usr/local/bin/fleet-selftest.sh:183-195` runs the doctor and turns any `FAIL` line into a
watchdog failure:

```bash
DOCTOR="$FLEET_DIR/fleet-doctor.py"
doctor_out=$(timeout 300 python3 "$DOCTOR" 2>&1)
...
note_fail "fleet-doctor reported failures: $(printf '%s' "$doctor_fails" | tr '\n' ';')"
```

The doctor emits:

```
FAIL  board     task counts                        blocked=2, cancelled=4, done=38, running=1
```

`bad = failed + blocked`. `failed` is `0`; **`blocked` is `2`**. That single number is the entire
failure. Everything else in that line is context printed by the same `record()` call.

## 2. Timeline — the fleet was healthy 30 seconds before it broke

From `/var/log/fleet-selftest.log` (readable on this host):

```
21:13:52  ok: worker node hermes / wiseq-vps / beelink / victus answers on ssh
21:13:53  ok: gateway key authenticates (https://llm.paragu-ai.com)
21:13:53  ok: board readable, no stuck leases
21:14:16  ok: fleet-doctor checks: 39   PASS: 39   WARN: 0   FAIL: 0     <-- board rule PASSED
21:14:18  FAIL: shared-document guard: .../README.md ...                  <-- the 21:14 card (t_20b24896)

21:23:21  t_7c4c06cc  FAILED  exit 4  litellm.RateLimitError (fleet-coding)
21:25:07  t_3cfd842c  FAILED  exit 4  litellm.RateLimitError (fleet-coding)
   ... the dispatcher gives up on both and parks them in blocked ...

21:43:55  ok: worker nodes / gateway key / board readable, no stuck leases
21:44:19  FAIL: fleet-doctor reported failures: FAIL  board  task counts  blocked=2, cancelled=4, done=38
21:44:21  filed a card for the fleet to investigate

21:50:27  ok: worker nodes / gateway key / board readable, no stuck leases
21:50:51  FAIL: fleet-doctor reported failures: FAIL  board  task counts  blocked=2, cancelled=4, done=38, running=1
21:50:54  filed a card for the fleet to investigate
```

Note what the log says at 21:43 and 21:50, minutes after the fleet was already broken:

* `ok: gateway key authenticates` — the key was fine.
* `ok: board readable, no stuck leases` — the board was fine; `stuck` was `0`.
* `ok: fleet-doctor checks: 39 PASS: 39` at 21:14 — the doctor was green *before* the first
  rate-limited card existed.

So the fleet's own watchdog saw a healthy gateway and a healthy board while every card it ran
was dying. §5 explains why.

## 3. Root cause — the cards were parked because the agent could not reach a model

Two cards failed in the 90 seconds between the last green doctor run and the first failing one.
Their result files (`/srv/fleet/results/*.json`) are the primary evidence:

```json
// t_7c4c06cc.json  — started 1795652601, ended 1795652709
"status": "failed",
"error": "the agent exited 4: ode exec failed: The run failed: litellm.RateLimitError:
          RateLimitError: OpenAIException - Token Plan usage limit reached: Upgrade your Token
          Plan or purchase Credits for more usage. (2056). Received Model Group=fleet-coding
          Available Model Group Fallbacks=None. Retry after the connection recovers.\n"
```

```json
// t_3cfd842c.json — started 1795652707, ended 1795652739   (same error, 2 s later)
```

```json
// t_0058fa03.json — started 1795654356, ended 1795654362   (21:52, after the last snapshot)
"error": "the agent exited 4: mcode exec failed: The run failed: 502 Bad Gateway.
          Retry after the connection recovers.\n"
```

Three things are in that message and all three matter:

1. **`Received Model Group=fleet-coding`** — the failure is scoped to one model group, not to
   the fleet as a whole.
2. **`Available Model Group Fallbacks=None`** — the gateway had *no* fallback configured for
   that group, so a transient upstream quota became a hard failure.
3. **`502 Bad Gateway`** on the third card — the upstream was flapping between
   "quota exhausted" and "not answering" while the fleet was still pointing at it.

### Why the cards ended up in `blocked`

This is the same mechanism the fleet diagnosed on 2026-11-23 (card `t_b191cf5f`, reported in
`t_7c7bc43a`): the dispatcher retries a failing card, and when it reaches its give-up limit it
**releases the claim and parks the card in `blocked`**. Hermes' own board vocabulary agrees —
the dashboard's Kanban strings describe `blocked` as *"Worker asked for human input"* and
*"Mark this task as blocked? The worker's claim is released."* A card the dispatcher gave up on
looks identical on the board to a card a human must answer, and the doctor's rule treats both as
a fleet fault.

**There is no reaper for `blocked` cards.** The two reapers on this host
(`/var/log/fleet-wedge-reaper.log`) act on *processes*, not on board rows, so nothing on the host
will ever move these two cards out of `blocked`. The symptom therefore persists after the cause
is gone, and the watchdog files a fresh card every 30 minutes.

## 4. Defect A — the estate has two gateways and the fleet is using one

`/opt/stacks/fleet-gateway/configs/litellm-config.yaml` states the intent:

> The fleet points at this gateway first (or second) so that one gateway being down does not
> stop the fleet, and so a runaway agent on one gateway cannot starve the other.

Gateway #2 runs on this host (`100.78.180.49:4001`, host mode, its own PostgreSQL on
`127.0.0.1:5433` and its own Redis on `127.0.0.1:6399`) and maps the groups the fleet uses:

```yaml
router_settings:
  model_group_alias:
    fleet-primary: fleet-m3
    fleet-coding: fleet-m3
    fleet-reasoning: fleet-glm
    fleet-fast: fleet-nemotron
```

**But the fleet's key is not registered in gateway #2.** Proof — the *same* key that works on the
production gateway is rejected by gateway #2:

```bash
$ curl -s -X POST http://100.78.180.49:4001/v1/chat/completions \
      -H "Authorization: Bearer $FLEET_LITELLM_KEY" -d '{"model":"fleet-coding", ...}'
{"error":{"message":"Authentication Error, Invalid proxy server token passed. Received API Key =
 sk-...eX7Q, Key Hash (Token) =a0d685a9f102aeac52a9e8dd1adb2ca67a3dff289218171703541bdaa580bbe5.
 Unable to find token in cache or `LiteLLM_VerificationTokenTable`","type":"token_not_found_in_db"}}
```

Gateway #2 has its own key store and does not know the fleet key, so the fallback is fiction:
the agent config (`/home/fleet-agent/.minimax/config.yaml:211-212`) points at the **production**
gateway only:

```yaml
options:
  apiKey: ${FLEET_LITELLM_KEY}
  baseURL: https://llm.paragu-ai.com
```

One upstream token plan exhausting its quota therefore took the whole fleet down, and — because
`Available Model Group Fallbacks=None` — the production gateway did not even route around it.

The key's own LiteLLM brake was never the problem, which is why nothing warned anyone:

```
/key/info -> {"rpm_limit":120, "tpm_limit":1000000, "max_budget":5.0, "spend":2.440755,
               "budget_duration":"30d", "budget_reset_at":"2026-12-01T00:00:00+00:00"}
```

Budget is 49% unused and the rate limits are set. The limit that actually bit was the **upstream
provider's token plan**, which no check on this host measures.

## 5. Verification — reproduced live

```bash
# 1. The production gateway serves fleet-coding again (the quota was transient)
$ curl -s -o /dev/null -w '%{http_code}\n' -X POST https://llm.paragu-ai.com/v1/chat/completions \
      -H "Authorization: Bearer $FLEET_LITELLM_KEY" -d '{"model":"fleet-coding", ...}'
200                                       # 1.13 s, real completion returned

# 2. Gateway #2 still does not know the fleet key  (fallback is not wired)
$ curl -s -o /dev/null -w '%{http_code}\n' -X POST http://100.78.180.49:4001/v1/chat/completions \
      -H "Authorization: Bearer $FLEET_LITELLM_KEY" -d '{"model":"fleet-coding", ...}'
401                                       # token_not_found_in_db

# 3. The board the doctor reads is not the dashboard board (it is root-only)
$ ls -ld /root/.hermes/fleet-board/kanban.db
drwx------ root root          # -> Permission denied for fleet-agent
$ curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9200/api/plugins/kanban/board
{"columns":[{"name":"triage","tasks":[]}, ... {"name":"blocked","tasks":[]}], ...}   # the dashboard board, empty
```

So the transient upstream condition is over, but **the two parked cards remain parked** and the
doctor will keep failing on them until they are cleared.

## 6. Why the watchdog and the doctor both said "all clear"

This is the part that turned a transient upstream blip into a 30-minute card cycle, and it is
worth stating plainly because it is the same "symptom instead of cause" mistake the README's
ground rules forbid.

* **The watchdog's gateway probe measures the wrong thing.** `fleet-selftest.sh` section 3 checks
  `curl -H "Authorization: …" "$GATEWAY_URL/v1/models"` and requires `200`. Listing models
  consumes **no** token-plan quota, so the probe returned `200` at 21:43 and 21:50 while every
  `/v1/chat/completions` on `fleet-coding` was being rejected with `2056`.
* **The doctor's gateway check measures a brake that was not the one that broke.** `fleet-doctor.py`
  reads `/key/info` and asserts `rpm_limit` and `tpm_limit` are set. They are (120 / 1 000 000), so
  the check PASSes. The limit that actually failed lives in the *upstream provider's* account and
  is invisible to `/key/info`.
* **The board rule names no card.** The FAIL detail is a set of counts. The filed card therefore
  said only `blocked=2` and gave the investigator nothing to act on — the investigator had to
  rediscover, from the results directory, that the cards were rate-limit casualties.
* **`blocked` is a legitimate board state.** A card a human must answer, or a card parked by an
  operator on purpose, is also `blocked=1` and also fails the fleet. The rule has no grace period,
  no attempt threshold and no distinction between "parked by the dispatcher after an
  infrastructure error" and "waiting for a human".

## 7. The fix

### Part A — the root cause (runtime; needs root; outside this repository)

**A1. Register the fleet key in gateway #2, so the fallback is real.** Gateway #2 keeps its own
key store (`fleet-litellm-postgres` on `127.0.0.1:5433`), so the fleet key must be created there
as well:

```bash
# on hermes, as root — creates the same key alias in gateway #2's own key store
docker exec fleet-litellm-postgres psql -U fleet -d litellm -c "\dt"   # confirm the table name first
# then POST the key to gateway #2's admin API with its master key:
curl -s -X POST http://127.78.180.49:4001/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H 'Content-Type: application/json' \
  -d '{"key_alias":"fleet-agent","max_budget":5.0,"budget_duration":"30d","models":["fleet-primary","fleet-coding","fleet-reasoning","fleet-fast","fleet-m3","fleet-glm","fleet-nemotron"],"metadata":{"node":"hermes","owner":"alejandro"}}'
```

**A2. Point the agent at both gateways**, so a quota on one is a blip rather than an outage.
The runtime already supports a fallback list in its provider config — add the second `baseURL`
and let the client fail over:

```yaml
# /home/fleet-agent/.minimax/config.yaml
    options:
      apiKey: ${FLEET_LITELLM_KEY}
      baseURL: https://llm.paragu-ai.com
      fallbackBaseURL: http://100.78.180.49:4001     # the fleet's own gateway
```

**A3. Give `fleet-coding` a real fallback upstream**, so an exhausted token plan is degraded
rather than fatal. The error's `Available Model Group Fallbacks=None` is the literal absence of
this. On the production gateway, set fallbacks for the metered groups onto providers that are
already configured on gateway #2 and are *not* on the same token plan:

```yaml
# production gateway router_settings
fallbacks: [{"fleet-coding": ["fleet-fast", "fleet-reasoning"]},
            {"fleet-primary": ["fleet-fast", "fleet-reasoning"]}]
```

**A4. Clear the two parked cards** so the board returns to a truthful state. This is a board
mutation and needs root; it is a `delete_board_card`-class action, so it is a human decision and
is deliberately **not** performed by this run:

```bash
sqlite3 /root/.hermes/fleet-board/kanban.db \
  "select id, title, status, assignee, claim_expires from tasks where status='blocked';"
# then, per card, requeue or cancel it deliberately — do not bulk-delete
```

### Part B — the doctor's board rule (`fleet-runtime`, the repo that owns `fleet-doctor.py`)

`fleet-doctor.py` lives in the **`fleet-runtime`** repository, not in this one; it cannot be
changed from the repository this card was routed to. The patch below is a drop-in for
`fleet-runtime` `master` and should land there.

```python
# fleet-doctor.py:97-106 — replace
if pathlib.Path(BOARD).exists():
    conn = sqlite3.connect(f"file:{BOARD}?mode=ro", uri=True)
    counts = dict(conn.execute("select status, count(*) from tasks group by status"))
    conn.close()
    bad = counts.get("failed", 0) + counts.get("blocked", 0)
    record("board", "task counts", "PASS" if bad == 0 else "FAIL",
           ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
```

with a rule that (i) names the cards, (ii) separates "failed" (the fleet must act) from "blocked"
(a human, or the dispatcher, owns it), and (iii) does not fail the fleet for a card that was
parked for a reason the fleet already knows about:

```python
if pathlib.Path(BOARD).exists():
    conn = sqlite3.connect(f"file:{BOARD}?mode=ro", uri=True)
    counts = dict(conn.execute("select status, count(*) from tasks group by status"))
    # Name the parked cards: a count is a symptom, an id is something you can act on.
    parked = conn.execute(
        "select id, title, assignee, completed_at from tasks "
        "where status = 'blocked' order by completed_at desc limit 10").fetchall()
    conn.close()

    failed = counts.get("failed", 0)
    record("board", "task counts", "FAIL" if failed else ("WARN" if parked else "PASS"),
           ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    if parked:
        # A blocked card is a legitimate board state ("worker asked for human input").
        # It is a WARN, and it names the cards, so the operator knows which ones to clear.
        record("board", "parked cards", "WARN" if not failed else "FAIL",
               "; ".join(f"{t[0]} {t[2] or ''} {t[1][:40]}" for t in parked))
```

and, in the same file, a check that would have caught *this* incident instead of reporting a
healthy gateway while every card was rate-limited — a cheap probe of one real completion against
the group the fleet actually uses, with a failure budget so a blip is a WARN:

```python
# fleet-doctor.py — after the existing "gateway / key rate limits" check
rc, out, _ = sh(". /etc/fleet-agent/litellm.env 2>/dev/null && curl -s -m 30 "
                "-X POST https://llm.paragu-ai.com/v1/chat/completions "
                "-H \"Authorization: Bearer $FLEET_LITELLM_KEY\" "
                "-H 'Content-Type: application/json' "
                "-d '{\"model\":\"fleet-coding\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],"
                "\"max_tokens\":1}'")
# A real completion is what the fleet spends; /v1/models is not.
ok = rc == 0 and '"choices"' in out
record("gateway", "fleet-coding completion", "PASS" if ok else "FAIL",
       "the metered group answers a real completion" if ok else
       (out[:160] if out else f"probe failed rc={rc}"))
```

The watchdog then needs one small change so the filed card is actionable rather than a bare
count — `fleet-selftest.sh:195` already prints the doctor's FAIL lines verbatim, so once the
doctor names the cards the card body names them too, with no change to the watchdog.

**Keep the existing `FAIL` for `failed` cards.** A card whose run ended `failed` and was never
requeued is the fleet's own responsibility, and that must keep failing the check.

## 8. What this run changed, and what it could not

**Changed:** one new file, `FLEET-SELFTEST-REPORT.md`, at the repository root of the repository
this card was routed to (`ai-whisperers-packages`). It is the only change in the tree; no tracked
file, CI config, workflow, secret, lockfile or `.git` content was touched, and no `git commit`,
`git push` or `gh` command was run.

**Could not change, and why:**

* `fleet-doctor.py` and `fleet-selftest.sh` live in the **`fleet-runtime`** repository
  (`git@github.com:IvanWeissVanDerPol/fleet-runtime.git`). The card was routed to
  `ai-whisperers-packages`, whose tree contains only `tokens/`, `ui/` and `deploy/`. Part B above
  is the exact patch for that repository; it has to land there to be deployed to
  `/root/.hermes/fleet/`.
* The board (`/root/.hermes/fleet-board/kanban.db`, `root:root 0700`), the dispatcher's retry
  budget, gateway #2's key store and the agent's provider config are all root-only on this host.
  Part A is given as exact commands for a root-capable operator. Every board mutation is a
  `delete_board_card`-class action, which `POLICY.md` §2 gates behind a human — so the two parked
  cards were **not** cleared by this run.

All investigation was read-only: `grep`/`tail` over `/var/log/fleet-selftest.log`, the readable
copies of `/usr/local/bin/fleet-selftest.sh`, `/usr/local/bin/fleet-worker`,
`/opt/fleet-source/fleet_contract.py` and `/opt/stacks/fleet-gateway/configs/litellm-config.yaml`,
the readable results in `/srv/fleet/results/`, and HTTP probes against the two gateways and the
local Hermes dashboard API.
