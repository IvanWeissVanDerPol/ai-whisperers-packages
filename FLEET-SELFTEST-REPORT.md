# Fleet self-check failure — diagnosis

**Host:** hermes — `hermes.paragu-ai.com`, tailnet `100.78.180.49`
**Self-check:** `/usr/local/bin/fleet-selftest.sh` (root:root 0755), `fleet-selftest.timer`, every 30 min
**Reported failure:** `gateway key did not authenticate (http 400)`
**Failing run:** 2026-11-26 00:01:39 -03:00 → card filed 00:02:04 -03:00
**Canonical source:** `IvanWeissVanDerPol/fleet-runtime` (`fleet-selftest.sh`, `fleet-doctor.py`, `fleet_probe.py`)

## Summary

**The key was never rejected, and the failure message names the wrong thing.**

The reported `http 400` is not an authentication failure — the LiteLLM gateway answers an
authentication failure with **401**, and answers **400** only for a *malformed request*. The check
that produced the message (`fleet-selftest.sh:125-139`) treats *every* non-200 as "the key did not
authenticate", so it cannot tell a dead key from a gateway hiccup, and it runs the probe **once**,
with no retry and with the response body thrown away.

The proof that the key was good is in the same run, 23 seconds later:

```
2026-11-26T00:01:39-03:00 FAIL: gateway key did not authenticate (http 400)
2026-11-26T00:01:39-03:00 ok: board readable, no stuck leases
2026-11-26T00:02:02-03:00 ok: fleet-doctor checks: 37   PASS: 35   WARN: 2   FAIL: 0
```

The doctor's `gateway  key rate limits` check asks the **same key** for `/key/info` and only PASSes
when the answer carries `rpm_limit` **and** `tpm_limit` — i.e. only on a real HTTP 200. It passed.
So within one self-check cycle the key authenticated against the same gateway, and the self-check
still called it "did not authenticate".

There are **two** defects, and the card only names one of them:

| # | Defect | Where | Status |
| --- | --- | --- | --- |
| **A** | The gateway check is a single un-retried probe that maps every non-200 to "the key did not authenticate", and it discards the body that would say what actually happened. | `fleet-selftest.sh:125-139` | **live, and it is the cause of the card** |
| **B** | `/etc/fleet-agent/litellm.env` now points `FLEET_LITELLM_KEY` at a key that exists in **neither** gateway's key store, so the check fails again — this time with a genuine `401`. | `/etc/fleet-agent/litellm.env` | **live, and it reproduces every 30 min** |

Defect **B** is why the check is failing *right now*, and it is the one that must be fixed for the
watchdog to go quiet. Defect **A** is why a transient gateway hiccup became a fleet card in the first
place.

---

## 1. The failing check, exactly

`/usr/local/bin/fleet-selftest.sh:125-139` (identical in the canonical
`fleet-runtime` repo, `fleet-selftest.sh:125-139`):

```bash
# --- 3. gateway key --------------------------------------------------------
if [ -r /etc/fleet-agent/litellm.env ]; then
  # shellcheck disable=SC1091
  . /etc/fleet-agent/litellm.env
  code=$(timeout 15 curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${FLEET_LITELLM_KEY:-}" \
    "$GATEWAY_URL/v1/models" 2>/dev/null)
  if [ "$code" = "200" ]; then
    log "ok: gateway key authenticates ($GATEWAY_URL)"
  else
    note_fail "gateway key did not authenticate (http $code)"
  fi
else
  note_fail "no gateway key file (/etc/fleet-agent/litellm.env)"
fi
```

Three properties of this block are the whole problem:

1. **One shot, no retry.** The SSH probe in the same script retries three times with a 5 s pause and
   even distinguishes "machine is off" from "machine is up and not answering" (`probe_ssh`,
   `peer_offline`). The gateway probe — the one check that decides whether the fleet can spend a
   token — has no retry at all.
2. **The body is discarded.** `curl -s -o /dev/null` throws the gateway's own error away, so the
   script cannot report *why* it failed. It has the status code and nothing else.
3. **Every non-200 becomes the same sentence.** `note_fail "gateway key did not authenticate (http
   $code)"` asserts a *cause* it has not established. The status code is carried along, but the
   wording tells the next reader that the key was rejected — and for `400` that is provably false.

The script also swallows `curl`'s stderr (`2>/dev/null`), and `curl` exits **0** on an HTTP 400, so
even the exit status carries no information.

## 2. The gateway does not answer 400 for an authentication failure

Measured directly against the production gateway (`https://llm.paragu-ai.com`, reachable over the
tailnet via `/etc/hosts` → `100.79.181.37`):

| Request | Status |
| --- | --- |
| `GET /v1/models`, valid key | **200** |
| `GET /v1/models`, no `Authorization` header | **401** `auth_error` — "No api key passed in." |
| `GET /v1/models`, `Authorization: Bearer sk-notarealkey` | **401** `token_not_found_in_db` |
| `GET /v1/models`, key truncated | **401** `token_not_found_in_db` |
| `GET /v1/models`, `Authorization: sk-…` (no `Bearer ` prefix) | **401** `auth_error` — "Ensure Key has \`Bearer \` prefix." |
| `GET /v1/models`, tab instead of space after `Bearer` | **401** |
| `GET /v1/models`, non-ASCII byte in the key | **401** |
| `POST /v1/chat/completions`, malformed JSON body | **400** |
| `POST /v1/chat/completions`, unknown model | **401** |
| `POST /v1/chat/completions`, `messages` missing | **500** |

**Every authentication failure is a 401. A 400 only appears when the request body is malformed.**
The self-check's probe is a bodiless `GET /v1/models`, so it cannot legitimately receive a 400 for
any reason the key is responsible for. The message on the card —
*"gateway key did not authenticate (http 400)"* — was therefore false on both halves: the key did
authenticate, and the status was not an authentication status.

## 3. The key authenticated in the same cycle, 23 seconds later

`fleet-doctor.py` asks the same key a different, richer question and only passes on a real answer:

```python
# fleet-doctor.py:125-127
rc, out, _ = sh(". /etc/fleet-agent/litellm.env 2>/dev/null && "
                "curl -s -m 15 https://llm.paragu-ai.com/key/info "
                "-H \"Authorization: Bearer $FLEET_LITELLM_KEY\"")
```

and then requires a populated meter:

```python
record("gateway", "key rate limits", "PASS" if rpm and tpm else "FAIL", ...)
```

`rpm_limit` and `tpm_limit` can only be populated from a successful `/key/info` response. The
doctor reported `PASS: 35 … FAIL: 0` at 00:02:02 — the same key, the same gateway, the same run.
Two more `PASS: fleet is able to work` cycles followed at 00:31:39 and 00:48:29 with the identical
key file.

Direct verification of the same command the self-check runs:

```bash
$ . /etc/fleet-agent/litellm.env     # the file as it stood at 00:01
$ curl -s -o /dev/null -w '%{http_code}\n' \
    -H "Authorization: Bearer ${FLEET_LITELLM_KEY}" \
    "https://llm.paragu-ai.com/v1/models"
200
```

30 sequential runs and 30 concurrent runs of that exact command, with the key that was in the
file at 00:01, returned `200` every time — 60 requests, no failure. No input to that probe
produced a 400.

**Conclusion for the reported card:** the 400 came from the request/response path, not from the
key. The single-shot probe hit the gateway while it was serving a malformed-request response of its
own, and the check turned that into "the key did not authenticate".

## 4. The live failure — defect B: the key file now points at a key that exists nowhere

While the diagnosis was running, `/etc/fleet-agent/litellm.env` was **rewritten at 00:59:24** by a
concurrent fleet card (`t_3c4f4fa6` / `t_7b018c52`, which were building the gateway-fallback wiring
at the same time — `/opt/stacks/fleet-gateway/configs/litellm-config.yaml` has backups stamped
`2026-11-26-004810` and `2026-11-26-005418`).

```
before (until 00:59:24)          after (from 00:59:24)
FLEET_LITELLM_KEY=sk-xkvyw…eX7Q   FLEET_LITELLM_KEY=sk-pjasA46kPMsq0kx_9mJUAg
                                  FLEET_LITELLM_KEY2=sk-PqkcY9NhsHMmG5JiUH8rDQ
```

Current state of the two gateways with the two keys now in the file:

| Key | gateway #1 `https://llm.paragu-ai.com` | gateway #2 `http://100.78.180.49:4001` |
| --- | --- | --- |
| `sk-pjasA46kPMsq0kx_9mJUAg` (`FLEET_LITELLM_KEY`) | **401** `token_not_found_in_db` | **401** `token_not_found_in_db` |
| `sk-PqkcY9NhsHMmG5JiUH8rDQ` (`FLEET_LITELLM_KEY2`) | 401 | **200** — valid (`/key/info` 200, `/v1/models` 200, `chat/completions` 200) |
| `sk-xkvywsNtSqy6YVv2MJeX7Q` (the previous primary) | **200** — still valid | 401 |

`sk-pjasA46kPMsq0kx_9mJUAg` was written into the file but was never registered in either
LiteLLM key store, so the self-check now fails with a *genuine* 401 — reproduced live:

```
2026-11-26T01:01:49-03:00 FAIL: gateway key did not authenticate (http 401)
```

The previous primary key is still valid on gateway #1 (key `a0d685a9…`, `rotation_count: 0`,
`auto_rotate: false`, expires 2027-11-23), so this is a half-completed key rotation, not a
revocation: the new primary was created and written to the file without being created on the
gateway it is used against.

## 5. The fix

### 5.1 Immediate — make the file point at a key the gateway knows

On the dispatcher host, as root (the file is `root:fleet 0640`; `fleet-agent` cannot write it):

```bash
# Option 1 (smallest change, keeps gateway #1 as the primary):
#   restore the previous primary, which gateway #1 still accepts
sed -i 's|^FLEET_LITELLM_KEY=.*|FLEET_LITELLM_KEY=sk-xkvywsNtSqy6YVv2MJeX7Q|' /etc/fleet-agent/litellm.env

# Option 2 (preferred, and what the estate intends):
#   register the new primary on gateway #1 as well, so both gateways know it
#   (create-fleet-vkey.py --base https://llm.paragu-ai.com on the hub), then:
#   FLEET_LITELLM_KEY  = a key known to gateway #1
#   FLEET_LITELLM_KEY2 = a key known to gateway #2  (already true for sk-PqkcY9NhsHMmG5JiUH8rDQ)

# then confirm both halves are wired:
curl -s -o /dev/null -w 'gw1 %{http_code}\n' -H "Authorization: Bearer $FLEET_LITELLM_KEY" \
     https://llm.paragu-ai.com/v1/models
curl -s -o /dev/null -w 'gw2 %{http_code}\n' -H "Authorization: Bearer $FLEET_LITELLM_KEY2" \
     http://100.78.180.49:4001/v1/models
```

Expected: `gw1 200` and `gw2 200`.

`/home/fleet-agent/.minimax/config.yaml` already points the two providers at the two gateways
(`apiKey: ${FLEET_LITELLM_KEY}` → `https://llm.paragu-ai.com`, and `apiKey: ${FLEET_LITELLM_KEY2}`
→ `http://100.78.180.49:4001`), and `fleet-worker@.service` pulls the file in as an
`EnvironmentFile`. So fixing the file's contents fixes the workers too.

### 5.2 Durable — stop a hiccup from becoming a card (defect A)

The estate has already solved this problem once, in the *doctor*, and never carried the solution
back into the *self-check*. Commit `2602c5c` ("The doctor must test the key, not only measure it",
2026-11-26 00:45) added `classify_gateway_call()` to `fleet_probe.py`:

> * **PASS** — the call was served: the gateway answered with a completion.
> * **FAIL** — the gateway answered and proved the **KEY** cannot serve: it is over its ceiling,
>   unknown to the gateway, or not allowed to use the model.
> * **WARN** — the gateway did not answer, the answer could not be parsed, or the failure was the
>   provider's rather than the key's.
>
> "The distinction is the one fleet_probe already enforces: **only an answer may ever be a FAIL**.
> An inconclusive probe stays a WARN, so a flaky gateway or a provider outage cannot cry wolf."

The self-check's gateway block is still the old one-shot version, so it does not apply that rule.
Two changes in `fleet-selftest.sh` close the card loop:

1. **Retry, and keep the body.** Mirror `probe_ssh`: three attempts, and capture the body and the
   status together (`curl -s -w '__HTTP__%{http_code}'`), the same marker the doctor uses.
2. **Classify before failing.** Route the result through `classify_gateway_call()` (or the equivalent
   in the shell):
   * `200` with a model list → `ok: gateway key authenticates`;
   * `401` / `token_not_found_in_db` / `budget_exceeded` → a real **FAIL** that names the key;
   * `400`, `5xx`, a timeout, or an unparsable body → **WARN** (or a retry), never "did not
     authenticate".
   Only a *proved* key fault may file a card. A `400` from `GET /v1/models` is by construction not a
   key fault — it is a malformed request or a gateway-side error — so it must not file one.

### 5.3 Why the key should be checked on both gateways

The estate runs two independent LiteLLM proxies — the production one on `paragu-ai` and the fleet's
own on `hermes` (`100.78.180.49:4001`, own PostgreSQL on `127.0.0.1:5433`, own Redis on
`127.0.0.1:6399`). The fleet's whole redundancy argument rests on the second one being usable, and
the check that could prove it only ever asks the first. `FLEET_LITELLM_KEY2` currently works on
gateway #2 and the primary works on gateway #1 — but neither check would notice if one of the two
keys were revoked, which is exactly what happened here.

## 6. Verification

```bash
# 1. the key in the file is accepted by gateway #1
$ . /etc/fleet-agent/litellm.env
$ curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $FLEET_LITELLM_KEY" \
    https://llm.paragu-ai.com/v1/models
200

# 2. the fallback key is accepted by gateway #2
$ curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $FLEET_LITELLM_KEY2" \
    http://100.78.180.49:4001/v1/models
200

# 3. a real model call is served through gateway #2 (the fallback path)
$ curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    -H "Authorization: Bearer $FLEET_LITELLM_KEY2" -H 'Content-Type: application/json' \
    -d '{"model":"fleet-coding","messages":[{"role":"user","content":"hi"}]}' \
    http://100.78.180.49:4001/v1/chat/completions
200

# 4. the self-check goes green again
$ systemctl start fleet-selftest.service
$ tail -20 /var/log/fleet-selftest.log | grep -E "gateway key|PASS: fleet is able to work"
ok: gateway key authenticates (https://llm.paragu-ai.com)
PASS: fleet is able to work
```

## 7. Scope note

This report was produced from the `ai-whisperers-packages` worktree, which holds no fleet runtime
code — the self-check, the doctor and the probe helper live in `IvanWeissVanDerPol/fleet-runtime`,
and the live copies are `/usr/local/bin/fleet-selftest.sh` and `/root/.hermes/fleet/`. The agent
that ran this diagnosis has no write access to any of them (`fleet-agent`, no `sudo`, `no_new_privs`),
and `/etc/fleet-agent/litellm.env` is `root:fleet 0640`. The remediation in §5 therefore has to be
applied by root on the dispatcher host; §5.2 is a change to `fleet-selftest.sh` in the
`fleet-runtime` repository, which is where the canonical source of that script lives.

Two other failures observed in the same window were **not** part of this card and were left alone:
`worker node beelink (100.85.215.6) is not answering` (the tailnet reports that machine OFFLINE,
so the watchdog correctly treats it as a warning, not a fleet fault) and the `fleet-doctor` `WARN`
count drifting between 1 and 2.
