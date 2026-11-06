# herdr-config

My setup for [Herdr](https://github.com/herdrdev/herdr-app) with Claude Code: an agents sidebar that sorts sessions by what they need from you, plus the Claude Code hooks and status line that feed it.

## What you get

- **Agents sidebar** (`mods/agents-mine`) with four sections:
  - **Needs you:** the agent is blocked on a prompt, or ended its turn on a question. A question still counts while its background subagents run.
  - **Running.**
  - **Idle:** finished.
  - **Archived:** recent closed sessions. Click one to resume it.
- **Bold means unread**, in Needs you and Idle, until you've looked at the agent and moved on.
- **A hover card** on each agent with its task in a sentence: the first sentence of the session's first prompt.
- **Hover the status dot for an ✕.** On a running agent it stops it; on any other it archives it.
- **A calendar** (the calendar icon) of your Claude cloud routines this week.
- **My PRs** (`mods/my-prs`): your open and recently merged GitHub pull requests at the bottom of the sidebar. Needs `gh`.
- **Menu and tabs tweaks** (`mods/menu-mine`, `mods/tabs-mine`), my layout (`layouts/mine.json`) and keys (`keys.json`).
- **Spaces named after their session**: the `herdr-space-name.py` hook renames a space to its Claude session's title, unless you've named the space yourself.
- **Claude Code side** (`claude/`): the `herdr-asking.py` and `herdr-space-name.py` hooks and my `statusline.sh`, which shows folder, model, effort and context.

## Install

Mods are trusted code: they run with your permissions, so read them first. Back up `~/.config/herdr-app` before copying anything over it.

```sh
git clone https://github.com/freditation/herdr-config.git && cd herdr-config
cp -R ~/.config/herdr-app ~/.config/herdr-app.backup

cp -R mods/* ~/.config/herdr-app/mods/
cp layouts/mine.json ~/.config/herdr-app/layouts/
cp keys.json ~/.config/herdr-app/keys.json        # optional: my key bindings
```

Then switch Herdr to the `mine` layout (⌘⇧L).

The `+` button starts Claude in your home folder. To start it somewhere else, set `NEW_AGENT_FOLDER` at the top of `mods/agents-mine/main.js`, for example `"code"` for `~/code`.

### Claude Code hook and status line

```sh
mkdir -p ~/.claude/hooks
cp claude/hooks/herdr-*.py ~/.claude/hooks/ && chmod +x ~/.claude/hooks/herdr-*.py
cp claude/statusline.sh ~/.claude/ && chmod +x ~/.claude/statusline.sh
```

Merge `claude/settings.example.json` into `~/.claude/settings.json` by hand, keeping any hooks you already have. The hooks only do anything inside Herdr. `herdr-asking.py` sets two labels on the terminal: `herdr.asking` when a turn ends on a question, and `herdr.task` with the session's task. `herdr-space-name.py` runs when a turn ends and names the space after the session's terminal title, but only while the space still has Herdr's automatic name (or one it set itself), and only from the space's first terminal. The status line needs `jq`.

### Calendar of Claude cloud routines (optional)

The calendar reads `mods/agents-mine/routines.json`. `refresh-routines.py` writes it by asking a short headless Claude (Haiku) to list your routines with its built-in RemoteTrigger tool. That keeps your login out of any script, and costs a few cents a day.

```sh
sed "s|__HOME__|$HOME|g" launchd/herdr-routines.plist > ~/Library/LaunchAgents/dev.herdr-config.routines.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.herdr-config.routines.plist
```

This runs it every 20 minutes. Without it the calendar says "Not loaded yet".

## Licence

Apache-2.0. The `-mine` mods are modified copies of Herdr's own mods; see `NOTICE`.
