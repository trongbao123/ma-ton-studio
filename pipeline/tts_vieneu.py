"""Tiến trình đọc giọng VieNeu-TTS (pipeline/tts-vieneu.ts gọi). Nạp model 1 lần rồi nhận việc qua stdin.

Mỗi dòng vào: {"text": "...", "out": "/đường/dẫn.wav", "voice": "Đức Trí"}
Mỗi dòng ra:  {"ok": true} hoặc {"ok": false, "error": "..."}
Dòng đầu tiên in ra khi model sẵn sàng: {"ready": true, "voices": [...]}
"""
import json
import os
import sys


def main() -> None:
    try:
        from vieneu import Vieneu

        device = os.environ.get("VIENEU_DEVICE", "auto")
        threads = int(os.environ.get("VIENEU_THREADS", "0"))
        tts = Vieneu(device=device, threads=threads) if device == "cpu" else Vieneu(device=device)
        presets = list(tts.list_preset_voices())
    except Exception as e:  # noqa: BLE001 — báo lỗi nạp model cho phía Node để quay về ivoi/Gemini
        print(json.dumps({"ready": False, "error": f"{type(e).__name__}: {e}"}), flush=True)
        return
    print(json.dumps({"ready": True, "voices": [label for label, _ in presets]}, ensure_ascii=False), flush=True)

    def voice_id(name: str):
        # Nhãn có dạng "⭐ Đức Trí — Nam · Nam · Phong cách đọc truyện" → khớp theo tên.
        for label, vid in presets:
            if label.replace("⭐", "").strip().split(" — ")[0] == name:
                return vid
        raise ValueError(f"không có giọng '{name}'")

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            job = json.loads(line)
            tmp = job["out"] + ".tmp.wav"
            tts.save(tts.infer(job["text"], voice=voice_id(job["voice"])), tmp)
            os.replace(tmp, job["out"])
            print(json.dumps({"ok": True}), flush=True)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
