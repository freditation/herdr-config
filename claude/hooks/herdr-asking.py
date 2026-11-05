#!/usr/bin/env python3
"""Claude Code hook: flag a Herdr terminal whose agent ended its turn on a question.

Stop: if the last paragraph of the final reply asks something, set the
`herdr.asking` label on this terminal; otherwise clear it.
UserPromptSubmit / SessionStart: clear it (you answered, or started over).

The agents-mine sidebar mod shows labelled agents under "Needs you"
until the label is cleared, however many times you look at them.

UserPromptSubmit / SessionStart also set `herdr.task`: the session's task in a
sentence (the first sentence of its first prompt), shown when you hover its row.
"""
import json
import os
import re
import subprocess
import sys

HC = os.path.expanduser("~/.local/bin/hc")
LABEL = "herdr.asking"


def last_reply(event):
    text = event.get("last_assistant_message")
    if isinstance(text, str) and text.strip():
        return text
    path = event.get("transcript_path")
    if not path or not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        f.seek(max(0, f.tell() - 400_000))
        lines = f.read().decode("utf-8", "replace").splitlines()
    for line in reversed(lines):
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("type") != "assistant":
            continue
        content = (rec.get("message") or {}).get("content") or []
        texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        if any(t.strip() for t in texts):
            return "\n".join(texts)
    return ""


def asks(text):
    # Drop code, then look at the last paragraph only: a question buried
    # earlier in a long reply is usually rhetorical.
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"`[^`]*`", "", text)
    text = re.sub(r"https?://\S+", "", text)
    paras = [p for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    if not paras:
        return False
    return re.search(r"\?(?=[\s*_)\"']|$)", paras[-1]) is not None


def sentence(text):
    """The first sentence of a prompt, without pasted blocks, tags or image markers."""
    text = re.sub(r"<(\w[\w-]*)[^>]*>.*?</\1>", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>|\[Image #\d+\]|\[Pasted text[^\]]*\]", " ", text)
    text = " ".join(text.split())
    m = re.search(r"^(.+?[.?!])(\s|$)", text)
    text = m.group(1) if m else text
    return text if len(text) <= 160 else text[:157].rstrip() + "…"


def first_prompt(event):
    """The session's first real prompt: from its transcript, else this one."""
    path = event.get("transcript_path")
    if path and os.path.exists(path):
        with open(path, "rb") as f:
            for raw in f.read(2_000_000).decode("utf-8", "replace").splitlines():
                try:
                    rec = json.loads(raw)
                except ValueError:
                    continue
                if rec.get("type") != "user" or rec.get("isMeta") or rec.get("isCompactSummary"):
                    continue
                content = (rec.get("message") or {}).get("content")
                if isinstance(content, list):
                    content = " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
                if isinstance(content, str) and sentence(content) and not content.lstrip().startswith(("<command", "<local-command", "Caveat:")):
                    return content
    return event.get("prompt") or ""


def main():
    terminal = os.environ.get("HC_TERMINAL_ID")
    if not terminal:
        return  # not inside Herdr
    event = json.load(sys.stdin)
    kind = event.get("hook_event_name")
    asking = kind == "Stop" and asks(last_reply(event))
    labels = [f"{LABEL}={'1' if asking else ''}"]
    if kind in ("UserPromptSubmit", "SessionStart"):
        labels.append(f"herdr.task={sentence(first_prompt(event))}")
    subprocess.run([HC, "label", terminal, *labels], capture_output=True, timeout=10)


if __name__ == "__main__":
    main()
