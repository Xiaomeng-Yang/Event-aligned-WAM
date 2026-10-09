# Copyright 2024-2025 The Robbyant Team Authors. All rights reserved.
# Modified for DOMINO event-aligned inference.
import os

import torch
from easydict import EasyDict

va_shared_cfg = EasyDict()

va_shared_cfg.host = '0.0.0.0'
va_shared_cfg.port = 29536

va_shared_cfg.param_dtype = torch.bfloat16
va_shared_cfg.save_root = './train_out'

va_shared_cfg.patch_size = (1, 2, 2)

# Preserve the default; allow the existing runtime's explicit CPU-offload opt-in.
va_shared_cfg.enable_offload = os.environ.get('VA_ENABLE_OFFLOAD', '0') == '1'