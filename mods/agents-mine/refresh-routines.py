#!/usr/bin/env python3
"""Rewrite routines.json (the agents-mine calendar's data) with your Claude cloud routines.

Runs a short headless Claude (Haiku) that lists them with its RemoteTrigger tool, so no
script here ever touches your login. Run by launchd every 20 minutes
(~/Library/LaunchAgents/dev.herdr-config.routines.plist). Keeps the old file on failure.
"""
import json, os, re, subprocess, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "routines.json")
PROMPT = """Call the RemoteTrigger tool with action "list". Then reply with ONLY a JSON array, no prose and no code fence, one object per routine:
{"id": ..., "name": ..., "cron": <cron_expression>, "enabled": <bool>, "next_run_at": ..., "description": <the first sentence of its prompt (derived_state.prompt), at most 140 characters>, "last_run": {"status": <last_run.status lowercased without the ROUTINE_RUN_STATUS_ prefix>, "fired_at": <last_run.fired_at>} or null}"""


def main():
    r = subprocess.run(
        [os.path.expanduser("~/.local/bin/claude"), "-p", PROMPT, "--model", "haiku", "--output-format", "json",
         "--no-session-persistence", "--allowedTools", "RemoteTrigger"],
        capture_output=True, text=True, timeout=300, cwd=HERE)
    if r.returncode != 0:
        sys.exit(f"claude failed: {r.stderr[-500:]}")
    text = json.loads(r.stdout).get("result", "")
    m = re.search(r"\[.*\]", text, re.S)
    routines = json.loads(m.group(0)) if m else None
    if not isinstance(routines, list):
        sys.exit(f"no routines in reply: {text[:300]}")
    data = {"updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "routines": routines}
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, OUT)


if __name__ == "__main__":
    main()
