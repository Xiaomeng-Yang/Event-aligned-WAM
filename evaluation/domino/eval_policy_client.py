import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
from scipy.spatial.transform import Rotation


def format_obs(observation, prompt):
    return {
        "observation.images.cam_high": observation["observation"]["head_camera"]["rgb"],
        "observation.images.cam_left_wrist": observation["observation"]["left_camera"]["rgb"],
        "observation.images.cam_right_wrist": observation["observation"]["right_camera"]["rgb"],
        "observation.state": observation["joint_action"]["vector"],
        "task": prompt,
    }


def get_initial_eef_pose(observation):
    endpose = observation["endpose"]
    return np.array(
        list(endpose["left_endpose"]) + [endpose["left_gripper"]]
        + list(endpose["right_endpose"]) + [endpose["right_gripper"]],
        dtype=np.float64,
    )


def add_init_pose(relative_pose, initial_pose):
    """Invert the existing relative xyz/xyzw convention for both arms."""
    arms = []
    for offset in (0, 8):
        target = relative_pose[offset:offset + 8]
        initial = initial_pose[offset:offset + 8]
        rotation = (Rotation.from_quat(initial[3:7])
                    * Rotation.from_quat(target[3:7])).as_quat()
        arms.append(np.concatenate((target[:3] + initial[:3], rotation, target[7:8])))
    return np.concatenate(arms)


def resolve_execution_mode(model, execution_mode):
    if execution_mode is None:
        return ("predicted" if model.get_server_metadata().get("enable_execution_head", False)
                else "all")
    return execution_mode


def execution_mask_for_chunk(action, response, *, execution_mode, first):
    """Keep the full event grid; optionally select slots with the execution head."""
    if execution_mode not in ("all", "predicted"):
        raise ValueError("execution_mode must be 'all' or 'predicted'")
    if action.shape != (16, 2, 16) or not np.isfinite(action).all():
        raise ValueError("DOMINO event-chunk evaluation requires finite actions shaped [16, 2, 16]")
    if execution_mode == "predicted":
        if "execute_prob" not in response or "execute_mask" not in response:
            raise ValueError("predicted execution requires an execution-head response")
        probability = np.asarray(response["execute_prob"])
        mask = np.asarray(response["execute_mask"])
        if probability.shape != (2, 16) or mask.shape != (2, 16):
            raise ValueError("execute_prob and execute_mask must have shape [2, 16]")
        if (not np.issubdtype(probability.dtype, np.number)
                or not np.isfinite(probability).all()
                or np.any((probability < 0) | (probability > 1))):
            raise ValueError("execute_prob must contain finite probabilities in [0, 1]")
        if mask.dtype != np.bool_:
            raise ValueError("execute_mask must be boolean")
        threshold = response.get("execute_threshold", 0.5)
        if (isinstance(threshold, (bool, np.bool_))
                or not isinstance(threshold, (int, float, np.number))
                or not np.isfinite(threshold) or not 0 <= threshold <= 1):
            raise ValueError("execute_threshold must be finite and in [0, 1]")
        if not np.array_equal(mask, probability >= threshold):
            raise ValueError("execute_mask does not match execute_prob >= execute_threshold")
        mask = mask.copy()
        # Only the first real slot in the whole chunk is mandatory.
        mask[1 if first else 0, 0] = True
    else:
        mask = np.ones(action.shape[1:], dtype=bool)
    if first:
        mask[0] = False  # The initial latent group is conditioning only.
    return mask


def build_dynamic_state(env):
    dynamic = {
        "check_z_threshold": None, "actor": None, "start_z": None,
        "has_lifted": False, "stop_on_contact": True,
    }
    config = getattr(env, "get_dynamic_motion_config", lambda: None)()
    if config and "check_z_threshold" in config:
        dynamic["check_z_threshold"] = config["check_z_threshold"]
        dynamic["actor"] = (config["check_z_actor"] if "check_z_actor" in config
                            else config["target_actor"])
        dynamic["start_z"] = dynamic["actor"].get_pose().p[2]
    if config and "stop_on_contact" in config:
        dynamic["stop_on_contact"] = config["stop_on_contact"]
    return dynamic


def make_on_step(env, args, metrics_tracker, dynamic):
    """Apply DOMINO's termination/contact checks after every executed target."""
    def on_step():
        if dynamic["check_z_threshold"] is not None and not dynamic["has_lifted"]:
            height = dynamic["actor"].get_pose().p[2] - dynamic["start_z"]
            if height > dynamic["check_z_threshold"]:
                dynamic["has_lifted"] = True
        if env.eval_success:
            if dynamic["check_z_threshold"] is not None and not dynamic["has_lifted"]:
                return "object_not_lifted", True
            return None, True
        if args.get("use_dynamic", False):
            if env.check_gripper_contact_dynamic_object() and dynamic["stop_on_contact"]:
                env.stop_dynamic_object_motion()
            if not getattr(env, "_dynamic_object_stopped", False):
                if not env.check_dynamic_object_boundary():
                    env.eval_fail = True
                    metrics_tracker.record_out_of_bounds()
                    return "out_of_bounds", True
        if env.eval_fail:
            return "eval_fail", True
        return None, False

    return on_step


def run_lingbot_va_episode(env, model, prompt, *, on_step,
                           video_guidance_scale=5.0, action_guidance_scale=1.0,
                           save_visualization=False, execution_mode=None):
    """Reset, execute relative EEF chunks, and commit observed KV history."""
    execution_mode = resolve_execution_mode(model, execution_mode)
    model.infer(dict(reset=True, prompt=prompt, save_visualization=save_visualization))
    initial_observation = env.get_obs()
    initial_pose = get_initial_eef_pose(initial_observation)
    first_observation = format_obs(initial_observation, prompt)
    first = True

    while env.take_action_cnt < env.step_lim:
        response = model.infer(dict(
            obs=first_observation, prompt=prompt, save_visualization=save_visualization,
            video_guidance_scale=video_guidance_scale,
            action_guidance_scale=action_guidance_scale,
        ))
        action = np.asarray(response["action"])
        mask = execution_mask_for_chunk(
            action, response, execution_mode=execution_mode, first=first)
        history_action = action.copy()
        observations = []
        last_relative_target = None
        last_anchor_step = None
        last_anchor_observation = None
        for frame in range(1 if first else 0, action.shape[1]):
            for slot in range(action.shape[2]):
                if env.take_action_cnt >= env.step_lim:
                    return False, None
                if mask[frame, slot]:
                    if getattr(env, "eval_video_path", None) is not None:
                        # take_action writes now_obs to the native evaluation
                        # video. Refresh it per action, independently of KV anchors.
                        env.get_obs()
                    env.take_action(add_init_pose(action[:, frame, slot], initial_pose),
                                    action_type="ee")
                    last_relative_target = action[:, frame, slot].copy()
                    reason, done = on_step()
                    if done:
                        return reason is None, reason
                else:
                    # Keep the previous submitted target across group boundaries.
                    history_action[:, frame, slot] = last_relative_target
                if (slot + 1) % (action.shape[2] // 4) == 0:
                    if last_anchor_step != env.take_action_cnt:
                        last_anchor_observation = format_obs(env.get_obs(), prompt)
                        last_anchor_step = env.take_action_cnt
                    observations.append(last_anchor_observation)

        # Partial/terminal chunks must never be committed as complete history.
        if env.take_action_cnt >= env.step_lim:
            return False, None
        model.infer(dict(
            obs=observations, compute_kv_cache=True, imagine=False,
            save_visualization=save_visualization, state=history_action,
        ))
        first = False

    # DOMINO reports a failed step-budget exhaustion with no explicit reason.
    return False, None


def write_results(save_dir, metrics, instructions, instruction_type):
    """Persist partial progress after each evaluated episode, using DOMINO metrics."""
    summary = metrics.get_summary()
    summary = {key: None if isinstance(value, float) and not np.isfinite(value) else value
               for key, value in summary.items()}
    episodes = metrics.get_all_episodes()
    for episode, instruction in zip(episodes, instructions):
        episode["instruction"] = instruction
    for name, content in (("_metrics.json", summary), ("_episodes_detail.json", episodes)):
        (save_dir / name).write_text(json.dumps(content, indent=2, allow_nan=False) + "\n")
    (save_dir / "_metrics_report.txt").write_text(metrics.to_detailed_report())
    success_rate = sum(bool(episode["success"]) for episode in episodes) / len(episodes)
    (save_dir / "_result.txt").write_text(
        f"Instruction Type: {instruction_type}\n\n{success_rate}\n")


def eval_policy(env, args, model, options, save_dir, *, online_episode_provider,
                generate_episode_descriptions, metrics_tracker_type, aggregated_metrics_type,
                video_size=None):
    """DOMINO's online expert-screened episode lifecycle, without saved episodes."""
    args["eval_mode"] = True
    env.suc = 0
    env.test_num = 0
    metrics = aggregated_metrics_type()
    instructions = []
    start_seed = 100000 * (1 + options.seed)
    for episode in online_episode_provider(env, args, start_seed):
        seed = episode["seed"]
        video_started = False
        try:
            env.setup_demo(now_ep_num=env.test_num, seed=seed, is_test=True, **args)
            # setup_demo resets dynamic state; restore the trajectory validated by
            # the expert before initializing policy-time object motion.
            if episode["dynamic_motion_info"] is not None:
                env._saved_dynamic_motion_info = episode["dynamic_motion_info"]
            descriptions = generate_episode_descriptions(
                args["task_name"], [episode["episode_info"]["info"]], options.test_num)
            prompt = str(np.random.choice(descriptions[0][options.instruction_type]))
            env.set_instruction(instruction=prompt)
            if args.get("use_dynamic", False) and not env.init_dynamic_motion_for_eval():
                print(f"Skipping seed {seed}: dynamic motion initialization failed", flush=True)
                continue
            dynamic = build_dynamic_state(env)
            tracker = metrics_tracker_type(env, args)
            tracker.on_episode_start()
            # DOMINO's take_action invokes tracker.on_step once per policy action.
            env._metrics_tracker = tracker
            if env.eval_video_path is not None:
                ffmpeg = subprocess.Popen([
                    "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo",
                    "-pixel_format", "rgb24", "-video_size", video_size,
                    "-framerate", "10", "-i", "-", "-pix_fmt", "yuv420p",
                    "-vcodec", "libx264", "-crf", "23",
                    str(save_dir / f"episode{env.test_num}.mp4"),
                ], stdin=subprocess.PIPE)
                env._set_eval_video_ffmpeg(ffmpeg)
                video_started = True
            success, reason = run_lingbot_va_episode(
                env, model, prompt, on_step=make_on_step(env, args, tracker, dynamic),
                video_guidance_scale=options.video_guidance_scale,
                action_guidance_scale=options.action_guidance_scale,
                save_visualization=options.save_visualization,
                execution_mode=options.execution_mode,
            )
            metrics.add_episode(tracker.get_episode_metrics(success, reason, seed=seed))
            instructions.append(prompt)
            env.suc += int(success)
            env.test_num += 1
            write_results(save_dir, metrics, instructions, options.instruction_type)
            print(f"{args['task_name']}: {env.suc}/{env.test_num} successful; "
                  f"seed={seed}, result={reason or ('success' if success else 'step_limit')}",
                  flush=True)
        finally:
            env._metrics_tracker = None
            if video_started:
                env._del_eval_video_ffmpeg()
            env.close_env(clear_cache=(env.test_num % args["clear_cache_freq"] == 0))
            env.release_episode_resources()
        if env.test_num >= options.test_num:
            break
    return metrics


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="DOMINO online evaluation with the Event-Aligned chunked websocket policy.")
    parser.add_argument("--domino_root", type=Path, default=os.environ.get("DOMINO_ROOT"),
                        help="Installed DOMINO checkout (or set DOMINO_ROOT)")
    parser.add_argument("--task_name", required=True)
    parser.add_argument("--task_config", default="demo_clean_dynamic")
    parser.add_argument("--test_num", type=int, default=100)
    parser.add_argument("--seed", type=int, default=0,
                        help="DOMINO seed group; candidate seeds start at 100000 * (1 + seed)")
    parser.add_argument("--instruction_type", choices=("seen", "unseen"), default="unseen")
    parser.add_argument("--execution_mode", choices=("all", "predicted"),
                        help="Default: predicted if the server advertises an execution head, otherwise all")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=29536)
    parser.add_argument("--save_root", type=Path, default=Path("results/domino"))
    parser.add_argument("--video_guidance_scale", type=float, default=5.0)
    parser.add_argument("--action_guidance_scale", type=float, default=1.0)
    parser.add_argument("--save_visualization", action="store_true",
                        help="Request optional server-side imagined-video visualization")
    parser.add_argument("--no-video", action="store_true",
                        help="Disable DOMINO evaluation video recording")
    options = parser.parse_args(argv)
    if options.domino_root is None:
        parser.error("Set DOMINO_ROOT or pass --domino_root")
    options.domino_root = options.domino_root.expanduser().resolve()
    if not (options.domino_root / "script" / "eval_policy.py").is_file():
        parser.error(f"DOMINO checkout not found: {options.domino_root}")
    if options.test_num <= 0 or options.seed < 0:
        parser.error("--test_num must be positive and --seed must be nonnegative")
    options.save_root = options.save_root.expanduser().resolve()
    return options


def main(argv=None):
    options = parse_args(argv)
    # DOMINO loads assets/configs relative to its checkout. Resolve all local
    # output paths before chdir and keep this repository importable.
    repo_root = Path(__file__).resolve().parents[2]
    for path in (repo_root, options.domino_root / "description" / "utils",
                 options.domino_root / "policy", options.domino_root,
                 options.domino_root / "script"):
        sys.path.insert(0, str(path))
    os.chdir(options.domino_root)
    from eval_policy import build_task_args, class_decorator, get_camera_config
    from eval_metrics import EvalMetricsTracker, AggregatedMetrics
    from episode_manifest import online_episode_provider
    from generate_episode_instructions import generate_episode_descriptions
    from evaluation.robotwin.websocket_client_policy import WebsocketClientPolicy

    args = build_task_args(options.task_name, options.task_config, "local-model")
    args["policy_name"] = "LingBotVA"
    save_dir = (options.save_root / options.task_name / options.task_config
                / f"stseed-{100000 * (1 + options.seed)}"
                / datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    save_dir.mkdir(parents=True, exist_ok=False)
    video_size = None
    if args.get("eval_video_log", False) and not options.no_video:
        camera = get_camera_config(args["camera"]["head_camera_type"])
        video_size = f"{camera['w']}x{camera['h']}"
        args["eval_video_save_dir"] = str(save_dir)
    else:
        args["eval_video_save_dir"] = None
    model = WebsocketClientPolicy(host=options.host, port=options.port)
    options.execution_mode = resolve_execution_mode(model, options.execution_mode)
    metadata = {key: str(value) if isinstance(value, Path) else value
                for key, value in vars(options).items()}
    metadata["episode_source"] = "online_expert_screening"
    (save_dir / "_run.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Results: {save_dir}", flush=True)
    print(f"Execution mode: {options.execution_mode}", flush=True)
    env = class_decorator(options.task_name)
    eval_policy(
        env, args, model, options, save_dir,
        online_episode_provider=online_episode_provider,
        generate_episode_descriptions=generate_episode_descriptions,
        metrics_tracker_type=EvalMetricsTracker,
        aggregated_metrics_type=AggregatedMetrics,
        video_size=video_size,
    )


if __name__ == "__main__":
    main()
