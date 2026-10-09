# Install Event-Aligned inference from source

Run the commands below from this source checkout. Use a dedicated Python 3.10 environment for the server; the upstream reference is Python 3.10.16, PyTorch 2.9.0, and CUDA 12.6. Install dependencies from the requirements files below and run the source scripts directly.

## Server environment

Install the upstream CUDA PyTorch wheels first so Flash Attention can build against the installed torch:

```bash
python -m pip install torch==2.9.0 torchvision==0.24.0 torchaudio==2.9.0 \
    --index-url https://download.pytorch.org/whl/cu126
python -m pip install -r requirements-inference.txt --no-build-isolation
```

The requirements retain upstream's model-library and NumPy pins. Flash Attention is required at import time by the upstream model module, even though this server selects torch attention for inference. Building it requires a compatible CUDA compiler/toolchain.

This release supports running directly from source with `requirements-inference.txt` for the server and `requirements-client.txt` for the image-only client. Training dependencies are not included.

Check command import and arguments without loading model weights:

```bash
python wan_va/wan_va_server.py --help
```

Then assemble the model components and launch the server using [README.md](README.md). The launch uses `torch.distributed.run`, including for one GPU.

## Image-only client environment

The client may use another Python environment or another machine. It needs no torch, CUDA, or DOMINO installation:

```bash
python -m pip install -r requirements-client.txt
python example/domino/client.py --help
```

`websockets>=15` supports the synchronous client arguments used by the example. Its observation and response serialization uses the bundled NumPy/msgpack helpers, matching the native server.

This example sends the first observation and records one initial action chunk. Running the DOMINO benchmark additionally requires its simulator, assets, task setup, action conversion, and rollout integration; none of those are installed by `requirements-client.txt`.

## DOMINO evaluation client environment

Use an existing [DOMINO simulator installation](https://github.com/H-EmbodVis/DOMINO#1-domino-simulation--data-pipeline), including its assets, SAPIEN/CuRobo dependencies, Vulkan rendering, and FFmpeg. In that environment, the client uses NumPy, SciPy, PyYAML, OpenCV, `websockets>=15`, `msgpack`, and `typing_extensions`. The simulator's own installation provides the simulation and numeric dependencies; if needed, install the transport dependencies with `python -m pip install 'websockets>=15' msgpack typing_extensions`.

Set `DOMINO_ROOT` to that checkout and follow the [DOMINO evaluation commands](README.md#evaluate-domino). The client imports DOMINO's task configuration, online expert screening, and metrics APIs. It requires no precomputed episode manifests or training datasets. The server runs separately in its CUDA inference environment and defaults to `model/event-aligned_domino_clean1/` when launched with `evaluation/domino/launch_server.sh`; supply the model components as described in the README.

## RoboTwin evaluation client environment

Run the RoboTwin evaluation client inside an existing RoboTwin 2.0 environment with its simulator, assets, task configurations, rendering dependencies, and FFmpeg installed. The client also uses `websockets>=15` and `msgpack` for the policy connection. The image-only requirements file does not install RoboTwin or its evaluation dependencies. Set `ROBOTWIN_ROOT` to that installation and use the [Event-Aligned evaluation launchers](README.md#evaluate-robotwin); the model server can run in its separate inference environment.
