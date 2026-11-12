#!/bin/bash
# Copy the live Herdr + Claude Code setup into this repo, made neutral for anyone to use,
# then refuse to finish if anything personal is left. Run from the repo: ./sync.sh
#
# Personal words to block live in .denylist (one extended regex per line; gitignored, so
# the list itself is never published). The sync fails if any copied file matches one.
set -euo pipefail
cd "$(dirname "$0")"
H="$HOME/.config/herdr-app"
C="$HOME/.claude"

copy() { mkdir -p "$(dirname "$2")"; cp "$1" "$2"; }

for m in agents-mine menu-mine tabs-mine my-prs; do
  rm -rf "mods/$m"; mkdir -p "mods/$m"
  for f in "$H/mods/$m"/*; do
    case "$(basename "$f")" in gpui-kit.d.ts|routines.json|routines.json.tmp) continue ;; esac
    cp "$f" "mods/$m/"
  done
done
# The layout Herdr is showing now, published as "mine".
layout=$(herdr-app status | python3 -c 'import json,sys; print(json.load(sys.stdin)["layout"])')
copy "$H/layouts/$layout.json" layouts/mine.json
copy "$H/keys.json" keys.json
for f in herdr-asking.py herdr-space-name.py herdr-doing.py; do copy "$H/hooks/$f" "hooks/$f"; done
# The hooks are wired machine-wide, so they run whichever Claude account (CLAUDE_CONFIG_DIR) is in use.
copy "/Library/Application Support/ClaudeCode/managed-settings.json" claude/managed-settings.json
copy "$C/statusline.sh" claude/statusline.sh

# Neutral defaults: the default space is your home folder; no cloud machine (hides the cloud
# space); a generic launchd label.
sed -i '' -E 's/^const DEFAULT_DIR = ".*";/const DEFAULT_DIR = "";/' mods/agents-mine/main.js
sed -i '' -E 's/^const CLOUD_MACHINE = ".*";/const CLOUD_MACHINE = "";/' mods/agents-mine/main.js
sed -i '' -E 's/^const CLOUD_AGENT_FOLDER = ".*";/const CLOUD_AGENT_FOLDER = "";/' mods/agents-mine/main.js
sed -i '' -E 's/com\.[A-Za-z0-9_-]+\.herdr-routines/dev.herdr-config.routines/g' mods/agents-mine/refresh-routines.py

if [ -f .denylist ]; then
  if grep -rniE -f .denylist --exclude=.denylist --exclude-dir=.git . ; then
    echo "sync: personal details found above; fix them before committing." >&2
    exit 1
  fi
else
  echo "sync: no .denylist, so nothing was checked for personal details." >&2
  exit 1
fi
echo "sync: done, nothing personal found."
