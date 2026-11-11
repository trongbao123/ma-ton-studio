"""Kernel Kaggle: ảnh cảnh + prompt chuyển động -> clip mp4 ngắn (image-to-video, LTX-Video).

Đầu vào : dataset gắn vào kernel, có manifest.json {width,height,frames,fps,seed,clips:[{id,image,prompt}]} và các ảnh.
Đầu ra  : /kaggle/working/clip-<id>.mp4 + /kaggle/working/results.json.
Log     : mỗi clip một dòng `MTS_CLIP id=<id> ok=<0|1> sec=<giây>` để pipeline (kaggle.ts) đọc lại.
Không có GPU / internet thì in MTS_NO_GPU / MTS_NO_INTERNET rồi thoát mã 3 (tài khoản chưa xác minh điện thoại).
"""
import glob
import gc
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

OUT = "/kaggle/working"
T0 = time.time()

# Ưu tiên bản distilled 2B (8 bước, guidance 1.0); lỗi tải/chạy thì thử bản thường nhỏ hơn.
MODELS = [
    {
        "name": "LTX-Video 0.9.8 2B distilled",
        "repo": "Lightricks/LTX-Video",
        "file": "ltxv-2b-0.9.8-distilled.safetensors",
        "steps": 8,
        "guidance": 1.0,
    },
    {
        "name": "LTX-Video 0.9.5",
        "repo": "Lightricks/LTX-Video-0.9.5",
        "file": None,
        "steps": 30,
        "guidance": 3.0,
    },
]
NEGATIVE = "worst quality, inconsistent motion, blurry, jittery, distorted, shaky camera, watermark, text"


def log(msg):
    print(f"[{time.time() - T0:7.1f}s] {msg}", flush=True)


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def die(mark, msg, code=3):
    print(f"{mark} {msg}", flush=True)
    sys.exit(code)


def find_input():
    hits = glob.glob("/kaggle/input/**/manifest.json", recursive=True)
    if not hits:
        die("MTS_NO_INPUT", "không thấy manifest.json trong /kaggle/input", 4)
    return os.path.dirname(hits[0])


def check_env():
    import torch

    if not torch.cuda.is_available():
        die("MTS_NO_GPU", f"torch {torch.__version__} không thấy GPU (kernel chạy không có accelerator)")
    log(f"GPU: {torch.cuda.get_device_name(0)} · {torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} GiB · {sh('nvidia-smi --query-gpu=driver_version --format=csv,noheader')}")
    try:
        urllib.request.urlopen("https://huggingface.co", timeout=15)
    except Exception as e:  # noqa: BLE001
        die("MTS_NO_INTERNET", f"không ra được huggingface.co: {e}")
    return torch


def load_pipe(torch, spec):
    from diffusers import LTXImageToVideoPipeline

    dtype = torch.float16  # T4 không có bfloat16 phần cứng
    if spec["file"]:
        from huggingface_hub import hf_hub_download

        path = hf_hub_download(spec["repo"], spec["file"])
        pipe = LTXImageToVideoPipeline.from_single_file(path, torch_dtype=dtype)
        # Bản single-file không kèm text encoder: lấy T5 từ repo gốc.
        if getattr(pipe, "text_encoder", None) is None:
            from transformers import T5EncoderModel, T5TokenizerFast

            pipe.text_encoder = T5EncoderModel.from_pretrained(spec["repo"], subfolder="text_encoder", torch_dtype=dtype)
            pipe.tokenizer = T5TokenizerFast.from_pretrained(spec["repo"], subfolder="tokenizer")
    else:
        pipe = LTXImageToVideoPipeline.from_pretrained(spec["repo"], torch_dtype=dtype)
    # T5-XXL + transformer không vừa 15 GiB cùng lúc: mỗi mô-đun lên GPU khi dùng rồi về CPU.
    pipe.enable_model_cpu_offload()
    pipe.vae.enable_tiling()
    return pipe


def write_mp4(frames, path, fps):
    from diffusers.utils import export_to_video

    export_to_video(frames, path, fps=fps)


def usable(frames):
    """Khung hình không toàn đen / NaN (fp16 đôi khi hỏng)."""
    import numpy as np

    arr = np.asarray(frames[len(frames) // 2], dtype="float32")
    return bool(np.isfinite(arr).all() and arr.std() > 2.0)


def main():
    root = find_input()
    manifest = json.load(open(os.path.join(root, "manifest.json")))
    torch = check_env()
    from PIL import Image
    import numpy as np  # noqa: F401

    w, h, frames, fps, seed = manifest["width"], manifest["height"], manifest["frames"], manifest["fps"], manifest["seed"]
    results, pipe, spec_used = [], None, None
    for spec in MODELS:
        try:
            log(f"nạp model {spec['name']}")
            t = time.time()
            pipe = load_pipe(torch, spec)
            log(f"nạp xong sau {time.time() - t:.0f}s")
            spec_used = spec
            break
        except Exception as e:  # noqa: BLE001
            log(f"model {spec['name']} lỗi: {type(e).__name__}: {str(e)[:300]}")
            pipe = None
            gc.collect()
            torch.cuda.empty_cache()
    if pipe is None:
        die("MTS_NO_MODEL", "không nạp được model nào", 5)

    for job in manifest["clips"]:
        t = time.time()
        ok = False
        try:
            img = Image.open(os.path.join(root, job["image"])).convert("RGB").resize((w, h), Image.LANCZOS)
            gen = torch.Generator("cuda").manual_seed(seed + job["id"])
            out = pipe(
                image=img,
                prompt=job["prompt"],
                negative_prompt=NEGATIVE,
                width=w,
                height=h,
                num_frames=frames,
                num_inference_steps=spec_used["steps"],
                guidance_scale=spec_used["guidance"],
                decode_timestep=0.05,
                image_cond_noise_scale=0.025,
                generator=gen,
            ).frames[0]
            if usable(out):
                write_mp4(out, os.path.join(OUT, f"clip-{job['id']}.mp4"), fps)
                ok = True
            else:
                log(f"clip {job['id']}: khung hình hỏng (đen/NaN)")
        except Exception as e:  # noqa: BLE001
            log(f"clip {job['id']} lỗi: {type(e).__name__}: {str(e)[:300]}")
            gc.collect()
            torch.cuda.empty_cache()
        sec = time.time() - t
        results.append({"id": job["id"], "ok": ok, "seconds": round(sec, 1)})
        print(f"MTS_CLIP id={job['id']} ok={int(ok)} sec={sec:.1f}", flush=True)

    json.dump({"model": spec_used["name"], "gpu": torch.cuda.get_device_name(0), "total_seconds": round(time.time() - T0, 1), "clips": results}, open(os.path.join(OUT, "results.json"), "w"))
    log(f"xong {sum(r['ok'] for r in results)}/{len(results)} clip, tổng {time.time() - T0:.0f}s")
    # Dọn cache model khỏi /kaggle/working để output chỉ có clip.
    shutil.rmtree(os.path.join(OUT, ".cache"), ignore_errors=True)


if __name__ == "__main__":
    main()
