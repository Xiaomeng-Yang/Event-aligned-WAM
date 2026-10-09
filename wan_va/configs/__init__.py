# Copyright 2024-2025 The Robbyant Team Authors. All rights reserved.
# Modified to expose Event-Aligned inference configurations.
from .va_domino_event_aligned_cfg import (
    va_domino_event_aligned_fast_eval_cfg,
)
from .va_robotwin_event_aligned_cfg import (
    va_robotwin_event_aligned_fast_eval_cfg,
)

VA_CONFIGS = {
    'event_aligned_domino_fast':
        va_domino_event_aligned_fast_eval_cfg,
    'event_aligned_robotwin_fast':
        va_robotwin_event_aligned_fast_eval_cfg,
    # Compatibility alias for existing local commands.
    'domino_event_aligned_fast':
        va_domino_event_aligned_fast_eval_cfg,
}
