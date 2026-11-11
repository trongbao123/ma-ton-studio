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

### "Nhân vật không di chuyển" — ĐÃ ĐO TRÊN KAGGLE, chốt khóa 0,3

Chạy `i2v-sweep` thật (T4, LTX 2B distilled, ảnh `long-img-1.jpg` của video-26 — cận mặt + hào quang tím, ca khó nhất). Kernel: `mts-i2v-run-0-mwca1mcs`, 6 ô ~40–58s GPU mỗi ô, tổng ~17 phút kể cả xếp hàng.

| # | kiểu | khóa cuối | YDIF | SSIM | đọc ra gì |
|---|---|---|---|---|---|
| 0 | effects | 0 | 7,60 | 0,599 | **trôi, không dùng được** |
| 1 | effects | **0,3** | **2,75** | **0,802** | **← đã chốt làm mặc định** |
| 2 | effects | 0,5 | 2,01 | 0,816 | mặc định cũ |
| 3 | action | 0 | 9,35 | 0,566 | trôi nặng nhất |
| 4 | action | 0,3 | 2,06 | 0,822 | kém ô 1 |
| 5 | action | 0,5 | 1,55 | 0,832 | ít động nhất |

**Hai kết luận, cả hai đều ngược với giả thiết ban đầu:**

1. **YDIF cao ở khóa 0 là đo sự TRÔI, không phải diễn xuất.** Nhìn khung giữa clip (t=2s/4s): model đã bỏ cảnh — mất hào quang tím, mất mắt phát sáng, mất vương miện, trời nắng nhạt, nhân vật ngồi dậy thành cảnh khác. Đừng tin YDIF một mình, luôn phải xem khung hình.
2. **Giả thiết "`changing pose` trong negative trói tay model" là SAI.** Bỏ từ đó ra làm chuyển động *giảm* (2,06 vs 2,75 ở cùng khóa 0,3) và trôi mạnh hơn ở khóa 0. Với LTX 2B, prompt không phải nút thắt — cái neo khung cuối là thứ giữ bức tranh lại, và model đánh đổi "nhân vật cử động" bằng "đổi luôn cả cảnh".

**Đã áp dụng**: `CLIP_END_STRENGTH` 0,5 → **0,3** (+37% chuyển động, SSIM gần như không đổi). Giữ nguyên prompt kiểu `effects`.

**Nước đi tiếp theo nếu vẫn muốn nhân vật diễn**: phải đổi MODEL, không phải sửa prompt. Thử LTX 13B distilled fp8 hoặc Wan 2.1 1.3B i2v — đo VRAM + thời gian trên T4 trước, rồi chạy lại `i2v-sweep` (ô `action` giữ nguyên trong code để đo lại với model mới).

### Bộ dò (công cụ) — dùng lại được
- **Phát hiện**: production đang vừa xin hành động vừa cấm — prompt `motionPrompts` ghi "no walking, fighting, swinging weapons" và `MOTION_NEGATIVE` có `changing pose`. Nhân vật đứng im là đúng như đã ra lệnh, chưa chắc tại model yếu.
- `pipeline/i2v-sweep.ts` + CLI: **6 ô trong MỘT lượt Kaggle** (2 kiểu prompt × 3 mức khóa khung cuối 0 / 0,3 / 0,5), rồi in bảng YDIF (động tới đâu) + SSIM khung cuối so ảnh gốc (trôi tới đâu).
- `MOTION_NEGATIVE` chuyển về `i2v-plan.ts` và gửi kèm manifest; `run.py` nhận ghi đè **từng clip** (`endStrength` / `frames` / `negative`).
- Phần đo đã kiểm tại máy: clip tĩnh YDIF 0.000, clip động 3.050; SSIM giống nhau = 1, khác = 0.714.

## Việc còn lại

1. **Thử model lớn hơn cho chuyển động nhân vật** (xem phần đã đo ở trên — prompt đã hết đường, phải đổi model).
   Chạy lại bộ dò sau khi đổi model:
   ```
   set -a; . ./.env.local; set +a
   pnpm exec tsx pipeline/render.ts i2v-sweep C:/Users/admin/i2v-in
   gh release download video-26 -p 'long-img-1.jpg' -D C:/Users/admin/i2v-in   # lấy ảnh thử
   ```
   **Luôn mở clip ra xem**, đừng chỉ đọc bảng số: YDIF cao có thể là trôi (đã dính một lần).
2. **Nhân vật nói như phim (lời thoại + khớp môi)** — Large, chưa đụng.
   - Giọng: Gemini TTS multi-speaker (`pipeline/tts.ts`), quota model tốt nhất 10 lượt/ngày → dễ cạn.
   - Khớp môi: spike 1 cảnh trên Kaggle T4 (LatentSync 1.5 ~ vừa 16GB?; Wav2Lip mờ). Cảnh 2 nhân vật cần biết ai nói. Chỉ đưa vào pipeline nếu đẹp.
3. **Nghe thử tiếng hiệu ứng bằng tai** — tôi mới cân bằng số đo (LUFS/đỉnh), chưa ai nghe. File mẫu: `pnpm exec tsx scripts/sfx-measure.mjs --mix` rồi mở `.cache/sfx-measure/mix-gain-1.wav`.
4. **Đặt thẻ End Screen trong Studio** cho tập đầu tiên có màn kết, theo toạ độ `OUTRO_CARD_SLOTS`.

## LỊCH DAILY BỊ GITHUB ĐẨY LÙI 2–12 TIẾNG (đã đo, 14 lượt gần nhất)

**KHÔNG phải hết phút** — tháng 11 dùng 1455/2000 phút, không tốn tiền (`gh api users/<user>/settings/billing/usage`;
endpoint `billing/actions` cũ đã bị gỡ, trả 410).

Cron `17 1,13 * * *` nhưng lượt chạy THẬT lệch rất xa:

| cron danh nghĩa | chạy thật | trễ |
|---|---|---|
| 11/11 01:17Z | 07:47Z | 6,5 giờ |
| 10/11 13:17Z | 20:29Z | 7,2 giờ |
| 10/11 01:17Z | 03:33Z | 2,3 giờ |
| 09/11 13:17Z | 19:47Z | 6,5 giờ |
| 08/11 01:17Z | 10:18Z | 9,0 giờ |
| 07/11 13:17Z | 00:34Z (hôm sau) | 11,3 giờ |
| 07/11 01:17Z | 12:57Z | 11,7 giờ |

Trung vị ~6,5 giờ. Đây là hành vi đã biết của GitHub với `schedule` (hàng đợi ưu tiên thấp), không sửa được từ phía repo.

**Hệ quả**: ghi chú trong `daily.yml` nói "lượt 8h17 viết + render + dựng tập kịp lịch đăng 15h" là **SAI thực tế** —
với trễ 6,5 giờ thì nó khởi động lúc ~14h47 VN, và lúc trễ 9–11 giờ thì chạy SAU cả giờ đăng. Đó là lý do chương dồn lại,
rồi lượt sau phải render bù 8 chương + 2 tập và đụng trần `timeout-minutes: 240` (10/11 mất 389 phút, 11/11 mất 240 phút — huỷ, mất trắng việc).

**Cách sửa thật**: `workflow_dispatch` qua API chạy NGAY, không bị đẩy lùi. Dùng một bộ hẹn giờ ngoài (Vercel Cron của chính app,
hoặc cron-job.org) gọi `POST /repos/<owner>/<repo>/actions/workflows/daily.yml/dispatches`. Đổi giờ cron không giải quyết được
vì độ trễ dao động 2–12 giờ, không đoán nổi.

## Vận hành
- **Lượt daily 20:17 ngày 11/11 KHÔNG chạy** — tới 20:51 vẫn chưa thấy trên Actions (lượt cuối là `render` 19:23). Cả 2 runner tự host (`win-1`, `win-2`) đang offline nhưng `RUNNER_LABEL` không đặt nên lẽ ra chạy `ubuntu-latest`. Cần xem còn phút Actions của repo private không (`gh` hiện thiếu scope `user` để đọc billing).
- Lượt daily 11/11 14:47 bị cancel ở mốc 240 phút do render bù 8 chương + 2 tập — tự lành (requeueStuck + short-backfill).
- Chạy test Kaggle: `pnpm exec tsx pipeline/render.ts kaggle-test /tmp/i2v-in`.
- Giấy phép tiếng: KHÔNG dùng MMAudio/AudioLDM2 (CC-BY-NC). `sfx.ts` tự sinh bằng lavfi nên không vướng. Nâng cấp sau: Stable Audio Open (community license, cần HF token gated).
