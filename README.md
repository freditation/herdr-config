# herdr-config

My setup for [Herdr](https://github.com/herdrdev/herdr-app) with Claude Code: an agents sidebar that sorts sessions by what they need from you, plus the Claude Code hooks and status line that feed it.

## What you get

- **Spaces** at the top of the sidebar: folders your agents run in, each with its own colour of Claude icon, in the sidebar and on the agent's tab. Click a space to show only its agents (and its Archived) and to make `+` start new ones there. Add a folder with the folder button, and right-click one to remove it. Click the Spaces header to fold the list to one line showing the selected space; a dot there means an agent in another space needs you. Handy if you switch Claude accounts by directory.
- **Agents sidebar** (`mods/agents-mine`) with four sections:
  - **Running.**
  - **Needs you:** the agent is blocked on a prompt, or ended its turn on a question. A question still counts while its background subagents run.
  - **Idle:** finished.
  - **Archived:** recent closed sessions, the one you just closed on top. Click one to resume it. Each space shows its own six, including the cloud machine's.
- **Bold means unread**, in Needs you and Idle, until you've looked at the agent and moved on.
- **A hover card** on each agent saying what it's working on now, in a sentence a headless Haiku writes after each prompt and turn, plus the step it's on while it runs.
- **A cloud space** for a remote Herdr machine: select it and `+` starts Claude there. Hidden until you set `CLOUD_MACHINE` (a name from `hc machine ls`) and `CLOUD_AGENT_FOLDER` at the top of `mods/agents-mine/main.js`. Agents on remote machines get a cloud icon, in the sidebar and on their tab.
- **Hover the status dot for an ✕.** On a running agent it stops it; on any other it archives it.
- **Right-click an agent** for a menu: rename it (empty goes back to its own title), copy it (forks its Claude session into a new space) or archive it.
- **A calendar** (the calendar icon) of your Claude cloud routines this week.
- **My PRs** (`mods/my-prs`): your open and recently merged GitHub pull requests at the bottom of the sidebar. Needs `gh`.
- **Menu and tabs tweaks** (`mods/menu-mine`, `mods/tabs-mine`), my layout (`layouts/mine.json`) and keys (`keys.json`).
- **Spaces named after their session**: the `herdr-space-name.py` hook renames a space to its Claude session's title, unless you've named the space yourself.
- **Claude Code side**: the `herdr-asking.py`, `herdr-doing.py` and `herdr-space-name.py` hooks (`hooks/`), wired machine-wide so every Claude account gets them, and my `statusline.sh` (`claude/`), which shows folder, model, effort and context.

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

The default space is your home folder. To use another, set `DEFAULT_DIR` at the top of `mods/agents-mine/main.js`, for example `"code"` for `~/code`.

### Claude Code hooks and status line

The hooks live beside the mods, and Claude Code's managed settings wire them up for every Claude session on the machine, whichever account or `CLAUDE_CONFIG_DIR` it uses. Writing managed settings needs an admin password.

```sh
mkdir -p ~/.config/herdr-app/hooks
cp hooks/herdr-*.py ~/.config/herdr-app/hooks/ && chmod +x ~/.config/herdr-app/hooks/herdr-*.py
sudo mkdir -p "/Library/Application Support/ClaudeCode"
sudo cp claude/managed-settings.json "/Library/Application Support/ClaudeCode/managed-settings.json"
cp claude/statusline.sh ~/.claude/ && chmod +x ~/.claude/statusline.sh
```

If you already have a `managed-settings.json`, merge the `hooks` in by hand instead of copying over it. On Linux the file is `/etc/claude-code/managed-settings.json`. Don't also list these hooks in your own `settings.json`, or they run twice. For the status line, merge `claude/settings.example.json` into `~/.claude/settings.json`.

The hooks only do anything inside Herdr. `herdr-asking.py` sets `herdr.asking` on the terminal when a turn ends on a question. `herdr-doing.py` sets `herdr.task` (what the session is doing, summarised by `claude -p --model haiku` in the background, a fraction of a cent each time) and `herdr.now` (the current step). `herdr-space-name.py` puts the session's terminal title in `herdr.title` when a turn ends; the sidebar mod renames the space to its first terminal's title unless you've named the space yourself. The status line needs `jq`.

### Calendar of Claude cloud routines (optional)

The calendar reads `mods/agents-mine/routines.json`. `refresh-routines.py` writes it by asking a short headless Claude (Haiku) to list your routines with its built-in RemoteTrigger tool. That keeps your login out of any script, and costs a few cents a day.

```sh
sed "s|__HOME__|$HOME|g" launchd/herdr-routines.plist > ~/Library/LaunchAgents/dev.herdr-config.routines.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.herdr-config.routines.plist
```

This runs it every 20 minutes. Without it the calendar says "Not loaded yet".

## Licence

Apache-2.0. The `-mine` mods are modified copies of Herdr's own mods; see `NOTICE`.
