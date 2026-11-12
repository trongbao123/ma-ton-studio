# HANDOFF — 2026-11-12 tối (Mac → máy khác)

Resume: `git pull` trên `main` — mọi thứ đã push, không có branch dở.

## Hôm nay đã lên `main` (Actions chạy code từ main)
| Việc | Commit | Ghi chú |
|---|---|---|
| Bỏ FLUX, ảnh chỉ GPT (codex gói Plus) | 7f4b68e | `IMAGE_ALLOW_FLUX=1` để bật lại |
| Z-Image (Kaggle) vẽ phụ — TẮT mặc định | 9f1797b, 27676b7 | `ZIMAGE=1` bật; T4 bf16 1024×576 ~150s/ảnh; GPU để dành cho clip |
| 20–24 clip/chương; chương mở tập 40–44 | 9b0c858, 92ff18a | |
| Mở đầu tập: clip mọi cảnh + chữ HOOK + boom giây 0 | fdea9a5 | `coldOpenClips` trong episode.ts |
| Vùng giữ chân 30 phút đầu tập (chương mở tập ~10s/ảnh zoom) | 06b14ce, 92ff18a | `HOOK_ZONE_SECONDS`, `isEpisodeOpener` |
| Ảnh bị OpenAI chặn kiểm duyệt 2 lần → cảnh nền an toàn | c993964 | chương 18 từng lỗi vì việc này |
| SFX hết "xèo xèo" (bỏ nhiễu dải cao, boom sine trượt) | 704bc38 | đo: `scripts/sfx-measure.mjs` |
| Phụ đề/cắt cảnh khớp giọng (silencedetect) | ac247c0 | chương 19: ranh giới câu đúng khoảng lặng 10/33 → 27/33 |
| Học kênh top: giọng ×1,2, phụ đề đốt cứng suốt chương, cắt thẳng | 296adf3 | `NARRATION_TEMPO`, `SEGMENT_SUBS=0` tắt phụ đề |
| Góc máy ảo ~4s/shot, đẩy máy chậm | 963c875 | 14,4 cắt/phút (top 13–15); `SHOT_CUTS=0` tắt |
| Prompt truyện "viết cho tai nghe" + dàn ý ghi chương mở tập | 6da2bff | chương đã có dàn ý vẫn theo dàn ý cũ |
| Giữ mặt nam chính: ngoại hình + ảnh mẫu cố định cả bộ (codex `-i`) | 95004d7 + commit cuối | `hero.ts`, key `hero_ref_<seriesId>` trong app_settings; áp cả mở đầu tập, Short, thumbnail |
| Web: perf trang chi tiết + cache hạn mức; Z-Image nguồn free riêng | 01cbb39, 39347c3 | Vercel đã có KAGGLE_* |

## Nghiên cứu kênh top (10 video)
Đối thủ gần nhất: **Não Phẳng Tu Tiên** (ảnh AI 3D donghua, 505–650k view): 13–15 cắt/phút, phụ đề đốt cứng 1 vế câu, 240–290 âm tiết/phút, cắt thẳng, mở in medias res ngôi thứ nhất, thumbnail poster (thư pháp + ruy băng "Phần x-y").
CHƯA làm: kể ngôi thứ nhất "ta" (cần user quyết), thumbnail poster, tiêu đề 80–100 ký tự có "Phần".

## Cần kiểm ở lượt render tới (chương 18 = video #32 đang queued; chương 22 chưa đọc giọng)
- Ảnh mẫu nam chính tạo lần đầu trên Actions (máy local KHÔNG giải mã được CODEX_AUTH_JSON — SECRETS_KEY sai) → log "ảnh mẫu" + app_settings `hero_ref_4` phải có `jpg`.
- Video phải có: phụ đề suốt chương, ~14 cắt/phút, 0 khoảng đen, giọng ~230 âm tiết/phút, nam chính 1 mặt.
- Đo nhanh: `gh release download video-<id> -p long.mp4`, ffmpeg `select='gt(scene,0.3)'` + `blackdetect`.

## Xem trước trên máy (không GPU, không tốn lượt GPT)
`FFMPEG=<ffmpeg có drawtext+libass> pnpm exec tsx scripts/preview.mts 19 4 2600 <thư mục ảnh GPT> chapter`
ffmpeg Homebrew 9.x thiếu drawtext/ass → dùng bản static có libass. Ảnh GPT thật: `gh release download video-26 -p "long-img-1?.jpg"`.

## Giới hạn đã đo (đừng thử lại)
- Kaggle T4 (sm75): tối đa 2 kernel GPU cùng lúc. Ngõ cụt: FramePack (branch `spike/framepack`), CogVideoX, Z-Image fp16 (đen). Nhân vật "diễn" thật cần GPU trả phí/API video — user chọn giữ free.
- Free image API: Gemini ảnh limit 0; Cloudflare model đẹp tốn neuron; Pollinations ~2 USD/tháng.
- Gemini TTS 10 lượt/ngày (hết thì video chờ hôm sau).

## Quyết định của user
- Giữ định dạng tập dài, free; 30 phút đầu tập phải cuốn.
- KHÔNG dùng tài khoản Codex Pro trên máy cá nhân cho pipeline.
- KHÔNG ghép cốt truyện 3 bộ hit (bản quyền) — chỉ học khung thể loại (HIT_FORMULA).

---

# Lịch sử (handoff 2026-11-11, giữ để tra)

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

**Đã làm**: Vercel Cron gọi `/api/cron/daily` → dispatch sang GitHub (`workflow_dispatch` chạy NGAY, không qua hàng đợi đó).
`vercel.json` khai 2 lượt 01:17 và 13:17 UTC. Đổi giờ cron GitHub thì vô ích vì độ trễ dao động 2–12 giờ, không căn nổi.
Cron trong `daily.yml` **vẫn giữ làm lưới an toàn** — Vercel hỏng thì muộn còn hơn không; chạy trùng cũng rẻ vì daily tự kiểm tồn kho rồi thoát sớm.

### CẦN ĐẶT TRÊN VERCEL thì cron mới chạy (Settings → Environment Variables)

| Biến | Giá trị |
|---|---|
| `CRON_SECRET` | chuỗi ngẫu nhiên tự đặt — Vercel tự gửi kèm `Authorization: Bearer <giá trị này>`; **thiếu thì route trả 503** chứ không chạy mở toang |
| `GH_TOKEN` | PAT GitHub có quyền ghi Actions (fine-grained: repo `ma-ton-studio`, Actions = Read and write) |
| `GITHUB_REPOSITORY` | `trongbao123/ma-ton-studio` |
| `I2V_PROGRESS_TOKEN` | `YbGFsyc-6h0I_wKkn801yOn1V72tAzql` (đã đặt sẵn bên GitHub Actions) |

Gói Hobby cho tối đa 2 cron job, mỗi cái 1 lần/ngày, kích hoạt ngẫu nhiên trong GIỜ đã khai — tức sai số ~1 giờ
thay vì 6,5 giờ như hiện nay. Đang dùng đúng 2.

Thử tay: `curl -H "Authorization: Bearer <CRON_SECRET>" https://ma-ton-studio.vercel.app/api/cron/daily`

## Vận hành
- **Lượt daily 20:17 ngày 11/11 KHÔNG chạy** — tới 20:51 vẫn chưa thấy trên Actions (lượt cuối là `render` 19:23). Cả 2 runner tự host (`win-1`, `win-2`) đang offline nhưng `RUNNER_LABEL` không đặt nên lẽ ra chạy `ubuntu-latest`. Cần xem còn phút Actions của repo private không (`gh` hiện thiếu scope `user` để đọc billing).
- Lượt daily 11/11 14:47 bị cancel ở mốc 240 phút do render bù 8 chương + 2 tập — tự lành (requeueStuck + short-backfill).
- Chạy test Kaggle: `pnpm exec tsx pipeline/render.ts kaggle-test /tmp/i2v-in`.
- Giấy phép tiếng: KHÔNG dùng MMAudio/AudioLDM2 (CC-BY-NC). `sfx.ts` tự sinh bằng lavfi nên không vướng. Nâng cấp sau: Stable Audio Open (community license, cần HF token gated).
