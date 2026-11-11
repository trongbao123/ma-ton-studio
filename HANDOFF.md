# HANDOFF — 2026-11-11 20:20 (i2v "làm như phim")

Resume: `git pull && git checkout wip/film-mode` (main đã có hết phần i2v; branch WIP chỉ thêm `pipeline/sfx.ts` + file này).

## Đã xong, đã lên `main` (Actions dùng từ run daily 20:17 ngày 11/11)
- `efb4f61` → `6443ee2`: i2v Kaggle LTX-Video 0.9.8 2B distilled, T4.
  - `kaggle/i2v/run.py`: `LTXConditionPipeline`, khung 0 khóa ảnh gốc strength 1.0, khung cuối khóa nhẹ `endStrength` 0.5 (manifest), timesteps distilled, guidance_rescale 0.7, negative chống biến dạng + "static, frozen".
  - `pipeline/i2v-plan.ts`: `CLIP_FRAMES=97` (4s), `CLIP_END_STRENGTH=0.5`; `clipSegmentArgs` = ảnh tĩnh → xfade 1s → clip ở CUỐI đoạn cảnh; ảnh tĩnh cắt đúng khung clip (hết xê dịch).
  - `pipeline/i2v.ts`: AI viết prompt hiệu ứng mạnh (aura bùng, sét, sóng khí, gió quật), cấm hành động thân thể/camera.
- Đo (test Kaggle 2 ảnh trong /tmp/i2v-in trên Mac): GPU ~58s + 41s/clip, ~6 phút/lượt gồm nạp model. YDIF trung bình: khóa cứng 2 đầu 0.10 (đứng yên) → hiện tại 2.5–3.0, mặt giữ.
- Lịch sử thử: khóa 1 đầu (ImageToVideoPipeline) → mặt biến dạng sau ~1s; khóa cứng 2 đầu → đứng yên.

## User phản hồi CHƯA xử lý (ưu tiên theo thứ tự)
1. **"Nhân vật không di chuyển gì" / "làm như phim"** — hiện chỉ có hiệu ứng quanh nhân vật, thân người đứng im (prompt đang cấm hành động vì LTX 2B làm méo mặt khi nhân vật cử động).
   Hướng thử: cho phép hành động nhỏ có trong cảnh (quay đầu, giơ tay, bước 1 bước, vung kiếm) + giảm endStrength 0.3 hoặc bỏ khóa cuối nhưng clip ngắn; thử model lớn hơn nếu T4 chịu (LTX 13B distilled fp8? Wan 2.1 1.3B i2v?) — đo VRAM/thời gian trước. Có thể camera move nhẹ.
2. **Âm thanh hiệu ứng** ("ầm ầm") — `pipeline/sfx.ts` (WIP, chưa test, chưa nối). Việc còn:
   - unit test `sfxKinds/sfxEvents`; nghe thử `sfxTrackArgs` local, cân biên độ.
   - `I2vRun`: thêm getter trả `this.clips` ({scene, motion}).
   - `render.ts` buildStillVideo: sau `i2v.collect()` dựng `sfx.wav` bằng `sfxTrackArgs(sfxEvents(...), narration.seconds, ...)`.
   - `still.ts` episodeAudioGraph/episodeMuxArgs: input thứ 4 tùy chọn `[3:a]` volume ~0.5, amix 3 inputs (không sidechain).
   - Giấy phép: KHÔNG dùng MMAudio/AudioLDM2 (CC-BY-NC). Nâng cấp sau: Stable Audio Open (community license, cần HF token gated).
3. **Nhân vật nói như phim (lời thoại giọng riêng + khớp môi)** — Large.
   - Giọng: Gemini TTS multi-speaker (`pipeline/tts.ts`), quota model tốt nhất 10 lượt/ngày → dễ cạn.
   - Khớp môi: spike 1 cảnh trên Kaggle T4 (LatentSync 1.5 ~ vừa 16GB?; Wav2Lip mờ). Cảnh 2 nhân vật cần biết ai nói. Chỉ đưa vào pipeline nếu đẹp.

## Vận hành
- Chạy test Kaggle local: `set -a; . ./.env.local; set +a; pnpm exec tsx pipeline/render.ts kaggle-test /tmp/i2v-in` (cần thư mục ảnh long-img-*.jpg; trên PC mới phải tự tạo).
- Run daily 11/11 14:47 bị cancel ở mốc 240 phút do render bù 8 chương + 2 tập — tự lành (requeueStuck + short-backfill).
- Cần kiểm run daily 20:17 ngày 11/11: lần đầu i2v chạy trong pipeline thật (thẻ Clip động trong UI flow, `/usage` hạn mức Kaggle).
