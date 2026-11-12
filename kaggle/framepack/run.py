"""Kernel Kaggle THỬ NGHIỆM: FramePack F1 (HunyuanVideo 13B) image-to-video trên T4 — đo xem nhân vật có diễn mượt không và mất bao lâu.

Bộ nhớ: Kaggle ~30 GB RAM + T4 15 GB. Transformer 13B bf16 = 26 GB, Llama 8B = 16 GB → nén 4-bit (bitsandbytes) cả hai,
mã hoá prompt xong thì xoá text encoder rồi mới chạy transformer. Tính bf16 (fp16 trên T4 dễ tràn → đen).
Đầu vào: dataset có manifest.json {width,height,frames,steps,fps,clips:[{id,image,prompt}]} + ảnh. Đầu ra: clip-<id>.mp4, results.json.
"""
import gc
import glob
import json
import os
import shutil
import subprocess
import sys
import time

OUT = "/kaggle/working"
T0 = time.time()
os.environ.setdefault("HF_HOME", "/tmp/hf")


def log(msg):
    print(f"[{time.time() - T0:7.1f}s] {msg}", flush=True)


def gpu_mem():
    import torch

    return f"VRAM {torch.cuda.memory_allocated() / 2**30:.1f}/{torch.cuda.max_memory_allocated() / 2**30:.1f} GiB"


def main():
    found = glob.glob("/kaggle/input/**/manifest.json", recursive=True)
    if not found:
        print("MTS_NO_MANIFEST", flush=True)
        sys.exit(4)
    root = os.path.dirname(found[0])
    m = json.load(open(found[0]))
    log(f"đĩa trống /tmp: {shutil.disk_usage('/tmp').free / 2**30:.0f} GiB")
    try:
        import bitsandbytes  # noqa: F401
    except Exception:  # noqa: BLE001
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "bitsandbytes"], check=False)
    import torch
    from diffusers import BitsAndBytesConfig as DiffBnb
    from diffusers import HunyuanVideoFramepackPipeline, HunyuanVideoFramepackTransformer3DModel
    from diffusers.utils import export_to_video
    from PIL import Image
    from transformers import BitsAndBytesConfig as TfBnb
    from transformers import LlamaModel, SiglipImageProcessor, SiglipVisionModel

    if not torch.cuda.is_available():
        print("MTS_NO_GPU", flush=True)
        sys.exit(3)
    # T4 (sm75): SDPA mem-efficient chỉ có cho fp16 → bf16 phải lập cả ma trận attention (5–12 GiB, OOM). fp16 thì bộ nhớ tuyến tính,
    # đổi lại có thể tràn số → kiểm tra khung NaN/đen sau khi sinh.
    bf = torch.float16 if m.get("dtype", "fp16") == "fp16" else torch.bfloat16
    q = dict(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=bf)
    # Bước 1: chỉ text encoder (Llama 4-bit) + CLIP → mã hoá mọi prompt → xoá khỏi GPU.
    t = time.time()
    text_encoder = LlamaModel.from_pretrained(
        "hunyuanvideo-community/HunyuanVideo", subfolder="text_encoder", torch_dtype=torch.float16, quantization_config=TfBnb(**q)
    )
    fe = SiglipImageProcessor.from_pretrained("lllyasviel/flux_redux_bfl", subfolder="feature_extractor")
    ie = SiglipVisionModel.from_pretrained("lllyasviel/flux_redux_bfl", subfolder="image_encoder", torch_dtype=torch.float16)
    pipe = HunyuanVideoFramepackPipeline.from_pretrained(
        "hunyuanvideo-community/HunyuanVideo", transformer=None, text_encoder=text_encoder,
        feature_extractor=fe, image_encoder=ie, torch_dtype=torch.float16,
    )
    pipe.text_encoder_2.to("cuda")
    log(f"text encoder xong {time.time() - t:.0f}s, {gpu_mem()}")
    embeds = {}
    with torch.no_grad():
        for job in m["clips"]:
            pe, ppe, pam = pipe.encode_prompt(prompt=job["prompt"], prompt_2=job["prompt"], device="cuda")[:3]
            embeds[job["id"]] = (pe, ppe, pam)
    pipe.text_encoder = None
    pipe.text_encoder_2.to("cpu")
    del text_encoder
    gc.collect()
    torch.cuda.empty_cache()
    log(f"đã mã hoá prompt + bỏ text encoder, {gpu_mem()}")

    # Bước 2: transformer 4-bit + VAE + SigLIP.
    t = time.time()
    pipe.transformer = HunyuanVideoFramepackTransformer3DModel.from_pretrained(
        "lllyasviel/FramePack_F1_I2V_HY_20250503", torch_dtype=bf, quantization_config=DiffBnb(**q)
    )
    pipe.image_encoder.to("cuda")
    pipe.vae.to("cuda")
    pipe.vae.enable_tiling()
    log(f"transformer 4-bit ({bf}) xong {time.time() - t:.0f}s, {gpu_mem()}")

    results = []
    for job in m["clips"]:
        t = time.time()
        ok = False
        try:
            img = Image.open(os.path.join(root, job["image"])).convert("RGB").resize((m["width"], m["height"]), Image.LANCZOS)
            pe, ppe, pam = embeds[job["id"]]
            frames = pipe(
                image=img, prompt_embeds=pe, pooled_prompt_embeds=ppe, prompt_attention_mask=pam,
                height=m["height"], width=m["width"], num_frames=m["frames"], num_inference_steps=m["steps"],
                guidance_scale=9.0, generator=torch.Generator().manual_seed(42 + job["id"]), sampling_type="vanilla",
            ).frames[0]
            import numpy as np

            arr = np.asarray(frames[len(frames) // 2], dtype="float32")
            if not np.isfinite(arr).all() or arr.std() < 3:
                log(f"clip {job['id']}: khung hỏng (NaN/đen) — fp16 tràn số")
            else:
                export_to_video(frames, os.path.join(OUT, f"clip-{job['id']}.mp4"), fps=m["fps"])
                ok = True
        except Exception as e:  # noqa: BLE001
            log(f"clip {job['id']} lỗi: {type(e).__name__}: {str(e)[:400]}")
        gc.collect()
        torch.cuda.empty_cache()
        sec = time.time() - t
        results.append({"id": job["id"], "ok": ok, "seconds": round(sec, 1)})
        print(f"MTS_CLIP id={job['id']} ok={int(ok)} sec={sec:.1f} {gpu_mem()}", flush=True)
    json.dump({"model": "FramePack F1 nf4", "gpu": torch.cuda.get_device_name(0), "total_seconds": round(time.time() - T0, 1), "clips": results}, open(os.path.join(OUT, "results.json"), "w"))
    log("xong")


if __name__ == "__main__":
    main()
