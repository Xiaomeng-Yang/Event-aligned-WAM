#!/usr/bin/env bash
set -euo pipefail

: "${ROBOTWIN_ROOT:?Set ROBOTWIN_ROOT to your installed RoboTwin directory}"

# Preserve caller-relative paths before the client changes into RoboTwin.
case "$ROBOTWIN_ROOT" in
    /*) ;;
    *) ROBOTWIN_ROOT="$PWD/$ROBOTWIN_ROOT" ;;
esac
export ROBOTWIN_ROOT
save_root=${1:-./results}
case "$save_root" in
    /*) ;;
    *) save_root="$PWD/$save_root" ;;
esac
task_name=${2:-adjust_bottle}

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
export LD_LIBRARY_PATH="/usr/lib64:/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

PYTHONWARNINGS=ignore::UserWarning \
XLA_PYTHON_CLIENT_MEM_FRACTION=0.9 \
exec python -m evaluation.robotwin.eval_polict_client_openpi \
    --config policy/ACT/deploy_policy.yml \
    --overrides \
    --task_name "$task_name" \
    --task_config "${TASK_CONFIG:-demo_clean}" \
    --train_config_name 0 \
    --model_name 0 \
    --ckpt_setting 0 \
    --seed "${SEED:-0}" \
    --instruction_type "${INSTRUCTION_TYPE:-seen}" \
    --execution_mode "${EXECUTION_MODE:-predicted}" \
    --policy_name ACT \
    --save_root "$save_root" \
    --video_guidance_scale 5 \
    --action_guidance_scale 1 \
    --test_num "${TEST_NUM:-100}" \
    --host "${HOST:-127.0.0.1}" \
    --port "${PORT:-29536}"
