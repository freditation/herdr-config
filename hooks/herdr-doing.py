#!/usr/bin/env python3
"""Claude Code hook: keep a Herdr terminal's `herdr.task` and `herdr.now` labels current.

The agents-mine sidebar mod shows both in the card you get by hovering an agent's row.

herdr.task: what the session is working on now, in a sentence. A headless Haiku
  rewrites it from the transcript after each prompt and each finished turn, in the
  background; until the first one lands it's the first sentence of the first prompt.
herdr.now: the step it's on (the Bash description, the file it's editing...), from
  PreToolUse; cleared when the turn ends.

SessionStart (startup/clear) resets both; resume summarises the resumed session.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

HC = os.path.expanduser("~/.local/bin/hc")
STATE = os.path.expanduser("~/.cache/herdr-doing")
PROMPT = """Below is a digest of a coding agent's session: the person's requests and the agent's replies, newest last.

Write ONE status line, at most 14 words, saying what the agent is working on now. Start with an -ing verb ("Fixing…", "Reviewing…"). If its last reply finished the work or asks the person something, say that instead ("Finished …; waiting for review", "Asking whether to …"). Be specific: name the feature, file, PR or system. Output only the line, no quotes.

<digest>
{digest}
</digest>"""


def label(terminal, **kv):
    subprocess.run([HC, "label", terminal, *(f"{k.replace('_', '.')}={v}" for k, v in kv.items())],
                   capture_output=True, timeout=10)


def short(text, n):
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def base(path):
    return os.path.basename(str(path or "").rstrip("/")) or str(path or "")


def step(tool, inp):
    """The step a tool call is, in a few words."""
    inp = inp if isinstance(inp, dict) else {}
    if tool == "Bash":
        return inp.get("description") or f"Running {short(inp.get('command', ''), 50)}"
    if tool in ("Edit", "MultiEdit", "Write", "NotebookEdit"):
        return f"Editing {base(inp.get('file_path') or inp.get('notebook_path'))}"
    if tool == "Read":
        return f"Reading {base(inp.get('file_path'))}"
    if tool in ("Grep", "Glob"):
        return f"Searching for {short(inp.get('pattern', ''), 40)}"
    if tool in ("Agent", "Task"):
        return f"Agent: {inp.get('description') or 'working'}"
    if tool == "WebSearch":
        return f"Searching the web for {short(inp.get('query', ''), 40)}"
    if tool == "WebFetch":
        host = re.sub(r"^https?://([^/]+).*", r"\1", inp.get("url", ""))
        return f"Reading {host}"
    if tool.startswith("mcp__"):
        parts = tool.split("__")
        server = re.sub(r"^claude_ai_", "", parts[1]).replace("_", " ")
        return f"{server}: {parts[-1].replace('_', ' ').replace('-', ' ')}"
    return tool


def sentence(text):
    """The first sentence of a prompt, without pasted blocks, tags or image markers."""
    text = re.sub(r"<(\w[\w-]*)[^>]*>.*?</\1>", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>|\[Image #\d+\]|\[Pasted text[^\]]*\]", " ", text)
    text = " ".join(text.split())
    m = re.search(r"^(.+?[.?!])(\s|$)", text)
    return short(m.group(1) if m else text, 160)


def real_prompt(rec):
    if rec.get("type") != "user" or rec.get("isMeta") or rec.get("isCompactSummary"):
        return None
    content = (rec.get("message") or {}).get("content")
    if isinstance(content, list):
        if any(isinstance(c, dict) and c.get("type") == "tool_result" for c in content):
            return None
        content = " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    if not isinstance(content, str) or content.lstrip().startswith(("<command", "<local-command", "Caveat:", "<task-notification")):
        return None
    content = re.sub(r"<system-reminder>.*?</system-reminder>", " ", content, flags=re.S).strip()
    return content or None


def records(path, limit, head=False):
    """The transcript's records in its first or last `limit` bytes."""
    with open(path, "rb") as f:
        if not head:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - limit))
        lines = f.read(limit).decode("utf-8", "replace").splitlines()
    for raw in lines:
        try:
            yield json.loads(raw)
        except ValueError:
            pass


def digest(path, pending):
    """First request, then the latest exchanges, about 6,000 characters in all."""
    first = None
    for rec in records(path, 2_000_000, head=True):
        first = real_prompt(rec)
        if first:
            break
    msgs = []
    for rec in records(path, 600_000):
        p = real_prompt(rec)
        if p:
            msgs.append(f"PERSON: {short(p, 600)}")
        elif rec.get("type") == "assistant":
            for c in (rec.get("message") or {}).get("content") or []:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "text" and c.get("text", "").strip():
                    msgs.append(f"AGENT: {short(c['text'], 500)}")
                elif c.get("type") == "tool_use":
                    msgs.append(f"(step: {step(c.get('name', ''), c.get('input'))})")
    if pending and (not msgs or msgs[-1] != f"PERSON: {short(pending, 600)}"):
        msgs.append(f"PERSON: {short(pending, 600)}")
    # Collapse runs of steps to the last few: they say where it is, not what it's for.
    out, run = [], []
    for m in msgs:
        if m.startswith("(step"):
            run.append(m)
            continue
        out += run[-3:]
        run = []
        out.append(m)
    out += run[-3:]
    tail, size = [], 0
    for m in reversed(out):
        if size + len(m) > 5000:
            break
        tail.append(m)
        size += len(m)
    head = f"FIRST REQUEST: {short(first, 600)}\n...\n" if first and f"PERSON: {short(first, 600)}" not in tail else ""
    return head + "\n".join(reversed(tail))


def summarise(terminal, path, pending, token):
    claude = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "HC_TERMINAL_ID")}
    r = subprocess.run(
        [claude, "-p", "--model", "haiku", "--no-session-persistence", "--strict-mcp-config", "--tools", "",
         "--disable-slash-commands", "--settings", '{"disableAllHooks":true}',
         "--system-prompt", "You write terse, specific status lines for a sidebar of coding agents."],
        input=PROMPT.format(digest=digest(path, pending)), capture_output=True, text=True, timeout=120,
        env=env, cwd=STATE)
    line = short(r.stdout.strip().splitlines()[-1].strip().strip('"'), 160) if r.returncode == 0 and r.stdout.strip() else ""
    # A newer prompt or turn end started its own summary: let that one write.
    if line and read_token(terminal) == token:
        label(terminal, herdr_task=line)


def token_file(terminal):
    return os.path.join(STATE, f"{terminal}.token")


def read_token(terminal):
    try:
        return open(token_file(terminal)).read()
    except OSError:
        return None


def start_summary(terminal, event):
    path = event.get("transcript_path")
    if not path or not os.path.exists(path):
        return
    token = f"{time.time()}"
    with open(token_file(terminal), "w") as f:
        f.write(token)
    pending = real_prompt({"type": "user", "message": {"content": event.get("prompt") or ""}}) or ""
    # Detached, so the hook's timeout doesn't cut Haiku off.
    child = subprocess.Popen([sys.executable, __file__, "--summarise", terminal, path, token],
                             stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
    child.stdin.write(pending.encode())
    child.stdin.close()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--summarise":
        _, _, terminal, path, token = sys.argv
        summarise(terminal, path, sys.stdin.read(), token)
        return
    terminal = os.environ.get("HC_TERMINAL_ID")
    if not terminal:
        return  # not inside Herdr
    os.makedirs(STATE, exist_ok=True)
    event = json.load(sys.stdin)
    kind = event.get("hook_event_name")
    if kind == "PreToolUse":
        label(terminal, herdr_now=short(step(event.get("tool_name", ""), event.get("tool_input")), 80))
    elif kind == "SessionStart":
        if event.get("source") == "resume":
            label(terminal, herdr_now="")
            start_summary(terminal, event)
        else:
            open(token_file(terminal), "w").close()
            label(terminal, herdr_task="", herdr_now="")
    elif kind == "UserPromptSubmit":
        # The first prompt stands in until Haiku has read it.
        first = not any(real_prompt(r) for r in records(event["transcript_path"], 2_000_000, head=True)) \
            if event.get("transcript_path") and os.path.exists(event["transcript_path"]) else True
        if first:
            label(terminal, herdr_task=sentence(event.get("prompt") or ""), herdr_now="")
        start_summary(terminal, event)
    elif kind == "Stop":
        label(terminal, herdr_now="")
        start_summary(terminal, event)


if __name__ == "__main__":
    main()
