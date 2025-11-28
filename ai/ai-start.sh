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

DEFAULT_AI_CMD="codex"
AI_CMD_FROM_ARG=""
FORWARD_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ai-cmd)
      if [[ $# -lt 2 ]]; then
        echo "Error: --ai-cmd requires a value" >&2
        exit 1
      fi
      AI_CMD_FROM_ARG="$2"
      shift 2
      ;;
    --ai-cmd=*)
      AI_CMD_FROM_ARG="${1#*=}"
      shift
      ;;
    *)
      FORWARD_ARGS+=("$1")
      shift
      ;;
  esac
done

TARGET_AI_CMD="${AI_CMD_FROM_ARG:-${AI_CMD:-$DEFAULT_AI_CMD}}"

if ! command -v "$TARGET_AI_CMD" >/dev/null 2>&1; then
  echo "Error: unable to locate '$TARGET_AI_CMD'. Provide a valid executable via --ai-cmd or AI_CMD." >&2
  exit 1
fi

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
