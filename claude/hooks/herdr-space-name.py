#!/usr/bin/env python3
"""Claude Code Stop hook: name the Herdr space after this session's terminal title.

Only touches a space whose name is still Herdr's automatic one (its folder/repo
name), or one this hook named before. A name you set by hand is left alone.
Only the space's first terminal names it, so a second agent in the same space
doesn't fight over it.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HC = os.path.expanduser("~/.local/bin/hc")
HERDR = os.path.expanduser("~/.local/bin/herdr-app")
STATE = Path(os.path.expanduser("~/.local/state/herdr-space-name"))
GENERIC = {"", "claude", "claude code"}


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=10)


def main():
    terminal = os.environ.get("HC_TERMINAL_ID")
    if not terminal:
        return  # not running inside Herdr

    me = json.loads(run(HC, "get", terminal, "--json").stdout)
    space_id = (me.get("labels") or {}).get("herdr.space")
    # Drop the status glyphs/spinners Claude Code prefixes to its title.
    title = re.sub(r"^[^\w(\[]+", "", me.get("title") or "").strip()
    if not space_id or title.lower() in GENERIC:
        return
    title = title[:60]

    spaces = json.loads(run(HERDR, "ls").stdout)["spaces"]
    space = next((s for s in spaces if s["id"] == space_id), None)
    if not space:
        return
    first = next((t["terminal"] for tab in space["tabs"] for t in tab["terminals"]), None)
    if first != terminal:
        return

    current = space["name"]
    state_file = STATE / space_id
    ours = state_file.read_text() if state_file.exists() else None

    if ours is not None:
        if current != ours:
            return  # renamed by hand since we last named it
    else:
        cwd = (me.get("foreground") or {}).get("cwd") or me.get("cwd") or ""
        auto = {"~", os.path.basename(space.get("folder") or ""), os.path.basename(cwd)}
        top = run("git", "-C", cwd, "rev-parse", "--show-toplevel").stdout.strip() if cwd else ""
        if top:
            auto.add(os.path.basename(top))
        if current not in auto:
            return  # a name someone chose

    if current != title:
        r = run(HERDR, "do", "space.rename", json.dumps({"id": space_id, "name": title}))
        if r.returncode != 0:
            print(r.stdout + r.stderr, file=sys.stderr)
            return
    STATE.mkdir(parents=True, exist_ok=True)
    state_file.write_text(title)


if __name__ == "__main__":
    main()
