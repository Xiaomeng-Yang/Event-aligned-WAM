# Copyright 2024-2025 The Robbyant Team Authors. All rights reserved.
# Adapted from LingBot-VA's va_robotwin_cfg.py for Event-Aligned inference.
# Preserve the released checkpoints' image layout, action order and normalization.
from easydict import EasyDict

from .shared_config import va_shared_cfg


va_event_aligned_cfg = EasyDict(__name__='Config: Event-Aligned fast inference')
va_event_aligned_cfg.update(va_shared_cfg)
va_event_aligned_cfg.infer_mode = 'server'

va_event_aligned_cfg.attn_window = 72
va_event_aligned_cfg.frame_chunk_size = 2
va_event_aligned_cfg.env_type = 'robotwin_tshape'

va_event_aligned_cfg.height = 256
va_event_aligned_cfg.width = 320
va_event_aligned_cfg.action_dim = 30
va_event_aligned_cfg.action_per_frame = 16
va_event_aligned_cfg.obs_cam_keys = [
    'observation.images.cam_high', 'observation.images.cam_left_wrist',
    'observation.images.cam_right_wrist'
]
va_event_aligned_cfg.guidance_scale = 5
va_event_aligned_cfg.action_guidance_scale = 1

va_event_aligned_cfg.enable_execution_head = True
va_event_aligned_cfg.execute_threshold = 0.5
# Three video Euler updates, then a fourth forward commits the cache at s=0.6.
va_event_aligned_cfg.num_inference_steps = 5
va_event_aligned_cfg.video_exec_step = 4
va_event_aligned_cfg.action_num_inference_steps = 10

va_event_aligned_cfg.snr_shift = 5.0
va_event_aligned_cfg.action_snr_shift = 1.0

va_event_aligned_cfg.used_action_channel_ids = list(range(0, 7)) + list(
    range(28, 29)) + list(range(7, 14)) + list(range(29, 30))
inverse_used_action_channel_ids = [
    len(va_event_aligned_cfg.used_action_channel_ids)
] * va_event_aligned_cfg.action_dim
for i, j in enumerate(va_event_aligned_cfg.used_action_channel_ids):
    inverse_used_action_channel_ids[j] = i
va_event_aligned_cfg.inverse_used_action_channel_ids = inverse_used_action_channel_ids

va_event_aligned_cfg.action_norm_method = 'quantiles'
va_event_aligned_cfg.norm_stat = {
    "q01": [
        -0.06172713458538055, -3.6716461181640625e-05, -0.08783501386642456,
        -1, -1, -1, -1, -0.3547105032205582, -1.3113021850585938e-06,
        -0.11975435614585876, -1, -1, -1, -1
    ] + [0.] * 16,
    "q99": [
        0.3462600058317184, 0.39966784834861746, 0.14745532035827624, 1, 1, 1,
        1, 0.034201726913452024, 0.39142737388610793, 0.1792279863357542, 1, 1,
        1, 1
    ] + [0.] * 14 + [1.0, 1.0],
}
