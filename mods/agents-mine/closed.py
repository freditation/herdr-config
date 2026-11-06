#!/usr/bin/env python3
"""Recent Claude Code sessions that are no longer running, newest first, as JSON.

Each: {id, title, cwd, at (ms)}. Live sessions come from ~/.claude/sessions/<pid>.json
whose pid is still alive. Only the tail of each transcript is read.

`at` is when it was archived: the last time this script saw it running (kept in
~/.cache/herdr-agents-mine/seen-live.json: not in the mod folder, where writing it
would hot-reload the mod and loop), or its last message if it was never seen running. So an
agent idle for days still goes to the top when you close it.
"""
import glob, json, os, re, sys, time
from datetime import datetime

LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 6
HOME = os.path.expanduser("~/.claude")
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
for f in glob.glob(f"{HOME}/sessions/*.json"):
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

files = sorted(glob.glob(f"{HOME}/projects/*/*.jsonl"), key=os.path.getmtime, reverse=True)[: LIMIT * 4]
# Sessions seen running recently were just archived, however old their last message.
have = {os.path.basename(f)[:-6] for f in files}
for sid in seen:
    if sid not in live and sid not in have:
        files += glob.glob(f"{HOME}/projects/*/{glob.escape(sid)}.jsonl")[:1]
out = []
for f in files:
    sid = os.path.basename(f)[:-6]
    if sid in live:
        continue
    try:
        with open(f, "rb") as fh:
            fh.seek(max(0, os.path.getsize(f) - TAIL))
            text = fh.read().decode("utf-8", "ignore")
    except Exception:
        continue
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
        continue
    try:
        ms = int(datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        ms = int(os.path.getmtime(f) * 1000)
    ms = max(ms, seen.get(sid, 0))
    out.append({"id": sid, "title": name, "cwd": cwd, "at": ms})

out.sort(key=lambda s: s["at"], reverse=True)
print(json.dumps(out[:LIMIT]))
