#!/usr/bin/env python3
"""Claude Code Stop hook: offer this session's terminal title as its Herdr space's name.

Puts the title in the `herdr.title` label on this terminal, using only hc, so it
works on any machine Herdr reaches (this Mac or a remote one). The agents-mine sidebar
mod does the renaming: a space takes its first terminal's `herdr.title` unless
someone named it by hand.
"""
import json
import os
import re
import subprocess

HC = os.path.expanduser("~/.local/bin/hc")
GENERIC = {"", "claude", "claude code"}


def main():
    terminal = os.environ.get("HC_TERMINAL_ID")
    if not terminal:
        return  # not running inside Herdr
    me = json.loads(subprocess.run([HC, "get", terminal, "--json"], capture_output=True, text=True, timeout=10).stdout)
    # Drop the status glyphs/spinners Claude Code prefixes to its title.
    title = re.sub(r"^[^\w(\[]+", "", me.get("title") or "").strip()
    if title.lower() in GENERIC:
        return
    subprocess.run([HC, "label", terminal, f"herdr.title={title[:60]}"], capture_output=True, timeout=10)


if __name__ == "__main__":
    main()
