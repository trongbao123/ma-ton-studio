# HANDOFF — 2026-11-11 22:30 (i2v "làm như phim" + tiếng hiệu ứng + màn kết)

Resume: `git pull && git checkout wip/film-mode`. Nhánh này đi trước `main`; `main` đã có hết phần i2v.

## Đã xong trên `wip/film-mode`

### Tiếng hiệu ứng cho clip động — xong, đã đo (`2885923`)
- `pipeline/sfx.ts` nối vào `buildStillVideo` → `episodeMuxArgs` (input thứ 4 `[3:a]`, amix 3 nguồn, **không** sidechain theo giọng).
- Chỉ cảnh có clip THẬT (`file` đã tải về) mới kêu; mốc ở giữa lúc mờ chéo vào clip; bỏ mốc vượt độ dài chương.
- Seed `anoisesrc` cố định theo (loại, thứ tự) → dựng lại ra đúng file cũ, mà 2 tiếng cùng loại vẫn khác nhau.
- `SFX_TRIM_DB` cân độ to cảm nhận: đo LUFS từng tiếng rồi bù về mốc thiết kế. **Trước khi cân, "nổ" là tiếng NHỎ NHẤT** (-29,8 LUFS, dưới sấm 7 dB) — đúng thứ user muốn nghe thì không nghe thấy.
- `SFX_GAIN = 1` (still.ts): đo được **từ 1,5 trở lên đỉnh thật của cả tập vượt 0 dBFS** dù đã có `alimiter=0.9` (hard limit sinh đỉnh giữa hai mẫu). Đừng nâng quá 1.
- Đo lại khi sửa mức: `pnpm exec tsx scripts/sfx-measure.mjs --mix` (cần ffmpeg trong PATH).

### Màn kết kêu gọi thích/chia sẻ/đăng ký — xong, đã xem hình
- `pipeline/outro.ts` (thuần) + `makeOutro` trong `episode.ts` + ghép ở `compile.ts` (sau khối cold open).
- Nền = khung hình 3 giây trước khi hết video (không vẽ ảnh mới → không tốn quota, nhìn liền mạch), phóng chậm 6%, phủ đen 0,45.
- Chữ căn trái, **chừa hẳn cột phải** cho thẻ End Screen thật — toạ độ ở `OUTRO_CARD_SLOTS` (1300,250 và 1300,580 · 480×270).
- **Thẻ bấm được KHÔNG đặt được qua API** — YouTube Data API không có End Screen, phải làm tay trong Studio. Màn kết này chỉ in hình.
- Đã kiểm thật: 15,00s, chữ ký luồng **trùng khít** chương tĩnh nên `concatLongs` ghép `-c copy`, tập 12s + 15s = 27,02s.
- Mục lục không đổi (không thêm mốc, chỉ chương cuối dài thêm 15 giây).

### Bộ dò "nhân vật không di chuyển" — xong phần đo, CHỜ GPU
- **Phát hiện**: production đang vừa xin hành động vừa cấm — prompt `motionPrompts` ghi "no walking, fighting, swinging weapons" và `MOTION_NEGATIVE` có `changing pose`. Nhân vật đứng im là đúng như đã ra lệnh, chưa chắc tại model yếu.
- `pipeline/i2v-sweep.ts` + CLI: **6 ô trong MỘT lượt Kaggle** (2 kiểu prompt × 3 mức khóa khung cuối 0 / 0,3 / 0,5), rồi in bảng YDIF (động tới đâu) + SSIM khung cuối so ảnh gốc (trôi tới đâu).
- `MOTION_NEGATIVE` chuyển về `i2v-plan.ts` và gửi kèm manifest; `run.py` nhận ghi đè **từng clip** (`endStrength` / `frames` / `negative`).
- Phần đo đã kiểm tại máy: clip tĩnh YDIF 0.000, clip động 3.050; SSIM giống nhau = 1, khác = 0.714.

## Việc còn lại

1. **Chạy sweep rồi chọn mặc định** (cần token Kaggle — máy PC hiện tại `.env.local` chỉ có `VERCEL_OIDC_TOKEN`):
   ```
   set -a; . ./.env.local; set +a
   pnpm exec tsx pipeline/render.ts i2v-sweep /tmp/i2v-in     # cần long-img-1*.jpg trong thư mục
   ```
   Ô nào **vừa YDIF cao vừa SSIM cao** thì lấy: sửa `CLIP_END_STRENGTH` (i2v-plan.ts) + lời prompt trong `motionPrompts` (i2v.ts) theo `SWEEP_STYLES` thắng cuộc. Mốc so sánh: hiện tại (effects + khóa 0,5) YDIF ≈ 2,5–3,0.
   Nếu cả 6 ô đều méo mặt khi cho hành động → mới tính tới model lớn hơn (LTX 13B distilled fp8 / Wan 2.1 1.3B), đo VRAM + thời gian trước.
2. **Nhân vật nói như phim (lời thoại + khớp môi)** — Large, chưa đụng.
   - Giọng: Gemini TTS multi-speaker (`pipeline/tts.ts`), quota model tốt nhất 10 lượt/ngày → dễ cạn.
   - Khớp môi: spike 1 cảnh trên Kaggle T4 (LatentSync 1.5 ~ vừa 16GB?; Wav2Lip mờ). Cảnh 2 nhân vật cần biết ai nói. Chỉ đưa vào pipeline nếu đẹp.
3. **Nghe thử tiếng hiệu ứng bằng tai** — tôi mới cân bằng số đo (LUFS/đỉnh), chưa ai nghe. File mẫu: `pnpm exec tsx scripts/sfx-measure.mjs --mix` rồi mở `.cache/sfx-measure/mix-gain-1.wav`.
4. **Đặt thẻ End Screen trong Studio** cho tập đầu tiên có màn kết, theo toạ độ `OUTRO_CARD_SLOTS`.

## Vận hành
- **Lượt daily 20:17 ngày 11/11 KHÔNG chạy** — tới 20:51 vẫn chưa thấy trên Actions (lượt cuối là `render` 19:23). Cả 2 runner tự host (`win-1`, `win-2`) đang offline nhưng `RUNNER_LABEL` không đặt nên lẽ ra chạy `ubuntu-latest`. Cần xem còn phút Actions của repo private không (`gh` hiện thiếu scope `user` để đọc billing).
- Lượt daily 11/11 14:47 bị cancel ở mốc 240 phút do render bù 8 chương + 2 tập — tự lành (requeueStuck + short-backfill).
- Chạy test Kaggle: `pnpm exec tsx pipeline/render.ts kaggle-test /tmp/i2v-in`.
- Giấy phép tiếng: KHÔNG dùng MMAudio/AudioLDM2 (CC-BY-NC). `sfx.ts` tự sinh bằng lavfi nên không vướng. Nâng cấp sau: Stable Audio Open (community license, cần HF token gated).
