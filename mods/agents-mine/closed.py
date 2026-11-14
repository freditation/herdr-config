#!/usr/bin/env python3
"""Recent Claude Code sessions that are no longer running, newest first, as JSON.

Each: {id, title, cwd, at (ms)}. Live sessions come from <config>/sessions/<pid>.json
whose pid is still alive. Only the tail of each transcript is read.

Every Claude account on the machine is read: ~/.claude and any ~/.claude-<name>
(a CLAUDE_CONFIG_DIR used when accounts switch by folder). Each account gives up to
LIMIT sessions, so a busy account can't push another's out. Resuming needs no account:
`claude --resume` runs in the session's folder, which picks the account again.

`at` is when it was archived: the last time this script saw it running (kept in
~/.cache/herdr-agents-mine/seen-live.json: not in the mod folder, where writing it
would hot-reload the mod and loop), or its last message if it was never seen running. So an
agent idle for days still goes to the top when you close it.
"""
import glob, json, os, re, sys, time
from datetime import datetime

LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 6
CONFIGS = [os.path.expanduser("~/.claude")] + sorted(
    d for d in glob.glob(os.path.expanduser("~/.claude-*")) if os.path.isdir(f"{d}/projects")
)
TAIL = 256 * 1024


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


live = set()
for f in (f for c in CONFIGS for f in glob.glob(f"{c}/sessions/*.json")):
    try:
        s = json.load(open(f))
        if s.get("sessionId") and alive(int(s.get("pid", 0))):
            live.add(s["sessionId"])
    except Exception:
        pass

NOW = int(time.time() * 1000)
CACHE = os.path.expanduser("~/.cache/herdr-agents-mine")
os.makedirs(CACHE, exist_ok=True)
SEEN = os.path.join(CACHE, "seen-live.json")
try:
    seen = json.load(open(SEEN))
except Exception:
    seen = {}
for sid in live:
    seen[sid] = NOW
seen = {k: v for k, v in seen.items() if NOW - v < 14 * 86400000}
try:
    tmp = SEEN + ".tmp"
    json.dump(seen, open(tmp, "w"))
    os.replace(tmp, SEEN)
except Exception:
    pass


def recent(config):
    files = sorted(glob.glob(f"{config}/projects/*/*.jsonl"), key=os.path.getmtime, reverse=True)[: LIMIT * 4]
    # Sessions seen running recently were just archived, however old their last message.
    have = {os.path.basename(f)[:-6] for f in files}
    for sid in seen:
        if sid not in live and sid not in have:
            files += glob.glob(f"{config}/projects/*/{glob.escape(sid)}.jsonl")[:1]
    return sorted(filter(None, map(session, files)), key=lambda s: s["at"], reverse=True)[:LIMIT]


def session(f):
    sid = os.path.basename(f)[:-6]
    if sid in live:
        return None
    try:
        with open(f, "rb") as fh:
            fh.seek(max(0, os.path.getsize(f) - TAIL))
            text = fh.read().decode("utf-8", "ignore")
    except Exception:
        return None
    title = custom = cwd = at = None
    # Where it started: `claude --resume` finds a session from that folder only.
    try:
        with open(f, "rb") as fh:
            m = re.search(r'"cwd":"((?:[^"\\]|\\.)*)"', fh.read(64 * 1024).decode("utf-8", "ignore"))
            cwd = json.loads(f'"{m.group(1)}"') if m else None
    except Exception:
        pass
    for line in text.splitlines():
        if '"type":"custom-title"' in line:
            m = re.search(r'"customTitle":"((?:[^"\\]|\\.)*)"', line)
            custom = json.loads(f'"{m.group(1)}"') if m else custom
        elif '"type":"ai-title"' in line:
            m = re.search(r'"aiTitle":"((?:[^"\\]|\\.)*)"', line)
            title = json.loads(f'"{m.group(1)}"') if m else title
        m = re.search(r'"timestamp":"([^"]+)"', line)
        if m:
            at = m.group(1)
    name = custom or title
    if not name or not cwd:
        return None
    try:
        ms = int(datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        ms = int(os.path.getmtime(f) * 1000)
    ms = max(ms, seen.get(sid, 0))
    return {"id": sid, "title": name, "cwd": cwd, "at": ms}


# Accounts can share one projects folder (a link to another's): read each real folder once,
# and list a session once.
_real = {}
for c in CONFIGS:
    _real.setdefault(os.path.realpath(f"{c}/projects"), c)
out = list({x["id"]: x for c in _real.values() for x in recent(c)}.values())
out.sort(key=lambda s: s["at"], reverse=True)
print(json.dumps(out))
