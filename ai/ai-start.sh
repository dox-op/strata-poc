#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/persistency.config.env"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

if [[ -n "${PROJECT_PATH:-}" ]]; then
  PROJECT_ROOT="$(cd "${PROJECT_PATH}" && pwd)"
else
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

PROMPT_FILE="$PROJECT_ROOT/persistency.upsert.prompt.mdc"

export PROJECT_PERSISTENCY_DIR="$SCRIPT_DIR"
export PROJECT_PERSISTENCY_FUNCTIONAL="$SCRIPT_DIR/functional"
export PROJECT_PERSISTENCY_TECHNICAL="$SCRIPT_DIR/technical"
export PROJECT_PERSISTENCY_AI_META="$SCRIPT_DIR/ai-meta"
export PROJECT_PERSISTENCY_ASSETS="$SCRIPT_DIR/ai-meta/assets"
export PROJECT_PERSISTENCY_ROOT="$PROJECT_ROOT"
export PROJECT_PERSISTENCY_PROMPT="$PROMPT_FILE"

DEFAULT_AI_CMD="/home/enricopezzini/.local/share/pnpm/codex"
TARGET_AI_CMD="${AI_CMD:-$DEFAULT_AI_CMD}"
FORWARD_ARGS=("$@")

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Warning: missing migration prompt at $PROMPT_FILE" >&2
  exec "$TARGET_AI_CMD" "${FORWARD_ARGS[@]}"
fi

PROMPT_CONTENT="$(cat "$PROMPT_FILE")"
printf -v PROMPT_PAYLOAD "%s\n" "$PROMPT_CONTENT"
if [[ -n "${TITLE:-}" ]]; then
  printf -v PROMPT_PAYLOAD "# Conversation Title: %s\n\n%s" "$TITLE" "$PROMPT_PAYLOAD"
fi

echo "Streaming migration prompt from $PROMPT_FILE" >&2
exec "$TARGET_AI_CMD" "${FORWARD_ARGS[@]}" "$PROMPT_PAYLOAD"
