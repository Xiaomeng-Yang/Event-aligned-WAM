"""Event-Aligned fast inference for DOMINO."""
from copy import deepcopy

from easydict import EasyDict

from .va_event_aligned_cfg import va_event_aligned_cfg


va_domino_event_aligned_fast_eval_cfg = EasyDict(
    deepcopy(va_event_aligned_cfg))
_cfg = va_domino_event_aligned_fast_eval_cfg
_cfg.__name__ = 'Config: Event-Aligned DOMINO fast inference'
_cfg.wan22_pretrained_model_name_or_path = './model/event-aligned_domino_clean1'
_cfg.infer_mode = 'server'
del _cfg
