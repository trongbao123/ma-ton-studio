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
import traceback
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
        # Lịch bước distilled theo docs diffusers (LTX 0.9.8 distilled).
        "timesteps": [1000, 993, 987, 981, 975, 909, 725, 0.03],
    },
    {
        "name": "LTX-Video 0.9.5",
        "repo": "Lightricks/LTX-Video-0.9.5",
        "file": None,
        "steps": 30,
        "guidance": 3.0,
    },
]
# Chỉ dùng khi manifest không gửi kèm "negative" (bản thật nằm ở MOTION_NEGATIVE trong pipeline/i2v-plan.ts).
NEGATIVE = "worst quality, inconsistent motion, blurry, jittery, distorted, morphing, deformed face, changing face, changing pose, new objects, extra people, photorealistic, live action, camera movement, zoom, shaky camera, static, frozen, still image, watermark, text"


def log(msg):
    print(f"[{time.time() - T0:7.1f}s] {msg}", flush=True)


# Báo tiến độ về app: API Kaggle chỉ trả log SAU KHI kernel xong, nên không có đường này thì
# cả màn flow lẫn CLI đều mù suốt lượt chạy (với model chậm là cả tiếng). Hỏng thì bỏ qua, không làm đổ việc sinh clip.
PROGRESS = {}
PROGRESS_EVERY_SEC = 15


def post_progress(**kw):
    if not PROGRESS.get("url"):
        return
    body = {"slug": PROGRESS["slug"], "videoId": PROGRESS.get("videoId", 0), "total": PROGRESS.get("total", 0)}
    body.update(kw)
    try:
        req = urllib.request.Request(
            PROGRESS["url"],
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + PROGRESS["token"]},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10).read()
    except Exception:  # noqa: BLE001
        pass


def step_reporter(clip_id, steps):
    """callback_on_step_end của diffusers: báo về mỗi PROGRESS_EVERY_SEC giây và ở bước cuối."""
    last = {"t": 0.0}

    def cb(_pipe, i, _t, kwargs):
        now = time.time()
        if i + 1 >= steps or now - last["t"] >= PROGRESS_EVERY_SEC:
            last["t"] = now
            post_progress(stage="clip", clip=clip_id, step=i + 1, steps=steps)
        return kwargs

    return cb


def spec_name(spec):
    """Tên model để ghi log. Dùng .get: manifest thăm dò có thể thiếu khoá, và KeyError ở nhánh bắt lỗi
    sẽ NUỐT MẤT lỗi thật (đã dính một lần — kernel chỉ báo KeyError: 'name')."""
    return spec.get("name") or spec.get("repo") or "?"


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
    if spec.get("family") == "cogvideox":
        # CogVideoX-5B I2V: 6B, kích thước cố định 720x480 / 49 khung @ 8fps. Train ở bf16 mà T4 chỉ có fp16
        # → có thể ra NaN; usable() bắt được. Phải offload tuần tự + tiling/slicing mới vừa 16 GB.
        from diffusers import CogVideoXImageToVideoPipeline

        pipe = CogVideoXImageToVideoPipeline.from_pretrained(spec["repo"], torch_dtype=torch.float16)
        pipe.enable_sequential_cpu_offload()
        pipe.vae.enable_tiling()
        pipe.vae.enable_slicing()
        return pipe

    # Condition pipeline (0.9.5+): khóa ảnh ở nhiều khung → ghim cả khung đầu lẫn cuối, nhân vật không trôi.
    from diffusers import LTXConditionPipeline as Pipe

    dtype = torch.float16  # T4 không có bfloat16 phần cứng
    if spec["file"]:
        from huggingface_hub import hf_hub_download

        from transformers import T5EncoderModel, T5TokenizerFast

        path = hf_hub_download(spec["repo"], spec["file"])
        # File single-file không chứa T5: phải truyền sẵn text encoder (lấy từ repo diffusers gốc), không thì diffusers báo
        # "Weights for this component appear to be missing in the checkpoint".
        base = spec.get("textRepo", "Lightricks/LTX-Video")
        text_encoder = T5EncoderModel.from_pretrained(base, subfolder="text_encoder", torch_dtype=dtype)
        tokenizer = T5TokenizerFast.from_pretrained(base, subfolder="tokenizer")
        pipe = Pipe.from_single_file(path, text_encoder=text_encoder, tokenizer=tokenizer, torch_dtype=dtype)
    else:
        pipe = Pipe.from_pretrained(spec["repo"], torch_dtype=dtype)
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
    # Manifest chỉ định model (CLI i2v-model để thăm dò) thì chỉ thử đúng model đó, không rơi về danh sách mặc định.
    PROGRESS.update(manifest.get("progress") or {})
    if PROGRESS.get("url"):
        log(f"báo tiến độ về {PROGRESS['url']}")
    post_progress(stage="load")
    candidates = [manifest["model"]] if manifest.get("model") else MODELS
    results, pipe, spec_used = [], None, None
    for spec in candidates:
        try:
            log(f"nạp model {spec_name(spec)}")
            t = time.time()
            pipe = load_pipe(torch, spec)
            log(f"nạp xong sau {time.time() - t:.0f}s")
            spec_used = spec
            break
        except Exception as e:  # noqa: BLE001
            log(f"model {spec_name(spec)} lỗi: {type(e).__name__}: {str(e)[:300]}")
            traceback.print_exc()
            pipe = None
            gc.collect()
            torch.cuda.empty_cache()
    if pipe is None:
        die("MTS_NO_MODEL", "không nạp được model nào", 5)

    # Mức chung; mỗi clip ghi đè được (dùng khi dò tham số — xem pipeline/i2v-sweep.ts).
    negative_all = manifest.get("negative") or NEGATIVE
    end_all = float(manifest.get("endStrength", 0))

    for job in manifest["clips"]:
        t = time.time()
        ok = False
        peak_gib = 0.0
        try:
            img = Image.open(os.path.join(root, job["image"])).convert("RGB").resize((w, h), Image.LANCZOS)
            gen = torch.Generator("cuda").manual_seed(seed + job["id"])
            from diffusers.pipelines.ltx.pipeline_ltx_condition import LTXVideoCondition

            # Khung đầu khóa cứng ảnh gốc (nối liền ảnh tĩnh); khung cuối khóa nhẹ `endStrength` → giữ mặt mà vẫn động (1.0 = đứng yên).
            end = float(job.get("endStrength", end_all))
            n_frames = int(job.get("frames", frames))
            negative = job.get("negative") or negative_all
            log(f"clip {job['id']}: {n_frames} khung, khóa cuối {end}")
            torch.cuda.reset_peak_memory_stats()
            if spec_used.get("family") == "cogvideox":
                # CogVideoX chỉ nhận 1 ảnh ở khung đầu — không có cơ chế khóa khung cuối.
                n_steps = spec_used["steps"]
                out = pipe(
                    image=img, prompt=job["prompt"], negative_prompt=negative,
                    num_frames=n_frames, guidance_scale=spec_used["guidance"],
                    num_inference_steps=n_steps, generator=gen,
                    callback_on_step_end=step_reporter(job["id"], n_steps),
                ).frames[0]
            else:
                steps = {"timesteps": spec_used["timesteps"]} if spec_used.get("timesteps") else {"num_inference_steps": spec_used["steps"]}
                out = pipe(
                    conditions=[LTXVideoCondition(image=img, frame_index=0), LTXVideoCondition(image=img, frame_index=n_frames - 1, strength=end)] if end > 0 else [LTXVideoCondition(image=img, frame_index=0)],
                    prompt=job["prompt"],
                    negative_prompt=negative,
                    width=w,
                    height=h,
                    num_frames=n_frames,
                    guidance_scale=spec_used["guidance"],
                    guidance_rescale=0.7,
                    decode_timestep=0.05,
                    decode_noise_scale=0.025,
                    image_cond_noise_scale=0.0,
                    generator=gen,
                    callback_on_step_end=step_reporter(job["id"], len(spec_used["timesteps"]) if spec_used.get("timesteps") else spec_used["steps"]),
                    **steps,
                ).frames[0]
            peak_gib = torch.cuda.max_memory_allocated() / 2**30
            log(f"MTS_VRAM id={job['id']} peak={peak_gib:.2f}GiB")
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
        post_progress(stage="done" if ok else "error", clip=job["id"], seconds=round(sec, 1), vram=round(peak_gib, 2))

    json.dump({"model": spec_name(spec_used), "gpu": torch.cuda.get_device_name(0), "total_seconds": round(time.time() - T0, 1), "clips": results}, open(os.path.join(OUT, "results.json"), "w"))
    log(f"xong {sum(r['ok'] for r in results)}/{len(results)} clip, tổng {time.time() - T0:.0f}s")
    # Dọn cache model khỏi /kaggle/working để output chỉ có clip.
    shutil.rmtree(os.path.join(OUT, ".cache"), ignore_errors=True)


if __name__ == "__main__":
    main()
