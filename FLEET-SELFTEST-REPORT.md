# Fleet self-check failure — diagnosis

**Card:** `t_20b24896` — "Fleet self-check failure" (filed 2026-11-25 20:14:16 -03:00)
**Host:** hermes — `hermes.paragu-ai.com` (tailnet `100.78.180.49`)
**Self-check:** `/usr/local/bin/fleet-selftest.sh` (root:root 0755), `fleet-selftest.timer`, every 30 min
**Failing run:** 2026-11-25 20:13:48 → 20:14:15 -03:00 → FAIL, card filed 20:14:16
**Reported failure:**

```
shared-document guard: /home/alejandro/Work/fleet/README.md;/home/alejandro/Work/fleet/README.md:
content changed outside the guarded publishers (recorded 14b343032bf9876d841292b7989af20a,
now 2597e8ef284e047599a58abeabcb7a5e) — it was written directly, not through fleet-doc-publish.py
```

## Summary

**The guard was right, but its explanation is wrong, and the real defect is still live.**

The shared fleet README was **not** written behind the publishers' back. It was written *through*
`fleet-readme-publish.py`, by the guarded append publisher, exactly the way the README documents it.
What failed is the publisher's **bookkeeping**: `fleet_doc_state.record()` could not write the
digest state file and **swallowed the error**, so the publisher printed success, the README grew on
disk, and the digest of what was published was never recorded. The guard then compared the file
against a **stale** digest from 18:38 and reported the mismatch as *"written directly, not through
fleet-doc-publish.py"* — a conclusion the evidence contradicts.

The one-line root cause:

```
-rw-r--r-- 1 root root  488 Nov 25 20:19 /home/alejandro/Work/fleet/.published-digests.json
-rw-r--r-- 1 root root    0 Nov 23 17:38 /home/alejandro/Work/fleet/.published-digests.json.lock
$ sudo -u alejandro test -w /home/alejandro/Work/fleet/.published-digests.json && echo WRITABLE
NOT WRITABLE
$ sudo -u alejandro test -w /home/alejandro/Work/fleet/.published-digests.json.lock && echo WRITABLE
LOCK NOT WRITABLE
```

The state file **and its lock** are `root:root 0644`, but the documented publisher invocation runs
as the file's owner (`alejandro`), who therefore cannot open the lock for append → `_locked()`
raises `PermissionError` → `record()` catches it with a bare `except Exception: return {}` → the
digest is never recorded. Every publish run as `alejandro` silently loses its bookkeeping. Only a
publish run as **root** (`sudo -n`, which the hub's own audit shows is the pattern that *does* record)
keeps the state file honest.

```
18:33:25  publish as user  (no sudo)  -> wrote the webui section, NOT recorded (masked at 18:38)
18:33:26  sudo chattr +i               -> bit re-set by hand after the publish
18:38:33  publish as root  (sudo -n)  -> wrote 215998 B, RECORDED  md5 14b343032bf9876d841292b7989af20a
19:45:44  sudo chattr -i
          publish as user  (no sudo)  -> wrote +7893 B,  NOT recorded (lock EACCES, swallowed)
          sudo chattr +i
20:01:18  publish as user  (no sudo)  -> bit set, os.replace() EPERM -> publish FAILED (no change)
20:01:24  sudo chattr -i
          publish as user  (no sudo)  -> wrote +7893 B,  NOT recorded (lock EACCES, swallowed)
          sudo chattr +i
20:14:15  fleet-doc-guard.py -> recorded 14b3430... != current 2597e8e... -> FAIL -> card filed
20:19:15  publish as root  (sudo -n)  -> wrote 228429 B, RECORDED  md5 56ab28f3741257dee48102a3154214cb
20:19:2x  fleet-doc-guard.py -> OK (rc=0)   <-- symptom is gone; the defect is NOT
```

**The symptom was already cleared at 20:19:15** by the same hub session, running the publisher
under `sudo -n` (which records) instead of as the user (which does not). The guard is green right
now. But the ownership bug is still in place, so **the next publish run as `alejandro` will
silently diverge the document again** and the next 30-minute self-check will trip again — this
time against a different digest, which defeats the duplicate-card suppression in
`fleet-selftest.sh` (`[ "$previous" = "$fingerprint" ]`).

Nothing was lost: the README grew monotonically (215998 → 223891 → 228429 bytes), every section
published since 18:33 is present in the file (webui, second pass, fleet-control, app, OAuth), and
the file was never clobbered. This was a **bookkeeping** failure, not a content failure.

## 1. What the failing check actually does

`/usr/local/bin/fleet-selftest.sh`, §7 (lines 202–220) — the only failing check:

```bash
DOC_GUARD="/home/alejandro/Work/fleet/fleet-doc-guard.py"
guard_out=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=10 "$HUB_IP" "python3 $DOC_GUARD" 2>&1)
...
guard_problems=$(printf '%s\n' "$guard_out" | grep -E '^\[FAIL\]' | sed 's/^\[FAIL\] //' | tr '\n' ';')
note_fail "shared-document guard: $guard_problems"
```

The guard itself (`fleet-doc-guard.py` → `fleet_doc_state.verify()`) compares two numbers per
guarded document: the digest the publishers **recorded** (`.published-digests.json`) and the digest
of what is **on disk** now, plus the state of the immutable bit. It is read-only and it is correct
to fail — it detected a real divergence.

The self-check log for the failing cycle (`/var/log/fleet-selftest.log`):

```
2026-11-25T20:13:48-03:00 ok: worker node hermes (127.0.0.1) answers on ssh
2026-11-25T20:13:48-03:00 ok: worker node wiseq-vps (100.107.160.19) answers on ssh
2026-11-25T20:13:48-03:00 ok: worker node beelink (100.85.215.6) answers on ssh
2026-11-25T20:13:49-03:00 ok: worker node victus (100.77.236.100) answers on ssh
2026-11-25T20:13:49-03:00 ok: gateway key authenticates (https://llm.paragu-ai.com)
2026-11-25T20:13:49-03:00 ok: board readable, no stuck leases
2026-11-25T20:13:49-03:00 ok: hub PR publisher (100.104.202.59) answers on ssh
2026-11-25T20:14:13-03:00 ok: fleet-doctor checks: 39   PASS: 39   WARN: 0   FAIL: 0
2026-11-25T20:14:15-03:00 FAIL: shared-document guard: ...content changed outside the guarded publishers...
2026-11-25T20:14:16-03:00 filed a card for the fleet to investigate
```

Everything a card needs was healthy in the same cycle. The fleet itself is fine.

## 2. The evidence, in order

### 2.1 The guard's own report (hub, `/home/alejandro/Work/fleet/.doc-guard.json`, 20:14:15)

```json
"/home/alejandro/Work/fleet/README.md": {
 "exists": true, "immutable": true, "recorded_immutable": true,
 "recorded_md5": "14b343032bf9876d841292b7989af20a",
 "current_md5":  "2597e8ef284e047599a58abeabcb7a5e",
 "published_at": 1795642712
}
```

The immutable bit was **set** and the recorded digest was from `1795642712` = **2026-11-25 18:38:32**.

### 2.2 The document state on the hub

```
$ stat /home/alejandro/Work/fleet/README.md
  File: README.md
  Size: 223891     ... regular file
  Device: 0,57   Inode: 1263310   Links: 1
  Access: 2026-11-25 20:01:24.046777541 -0300
  Modify: 2026-11-25 20:01:24.047777556 -0300
  Change: 2026-11-25 20:01:24.146779069 -0300
  Birth: 2026-11-25 20:01:24.046777541 -0300

$ lsattr -d /home/alejandro/Work/fleet/README.md
----i----------------- README.md          # immutable bit: SET
```

`Birth` = 20:01:24 — the file was **replaced** (new inode) at 20:01:24, which is what the
publishers do (temp file + `os.replace()`), so this is consistent with a publisher write and not
with a `cat >` redirection.

### 2.3 The recorded state (`/home/alejandro/Work/fleet/.published-digests.json`, 18:38:32)

```json
"/home/alejandro/Work/fleet/README.md": {
 "immutable": true, "md5": "14b343032bf9876d841292b7989af20a",
 "published_at": 1795642712, "size": 215998
}
```

The state file's mtime was **18:38** — the last time a publisher could actually record. The file
on disk was 215998 bytes at that moment; by 20:01 it was 223891 bytes.

### 2.4 Who wrote it, from the hub's own audit trail

`/home/alejandro/.minimax/v2/hook-data/user/audit.jsonl` (session `mvs_bac600e…`, "Phone: MiniMax
app installed and fleet control"):

```
19:45:44  cd ~/Work/fleet && sudo chattr -i README.md &&
          ~/Work/fleet/fleet-readme-publish.py ~/Work/fleet/README.md /tmp/fleet-section-2026-11-25.md
          "## 2026-11-25 — Fleet Control from the phone, and the degenerate RNG that hung Sunshine";
          RC=$?; sudo chattr +i README.md; ...
20:01:01  lsattr ~/Work/fleet/README.md; ... tail -25 ~/Work/fleet/README.md; ...
20:01:18  ~/Work/fleet/fleet-readme-publish.py ~/Work/fleet/README.md /tmp/fleet-readme-app-section.md
          "## 2026-11-25 — MiniMax Code app on the phone: installed, and adopted by Play after all"
20:01:24  cd ~/Work/fleet; ls -la .README.md.*.tmp; sudo chattr -i ~/Work/fleet/README.md;
          ~/Work/fleet/fleet-readme-publish.py ~/Work/fleet/README.md /tmp/fleet-readme-app-section.md
          "## 2026-11-25 — MiniMax Code app on the phone: installed, and adopted by Play after all";
          sudo chattr +i ~/Work/fleet/README.md
```

And the matching sudo entries in the hub journal (`ale-pc`):

```
Nov 25 20:01:24 ale-pc sudo[2100102]: alejandro : PWD=/home/alejandro/Work/fleet ; USER=root ;
          COMMAND=/usr/bin/chattr -i /home/alejandro/Work/fleet/README.md
Nov 25 20:01:24 ale-pc sudo[2100110]: alejandro : PWD=/home/alejandro/Work/fleet ; USER=root ;
          COMMAND=/usr/bin/chattr +i /home/alejandro/Work/fleet/README.md
```

**This is the key finding: the guarded publisher was used.** The session ran
`fleet-readme-publish.py` — the *append* publisher — exactly as documented. The guard's message
("it was written directly, not through `fleet-doc-publish.py`") points at the wrong culprit and
sent the investigation after a bypass that never happened.

Both intended sections are in the file today (`grep -c` → 1 each), and the size grew
monotonically. Nothing was clobbered.

### 2.5 Why the publisher ran without the `sudo` that its sibling runs had

Two different hub sessions, the same publisher, two different invocations:

```
18:38:33  sudo -n ./fleet-readme-publish.py ...    -> RECORDED
19:45:44  ./fleet-readme-publish.py ...            -> NOT recorded
20:01:24  ./fleet-readme-publish.py ...            -> NOT recorded
20:19:15  sudo -n ~/Work/fleet/fleet-readme-publish.py ... -> RECORDED
```

The pattern is exact: **`sudo -n` → recorded; plain → not recorded.** The reason is in
`fleet_doc_state.py`:

```python
def _locked():
    lock_path = state_path().with_name(state_path().name + ".lock")
    with open(lock_path, "a+") as lock:          # <-- EACCES for user alejandro (root:root 0644)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        ...

def record(path) -> dict:
    try:
        ...
        with _locked():                           # <-- PermissionError raised here
            state = read_state()
            state[str(p)] = entry
            write_state(state)
        return entry
    except Exception:                             # <-- swallowed, silently
        return {}
```

`record()` is the *only* place that writes the digest of a published document, it is called
**only** after a successful write, and it **never raises**. A publish that cannot record its own
digest therefore looks exactly like a successful publish.

### 2.6 A second, independent silent failure: the immutable bit

`chattr +i/-i` needs `CAP_LINUX_IMMUTABLE`, i.e. root. The publisher's own bit handling is:

```python
def set_immutable(path, on):
    subprocess.run(["chattr", ("+i" if on else "-i"), str(path)],
                   capture_output=True, text=True, check=False)   # <-- EPERM ignored
```

So for a non-root publisher the bit handling is a **no-op with no error**. Consequences:

* **19:45 and 20:01** — the session had to clear and restore the bit by hand with
  `sudo chattr -i` / `sudo chattr +i`. Because the bit was already off when the publisher ran,
  `was_immutable` was `False`, so the publisher did not restore it; the session's `sudo chattr +i`
  did. The file looked perfectly protected afterwards.
* **20:01:18** — the session's first attempt ran *without* clearing the bit; `os.replace()` on an
  immutable file returns `EPERM` and the publish **failed**, which is why the session retried six
  seconds later with the manual `chattr` dance.

The workaround (clearing the bit by hand) is exactly what makes a direct write *possible*, and
the guard cannot distinguish "the publisher ran as root" from "a human cleared the bit and wrote
the file" — it only sees that the digest changed without a matching record.

### 2.7 The detection is order-dependent (and that is why this went unnoticed for 90 minutes)

The guard only compares the file against the **last recorded** digest. An unrecorded write is
caught only if no later *recorded* publish re-records over it:

* The **18:33:25** publish (no `sudo`) *did* write — its section ("MiniMax Code WebUI (2026-11-25)")
  is in the file today — but did **not** record, for the same reason as the later ones. The
  divergence it opened was **masked**: the very next publish, at 18:38, ran as root, re-recorded the
  *whole* file (webui section included) and closed the gap. That is why 90 minutes of unrecorded
  writing produced exactly one card, and why the 18:33 write is invisible in the logs.
* The **18:38:33** publish (`sudo -n`) wrote *and* recorded. The README was 215998 bytes and the
  record matched → green.
* The **19:45:44** publish wrote +7893 bytes and **did not record** → divergence opened.
* The **20:01:24** publish wrote +7893 bytes more and **did not record** → divergence grew.
* The next guard run (**20:14:15**) compared 18:38's digest with 20:01's file → FAIL.

Had the 20:19 root publish happened *before* the next check, the 19:45 and 20:01 divergence would
have been masked by its re-record and the card would never have been filed. The card exists
because of an accident of ordering.

## 3. What is *not* broken (verified during this run, read-only)

| thing | state | evidence |
| --- | --- | --- |
| dispatcher / workers / gateway / board | healthy | same cycle: 4/4 workers on ssh, gateway http 200, `stuck=0` |
| fleet-doctor | healthy | `checks: 39  PASS: 39  WARN: 0  FAIL: 0` in the failing cycle |
| fleet analysis document | intact | recorded == current == `8ec6ca33b412aa8cf6757a3ec92ea4b7`, immutable set |
| `README.md` content | intact | monotonic growth 215998 → 223891 → 228429 B; all five sections published since 18:33 present |
| `README.md` immutable bit | set | `lsattr -d` → `----i-----------------` |
| the guard itself | correct | it detected a real divergence and exited 1 as designed |
| the publisher | correct | append + CAS + atomic rename; it wrote what it was asked to write |

The only broken thing is the **bookkeeping of the publish**: the digest of a published document
could not be written by the user the documentation tells people to publish as.

## 4. The fix

Four changes, in priority order. All of them live on the hub (`/home/alejandro/Work/fleet/`),
i.e. **outside this repository**, so they are given here as exact commands and drop-in patches
rather than applied — see §6.

### 4.1 Immediate — make the state file writable by the publisher's user (root cause)

```bash
# on the hub (ale-pc)
sudo chown alejandro:alejandro \
  /home/alejandro/Work/fleet/.published-digests.json \
  /home/alejandro/Work/fleet/.published-digests.json.lock
chmod 0644 /home/alejandro/Work/fleet/.published-digests.json \
           /home/alejandro/Work/fleet/.published-digests.json.lock
```

`write_state()` replaces the state file atomically (`tmp` + `os.replace`) and the directory
(`/home/alejandro/Work/fleet`, `drwxr-xr-x alejandro alejandro`) is already owned by `alejandro`,
so ownership of the target file is the only thing that blocks the write. The lock file must be
writable too, because `_locked()` opens it with `"a+"`.

**Until this is applied, every publisher must be run as root** (`sudo -n ./fleet-readme-publish.py …`).
That is what actually records the digest today — it is the workaround, not the design.

### 4.2 Make `record()` fail loudly instead of swallowing the failure

A publish must never report success while its bookkeeping is lost. Patch
`/home/alejandro/Work/fleet/fleet_doc_state.py`:

```python
def record(path) -> dict:
    """Record the current digest of `path` as the published one.

    Called by the publishers AFTER a successful write. Raises on failure: a
    publish that cannot record its digest is not a publish.
    """
    p = pathlib.Path(path)
    if not p.exists():
        raise FileNotFoundError(f"cannot record a missing document: {p}")
    entry = {
        "md5": digest(p),
        "immutable": immutable_state(p),
        "published_at": int(time.time()),
        "size": p.stat().st_size,
    }
    with _locked():
        state = read_state()
        state[str(p)] = entry
        write_state(state)
    return entry
```

and make the lock robust so it never needs write access (a read-only fd can be `flock`ed):

```python
def _locked():
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(path.name + ".lock")
    fd = os.open(lock_path, os.O_CREAT | os.O_RDONLY, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
```

The publishers must then **not** swallow the new exception either — `fleet-readme-publish.py` and
`fleet-doc-publish.py` both call `fleet_doc_state.record(target)` inside a `try/except Exception`
that re-raises. Print an explicit line so the session that published can see it:

```
FAIL: the document was written but its digest could not be recorded — the state file
      /home/alejandro/Work/fleet/.published-digests.json is not writable by this user.
      Run the publisher with sudo, or fix the ownership of the state file.
```

### 4.3 Let the publishers re-record an unchanged document (self-heal)

`record()` is called only on the write path, so today there is **no supported way** to bring the
record back in line with a document that is already on disk: both publishers take the early exit

```python
# fleet-readme-publish.py:79-81
if marker in current:
    print(f"already published (marker found): {marker!r}")
    print(f"  {target} unchanged, md5 {before_digest}")
    return 0                      # <-- returns BEFORE fleet_doc_state.record(target)
```

```python
# fleet-doc-publish.py
if new == current:
    print(f"already up to date: {target} (md5 {before})")
    return 0                      # <-- same
```

Add `fleet_doc_state.record(target)` before both returns. Then the documented invocation
(`./fleet-readme-publish.py README.md <section> "<marker>"` with a marker that is already present)
re-records the current digest and the guard goes green — no direct edit of the state file, no
hand-written digest, no risk of blessing a wrong document.

With §4.2 and §4.3 in place the recovery of this card is a single command:

```bash
cd /home/alejandro/Work/fleet
sudo -n ./fleet-readme-publish.py ~/Work/fleet/README.md /dev/null \
  "## 2026-11-25 — MiniMax Code app on the phone: installed, and adopted by Play after all"
python3 fleet-doc-guard.py    # -> [ok  ] both documents, rc=0
```

### 4.4 Make the bit handling and the guard's message honest

* `set_immutable()` must report failure instead of swallowing it, and the publisher must refuse to
  write a document whose protection it could not manage:

```python
def set_immutable(path, on) -> bool:
    r = subprocess.run(["chattr", ("+i" if on else "-i"), str(path)],
                       capture_output=True, text=True, check=False)
    if r.returncode != 0:
        print(f"warn: could not {'set' if on else 'clear'} the immutable bit on {path}: "
              f"{r.stderr.strip() or r.returncode} (chattr needs root: CAP_LINUX_IMMUTABLE)")
        return False
    return True
```

  With that in place the 20:01:18 attempt would have said *"the immutable bit is set and I cannot
  clear it — run me with sudo"* instead of failing with a bare `EPERM`, and the session would not
  have needed the manual `sudo chattr -i` / `sudo chattr +i` pair that leaves the document
  writable in the gap between the two commands.

* The guard's message must not assert a bypass it cannot prove. "content changed outside the
  guarded publishers … it was written directly, not through fleet-doc-publish.py" is only true if
  the last recorded digest is older than the last *successful publish*. The honest wording names
  what the guard actually knows:

```
/home/alejandro/Work/fleet/README.md: content does not match the digest the publishers recorded
(recorded 14b343032bf9876d841292b7989af20a at 18:38:32, now 2597e8ef284e047599a58abeabcb7a5e)
— either it was written directly, or a publish failed to record its digest
```

  The current wording sent this investigation looking for a rogue write; the audit trail shows
  the opposite.

### 4.5 Watch the bookkeeping, not just the documents (fleet-doctor)

The failure mode is "the publisher worked but the record did not". A check for that belongs in
`fleet-doctor.py`, next to the document check, so it is caught at the *next* doctor run instead of
30 minutes later by a card:

```python
# read-only: can the publishing user write the state file and its lock?
st = fleet_doc_state.state_path()
for p in (st, st.with_name(st.name + ".lock")):
    ok = os.access(p, os.W_OK)
    record("shared-docs", f"state file writable ({p.name})", "PASS" if ok else "FAIL",
           "publisher cannot record its digest" if not ok else "")
```

Run the doctor as the user that publishes (or stat the owner explicitly) so the check is
meaningful. The same check would have caught this at 18:38, before two hours of divergence.

## 5. Verification

```bash
# 1. the state file is writable by the publishing user
sudo -u alejandro test -w /home/alejandro/Work/fleet/.published-digests.json && echo WRITABLE
sudo -u alejandro test -w /home/alejandro/Work/fleet/.published-digests.json.lock && echo LOCK-OK

# 2. a publish run AS THE USER now records its digest
cd /home/alejandro/Work/fleet
./fleet-readme-publish.py README.md /dev/null "<a marker that is already present>"
grep -A4 'fleet/README.md' .published-digests.json     # published_at must be NOW, md5 = current

# 3. the guard is green, from the self-check's own path
python3 /home/alejandro/Work/fleet/fleet-doc-guard.py; echo "rc=$?"     # rc=0, both [ok  ]

# 4. the next self-check cycle passes
tail -20 /var/log/fleet-selftest.log | grep -E 'shared documents|FAIL|PASS'
#    -> "ok: shared documents are intact (2 document(s))" and "PASS: fleet is able to work"
```

Current state, measured on the hub at 20:19–20:21 on 2026-11-25 — the symptom is already gone:

```
$ python3 /home/alejandro/Work/fleet/fleet-doc-guard.py
doc-guard: 2 guarded document(s)
[ok  ] /home/alejandro/Work/fleet-analysis-2026-11-23.md
[ok  ] /home/alejandro/Work/fleet/README.md
        immutable=True recorded=56ab28f3741257dee48102a3154214cb current=56ab28f3741257dee48102a3154214cb
doc-guard: OK
```

## 6. Scope of this run

The defect is in the guarded publishers and their state file on the hub (`ale-pc`,
`/home/alejandro/Work/fleet/`), which are **outside this repository**; this run's rules forbid
touching anything outside the repository directory, so the fixes in §4 are given as exact commands
and drop-in patches for the owner to apply, and **no host state was modified**: every check above
was read-only over hermes → hub. The only change in this tree is the new
`FLEET-SELFTEST-REPORT.md` at the repository root — no tracked file modified, no CI/workflow,
secret or lockfile touched, nothing under `.git`, no commit, push or `gh`.

One caveat for whoever applies §4.1: `chown`ing the state file to `alejandro` means the *root*-run
publishers still work (root can write anything), so it is strictly a widening of who may record —
it does not weaken the guard. Keep the file `0644` and in the same directory; the guard reads it
by path.

## 7. Summary of the fix, in one paragraph

The fleet README was written by the correct publisher and the guard still tripped, because
`fleet_doc_state.record()` — the only thing that records the digest of a published document — could
not open the root-owned `0644` lock file next to the root-owned state file, and swallowed the
`PermissionError`. So the publishers that the documentation tells you to run as your own user
write the document and lose the bookkeeping, and the guard, comparing the file against a stale
digest from 18:38, reports a bypass that never happened. Fix it by making
`.published-digests.json` and its `.lock` writable by the publishing user (and running the
publishers with `sudo` until that is done), by making `record()` raise instead of swallowing, by
recording the digest on the publishers' idempotent path so an already-published document can be
re-recorded in one command, by making `set_immutable()` report that `chattr` needs root instead of
ignoring it, and by adding a fleet-doctor check that the state file is writable by the user that
publishes — the missing check that would have caught this at 18:38 instead of at 20:14.
