"""Keeps this Herdr config current from github.com/freditation/herdr-config.

The agents sidebar (agents-mine) runs it when Herdr starts and then every hour. It
updates the mods you installed from the repo (agents-mine, tabs-mine, menu-mine,
my-prs) and the Claude hooks in ~/.config/herdr-app/hooks, and Herdr reloads a
changed mod by itself. Your settings live in ~/.config/herdr-app/herdr-config.json,
which it never overwrites; set "autoUpdate": false there to stop updates.

A mod (or the hooks) you changed yourself since the last update is left alone, and
reported, until the repo's copy matches yours. herdr-config.installed.json beside
the settings records what was last installed. Prints one line: what it did.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile

REPO = "freditation/herdr-config"
APP = os.environ.get("HERDR_APP_HOME") or os.path.expanduser("~/.config/herdr-app")
SETTINGS = os.path.join(APP, "herdr-config.json")
STATE = os.path.join(APP, "herdr-config.installed.json")
MODS = ["agents-mine", "tabs-mine", "menu-mine", "my-prs"]
# Files Herdr or a mod writes beside the mod's code, never shipped.
SKIP = {"jsconfig.json", "gpui-kit.d.ts", "routines.json", "routines.json.tmp", ".DS_Store"}


def curl(url, accept=None):
    args = ["curl", "-fsSL", "--max-time", "60", url]
    if accept:
        args[1:1] = ["-H", f"Accept: {accept}"]
    return subprocess.run(args, check=True, capture_output=True).stdout


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None


def write(path, data, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.herdr-config-tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def migrate_settings():
    """First run: carry the settings people edited into agents-mine/main.js over."""
    found = {}
    src = (read(os.path.join(APP, "mods/agents-mine/main.js")) or b"").decode()
    for key, name in (("defaultDir", "DEFAULT_DIR"), ("cloudMachine", "CLOUD_MACHINE"), ("cloudAgentFolder", "CLOUD_AGENT_FOLDER")):
        m = re.search(rf"^const {name} = (.+?);\s*$", src, re.M)
        if m:
            try:
                found[key] = json.loads(m.group(1))
            except ValueError:
                pass
    settings = {"defaultDir": "", "cloudMachine": "", "cloudAgentFolder": "", "autoUpdate": True, **found}
    write(SETTINGS, (json.dumps(settings, indent=2) + "\n").encode())
    return settings


def main():
    raw = read(SETTINGS)
    settings = json.loads(raw) if raw else migrate_settings()
    if settings.get("autoUpdate") is False:
        print("auto-update is off")
        return

    state = json.loads(read(STATE) or b"{}")
    sha = curl(f"https://api.github.com/repos/{REPO}/commits/main", "application/vnd.github.sha").decode().strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        sys.exit(f"unexpected commit id: {sha[:80]!r}")
    if sha == state.get("sha") and not state.get("skipped"):
        print("up to date")
        return

    # The repo at that commit, read straight from the tarball (nothing extracted).
    upstream = {}
    with tarfile.open(fileobj=io.BytesIO(curl(f"https://codeload.github.com/{REPO}/tar.gz/{sha}")), mode="r:gz") as tar:
        for member in tar.getmembers():
            if member.isfile():
                path = member.name.split("/", 1)[1]
                upstream[path] = tar.extractfile(member).read()

    # Each group: where it lives here, and its files in the repo (relative names).
    groups = {}
    for mod in MODS:
        if os.path.isdir(os.path.join(APP, "mods", mod)):
            prefix = f"mods/{mod}/"
            groups[mod] = (os.path.join(APP, "mods", mod), {p[len(prefix):]: d for p, d in upstream.items()
                           if p.startswith(prefix) and "/" not in p[len(prefix):] and p[len(prefix):] not in SKIP})
    hooks = os.path.join(APP, "hooks")
    if any(read(os.path.join(hooks, n)) is not None for n in ("herdr-asking.py", "herdr-doing.py", "herdr-space-name.py")):
        groups["hooks"] = (hooks, {p[len("hooks/"):]: d for p, d in upstream.items() if re.fullmatch(r"hooks/herdr-[\w-]+\.py", p)})

    installed = state.get("files", {})
    updated, skipped = [], []
    for name, (where, files) in groups.items():
        before = installed.get(name)  # {file: hash} last installed, or None on the first run
        mine = {f: read(os.path.join(where, f)) for f in set(files) | set(before or {})}
        # Changed here since the last update, and not already what the repo has.
        changed = before is not None and any(
            data is not None and sha256(data) != before.get(f) and (f not in files or sha256(data) != sha256(files[f]))
            for f, data in mine.items())
        if changed:
            skipped.append(name)
            continue
        if any(mine.get(f) != data for f, data in files.items()) or any(f not in files and mine[f] is not None for f in before or {}):
            for f, data in files.items():
                if mine.get(f) != data:
                    write(os.path.join(where, f), data, 0o755 if name == "hooks" or f.endswith((".py", ".sh")) else 0o644)
            for f in before or {}:
                if f not in files and mine[f] is not None:
                    os.remove(os.path.join(where, f))
            updated.append(name)
        installed[name] = {f: sha256(d) for f, d in files.items()}

    write(STATE, (json.dumps({"sha": sha, "files": installed, "skipped": skipped}, indent=2) + "\n").encode())
    parts = []
    if updated:
        parts.append(f"updated {', '.join(updated)} to {sha[:7]}")
    if skipped:
        parts.append(f"left {', '.join(skipped)} alone (changed here)")
    print("; ".join(parts) or "up to date")


if __name__ == "__main__":
    main()
