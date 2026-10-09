#!/usr/bin/env bash
set -euo pipefail

: "${DOMINO_ROOT:?Set DOMINO_ROOT to your installed DOMINO checkout}"
case "$DOMINO_ROOT" in
    /*) ;;
    *) DOMINO_ROOT="$PWD/$DOMINO_ROOT" ;;
esac
export DOMINO_ROOT
save_root=${1:-./results/domino}
case "$save_root" in
    /*) ;;
    *) save_root="$PWD/$save_root" ;;
esac
task_name=${2:-beat_block_hammer}
execution_args=()
if [ -n "${EXECUTION_MODE:-}" ]; then
    execution_args=(--execution_mode "$EXECUTION_MODE")
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

exec python -m evaluation.domino.eval_policy_client \
    --task_name "$task_name" \
    --task_config "${TASK_CONFIG:-demo_clean_dynamic}" \
    --test_num "${TEST_NUM:-100}" \
    --seed "${SEED:-0}" \
    --instruction_type "${INSTRUCTION_TYPE:-unseen}" \
    "${execution_args[@]}" \
    --save_root "$save_root" \
    --host "${HOST:-127.0.0.1}" \
    --port "${PORT:-29536}" \
    --video_guidance_scale 5 \
    --action_guidance_scale 1 \
    "${@:3}"
