// Nhận tiến độ TRỰC TIẾP từ kernel Kaggle (kaggle/i2v/run.py) và trả lại cho CLI / màn flow.
//
// API Kaggle chỉ trả log sau khi kernel xong, nên đây là đường duy nhất để biết kernel đang ở bước nào
// trong lúc chạy. Kernel chạy trên máy người khác → mọi dữ liệu vào đây là KHÔNG TIN ĐƯỢC:
// parseProgressEvent kẹp hết số và chặn slug sai dạng trước khi ghi.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { emptyProgress, mergeProgress, parseProgressEvent, progressKey, type I2vProgressState } from "../../../../../pipeline/i2v-progress";

/** Token riêng cho việc báo tiến độ: nằm trong dataset Kaggle (private) nên KHÔNG dùng chung với token nào khác. */
const TOKEN = process.env.I2V_PROGRESS_TOKEN;

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function read(slug: string): Promise<I2vProgressState | null> {
  const [row] = await db().select().from(appSettings).where(eq(appSettings.key, progressKey(slug)));
  return (row?.value as I2vProgressState | undefined) ?? null;
}

export async function POST(req: Request) {
  if (!TOKEN) return json({ error: "chưa đặt I2V_PROGRESS_TOKEN" }, 503);
  if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return json({ error: "sai token" }, 401);
  const ev = parseProgressEvent(await req.json().catch(() => null));
  if (!ev) return json({ error: "sự kiện không hợp lệ" }, 400);
  const prev = (await read(ev.slug)) ?? emptyProgress(ev.slug, ev.videoId, ev.total);
  const next = mergeProgress(prev, ev);
  await db()
    .insert(appSettings)
    .values({ key: progressKey(ev.slug), value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  return json({ ok: true });
}

/** CLI và màn flow đọc bằng đường này (chỉ đọc, không cần token — nội dung chỉ là số bước/giây/VRAM). */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return json({ error: "thiếu slug" }, 400);
  const state = await read(slug);
  return state ? json(state) : json({ error: "chưa có tiến độ cho phiên này" }, 404);
}
