#!/bin/bash
input=$(cat)

model=$(jq -r '.model.display_name // .model.id // "?"' <<<"$input")
model_id=$(jq -r '.model.id // ""' <<<"$input")
dir=$(jq -r '.workspace.current_dir // .cwd // ""' <<<"$input")
dir=${dir/#$HOME/\~}

# Context usage: prefer the harness-provided percentage, else derive from the transcript.
pct=$(jq -r '.context_window.used_percentage // empty' <<<"$input")
if [ -z "$pct" ]; then
  transcript=$(jq -r '.transcript_path // empty' <<<"$input")
  size=$(jq -r '.context_window.context_window_size // 200000' <<<"$input")
  if [ -f "$transcript" ]; then
    used=$(tail -n 200 "$transcript" | jq -s '[.[] | .message.usage? | select(.) | (.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)] | last // 0')
    pct=$(( used * 100 / size ))
  fi
fi
pct=${pct%.*}

# Effort: prefer the harness-provided value, else fall back to settings.
effort=$(jq -r '.effort.level // .effort // empty' <<<"$input" 2>/dev/null)
if [ -z "$effort" ] || [ "$effort" = "null" ]; then
  effort=$(jq -r --arg m "$model_id" '.modelSettings[$m].effortLevel // .effortLevel // empty' ~/.claude/settings.json 2>/dev/null)
fi

printf '\033[36m%s\033[0m · \033[35m%s\033[0m · effort: %s · ctx: %s%%' "$dir" "$model" "${effort:-default}" "${pct:-0}"
