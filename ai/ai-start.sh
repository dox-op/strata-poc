#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_FILE="$SCRIPT_DIR/ai-bootstrap.mdc"

if [[ ! -f "$BOOTSTRAP_FILE" ]]; then
  echo "Error: Bootstrap prompt not found at $BOOTSTRAP_FILE" >&2
  exit 1
fi

PROMPT_CONTENT="$(cat "$BOOTSTRAP_FILE")"

TARGET_AI_CMD="gemini"

if ! command -v "$TARGET_AI_CMD" >/dev/null 2>&1; then
  echo "Error: unable to locate '$TARGET_AI_CMD'. Please ensure 'gemini' is in your PATH." >&2
  exit 1
fi

exec "$TARGET_AI_CMD" -p "$PROMPT_CONTENT"
