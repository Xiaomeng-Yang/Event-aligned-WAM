#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

model_path=${MODEL_PATH:-$repo_root/model/event-aligned_domino_clean1}
save_root=${SAVE_ROOT:-./outputs/domino/server}
mkdir -p "$save_root"

exec python -m torch.distributed.run \
    --nproc_per_node 1 \
    --master_port "${MASTER_PORT:-29501}" \
    wan_va/wan_va_server.py \
    --config-name event_aligned_domino_fast \
    --model-path "$model_path" \
    --port "${PORT:-29536}" \
    --save_root "$save_root"
