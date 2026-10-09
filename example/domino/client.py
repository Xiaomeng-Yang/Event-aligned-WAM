import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image


CAMERA_KEYS = (
    "observation.images.cam_high",
    "observation.images.cam_left_wrist",
    "observation.images.cam_right_wrist",
)


def load_observation(paths):
    """Read one RGB observation, in high/left-wrist/right-wrist order."""
    observation = {}
    for key, path in zip(CAMERA_KEYS, paths):
        with Image.open(path) as image:
            observation[key] = np.array(image.convert("RGB"), dtype=np.uint8)
    return observation


def prepare_result(response):
    """Select the initial executable slots from the native response.

    The first latent group is conditioning only. The first real slot [1, 0]
    is mandatory even if its raw execution-head probability is below threshold.
    Keep the raw response arrays intact so this distinction remains visible.
    """
    action = np.asarray(response["action"])
    probability = np.asarray(response["execute_prob"])
    raw_mask = np.asarray(response["execute_mask"])
    threshold = response.get("execute_threshold", 0.5)

    effective_mask = raw_mask.copy()
    effective_mask[0] = False
    effective_mask[1, 0] = True
    indices = np.argwhere(effective_mask)
    return {
        "action": action,
        "execute_prob": probability,
        "execute_mask": raw_mask,
        "execute_threshold": np.asarray(threshold),
        "effective_mask": effective_mask,
        "selected_indices": indices,
        "selected_action": action[:, indices[:, 0], indices[:, 1]].T,
    }


def infer_initial_chunk(host, port, prompt, observation):
    """Use the upstream NumPy/msgpack wire format without importing GPU code."""
    import websockets.sync.client

    # Import upstream's lightweight codec directly. Importing wan_va.utils
    # through the package would eagerly import the GPU model dependencies.
    transport_root = Path(__file__).resolve().parents[2] / "wan_va" / "utils" / "Simple_Remote_Infer"
    sys.path.insert(0, str(transport_root))
    from deploy.msgpack_numpy import Packer, unpackb

    packer = Packer()
    with websockets.sync.client.connect(
        f"ws://{host}:{port}", compression=None, max_size=None,
        ping_interval=None, close_timeout=10,
    ) as connection:
        def receive():
            response = connection.recv()
            if isinstance(response, str):
                raise RuntimeError(f"Error in inference server:\n{response}")
            return unpackb(response)

        metadata = receive()
        connection.send(packer.pack({"reset": True, "prompt": prompt}))
        receive()
        connection.send(packer.pack({"obs": observation, "prompt": prompt}))
        return receive(), metadata


def main():
    parser = argparse.ArgumentParser(
        description="Request one initial DOMINO action chunk from three real camera images.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=29536)
    parser.add_argument("--prompt", required=True, help="Task instruction")
    parser.add_argument("--image-dir", type=Path,
                        help="Directory with observation.images.cam_{high,left_wrist,right_wrist}.png")
    parser.add_argument("--cam-high", type=Path)
    parser.add_argument("--cam-left-wrist", type=Path)
    parser.add_argument("--cam-right-wrist", type=Path)
    parser.add_argument("--output", type=Path, default=Path("initial_actions.npz"))
    args = parser.parse_args()

    if not args.prompt.strip():
        parser.error("--prompt must not be empty")
    paths = [args.cam_high, args.cam_left_wrist, args.cam_right_wrist]
    if args.image_dir is not None:
        if any(path is not None for path in paths):
            parser.error("Use --image-dir or all three camera paths")
        paths = [args.image_dir / f"{key}.png" for key in CAMERA_KEYS]
    elif any(path is None for path in paths):
        parser.error("Provide --image-dir or all three camera paths")

    observation = load_observation(paths)
    response, metadata = infer_initial_chunk(
        args.host, args.port, args.prompt, observation)
    result = prepare_result(response)
    result["prompt"] = np.asarray(args.prompt)
    result["server_metadata_json"] = np.asarray(json.dumps(metadata))
    if "execution_selection" in response:
        result["execution_selection"] = np.asarray(response["execution_selection"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as output:
        np.savez_compressed(output, **result)
    print(f"Saved {args.output}: {len(result['selected_indices'])} selected initial slots. "
          "No actions were executed.")


if __name__ == "__main__":
    main()
