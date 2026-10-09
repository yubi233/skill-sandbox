#!/bin/bash
# 用法: gen.sh <素材名> [quality]  —— 提示词取 dev/assets-raw/prompts/<素材名>.txt
# 输出: dev/assets-raw/<素材名>-raw.png ; 忙则退避重投(最多4次)
set -u
NAME="${1:?usage: gen.sh <name> [quality]}"
QUALITY="${2:-high}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT_FILE="$DIR/assets-raw/prompts/$NAME.txt"
OUT="$DIR/assets-raw/$NAME-raw.png"
[ -f "$PROMPT_FILE" ] || { echo "missing prompt: $PROMPT_FILE"; exit 1; }
PROMPT="$(cat "$PROMPT_FILE")"
S="${GEN_SESSION:-}"
SESSION_ARGS=()
[ -n "$S" ] && SESSION_ARGS=(--session "$S")
for i in 1 2 3 4; do
  out=$(python3 ~/.zcode/skills/mimo-image/scripts/mimo_image.py ${SESSION_ARGS[@]+"${SESSION_ARGS[@]}"} \
    --size 1024x1024 --quality "$QUALITY" --timeout 400 -o "$OUT" -p "$PROMPT" 2>&1) && { echo "$out"; exit 0; }
  if echo "$out" | grep -q '正在跑别的回合'; then echo "busy attempt $i ($NAME)"; sleep 15; continue; fi
  echo "$out"; exit 1
done
exit 1
