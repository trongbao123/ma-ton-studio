"""Kernel Kaggle: vẽ ảnh cảnh bằng Z-Image-Turbo (Tongyi-MAI, Apache 2.0) trên GPU free — AI vẽ phụ đỡ lượt GPT.

Đầu vào : dataset có manifest.json {width,height,steps,seed,images:[{id,prompt}]}.
Đầu ra  : /kaggle/working/img-<id>.png + results.json. Log mỗi ảnh: `MTS_IMG id=<id> ok=<0|1> sec=<giây>`.
"""
import json
import glob
import os
import subprocess
import sys
import time

OUT = "/kaggle/working"
T0 = time.time()
REPO = "Tongyi-MAI/Z-Image-Turbo"


def log(msg):
    print(f"[{time.time() - T0:7.1f}s] {msg}", flush=True)


def die(code, msg, exit_code):
    print(f"{code} {msg}", flush=True)
    sys.exit(exit_code)


def main():
    found = glob.glob("/kaggle/input/**/manifest.json", recursive=True)
    if not found:
        die("MTS_NO_MANIFEST", "không thấy manifest.json", 4)
    root = os.path.dirname(found[0])
    manifest = json.load(open(found[0]))
    import torch

    if not torch.cuda.is_available():
        die("MTS_NO_GPU", "không có GPU", 3)
    try:
        from diffusers import ZImagePipeline  # noqa: F401
    except Exception:  # noqa: BLE001
        log("cài diffusers mới (cần ZImagePipeline)")
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "git+https://github.com/huggingface/diffusers"], check=False)
    from diffusers import ZImagePipeline

    import gc

    import numpy as np

    def load(mode):
        # T4 không có bf16 phần cứng. "fp16-vae32": transformer/text encoder fp16 (nhanh), VAE fp32 (fp16 tràn → ảnh đen).
        # "bf16": dự phòng khi transformer fp16 cũng tràn. Cả hai giải mã VAE theo ô để không OOM.
        dtype = torch.bfloat16 if mode == "bf16" else torch.float16
        p = ZImagePipeline.from_pretrained(REPO, torch_dtype=dtype)
        if mode == "fp16-vae32":
            p.vae.to(torch.float32)
        p.vae.enable_tiling()
        p.vae.enable_slicing()
        p.enable_model_cpu_offload()
        return p

    def draw(p, job):
        img = p(
            prompt=job["prompt"],
            width=manifest["width"],
            height=manifest["height"],
            num_inference_steps=manifest.get("steps", 9),
            guidance_scale=0.0,
            generator=torch.Generator("cuda").manual_seed(manifest.get("seed", 42) + job["id"]),
        ).images[0]
        arr = np.asarray(img, dtype="float32")
        return img if np.isfinite(arr).all() and arr.std() > 5 else None

    modes = [manifest["mode"]] if manifest.get("mode") else ["fp16-vae32", "bf16"]
    results, mode, pipe = [], None, None
    for job in manifest["images"]:
        t = time.time()
        ok = False
        while True:
            if pipe is None:
                if not modes:
                    break
                mode = modes.pop(0)
                t1 = time.time()
                pipe = load(mode)
                log(f"nạp {REPO} ({mode}) sau {time.time() - t1:.0f}s, GPU {torch.cuda.get_device_name(0)}")
            try:
                img = draw(pipe, job)
            except Exception as e:  # noqa: BLE001
                log(f"ảnh {job['id']} lỗi ({mode}): {type(e).__name__}: {str(e)[:200]}")
                img = None
            gc.collect()
            torch.cuda.empty_cache()
            if img is not None:
                img.save(os.path.join(OUT, f"img-{job['id']}.png"))
                ok = True
                break
            log(f"ảnh {job['id']} hỏng ở {mode}")
            # Chưa có ảnh nào đạt ở mode này → bỏ mode, nạp mode kế; đã từng đạt thì chỉ bỏ ảnh này.
            if any(r["ok"] for r in results):
                break
            del pipe
            pipe = None
            gc.collect()
            torch.cuda.empty_cache()
        sec = time.time() - t
        results.append({"id": job["id"], "ok": ok, "seconds": round(sec, 1)})
        print(f"MTS_IMG id={job['id']} ok={int(ok)} sec={sec:.1f} mode={mode}", flush=True)
    json.dump({"model": "Z-Image-Turbo", "mode": mode, "gpu": torch.cuda.get_device_name(0), "total_seconds": round(time.time() - T0, 1), "images": results}, open(os.path.join(OUT, "results.json"), "w"))
    log(f"xong {sum(r['ok'] for r in results)}/{len(results)} ảnh")


if __name__ == "__main__":
    main()
