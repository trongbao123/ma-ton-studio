import { loadSecrets } from "@/lib/secrets";
import { textProvider } from "@/lib/ai";
import { buildTrendsPrompt, insightsSchema, loadTrends, parseVideos, saveTrends, scannedWithin, type TrendVideo } from "@/lib/trends";
import { callVidiq, closeVidiq, vidiqSchema } from "./vidiq";

/** Từ khóa gốc của ngách — người xem tìm đúng các cụm này. */
const SEEDS = ["truyện tu tiên", "truyện tiên hiệp", "truyện audio"];
const WINDOW_DAYS = 30;
const PER_CALL = 15;

type Schema = { properties?: Record<string, { enum?: unknown[] }> } | null;

/** Chỉ giữ tham số mà tool thật sự có (và giá trị nằm trong enum nếu có) — sai tên tham số thì bỏ chứ không làm lỗi cả lượt. */
export function fitArgs(schema: Schema, args: Record<string, unknown>) {
  const props = schema?.properties;
  if (!props) return args;
  return Object.fromEntries(Object.entries(args).filter(([k, v]) => k in props && (!props[k].enum || props[k].enum.includes(v))));
}

/** Gọi 1 tool vidIQ; lỗi chỉ cảnh báo, trả null. */
async function call(name: string, args: Record<string, unknown>) {
  try {
    return await callVidiq(name, fitArgs((await vidiqSchema(name)) as Schema, args));
  } catch (e) {
    console.warn(`⚠ vidIQ ${name} lỗi:`, e instanceof Error ? e.message : e);
    return null;
  }
}

const dedupe = (list: TrendVideo[]) => [...new Map(list.map((v) => [v.url ?? v.title, v])).values()];

/**
 * Quét xu hướng ngách truyện audio tu tiên (~9 lượt vidIQ, ~45 credit), nhờ AI tóm thành insight và lưu app_settings "trends".
 * Dùng cho tiêu đề/thumbnail ở bước SEO và dàn ý chương. Không có vidIQ hoặc mọi tool lỗi thì không ghi gì.
 */
export async function scanTrends() {
  // Key vidIQ lưu mã hoá trong DB (Cài đặt AI) — chạy riêng bằng CLI thì phải nạp, không thì vidIQ im lặng trả rỗng.
  await loadSecrets(true);
  const after = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const trending: TrendVideo[] = [];
  const outliers: TrendVideo[] = [];
  const texts: { label: string; text: string }[] = [];

  for (const seed of SEEDS) {
    const t = await call("vidiq_trending_videos", { titleQuery: seed, channelCountry: "VN", videoTitleLanguage: "vi", videoPublishedAfter: after, limit: PER_CALL });
    if (t) trending.push(...parseVideos(t));
    const o = await call("vidiq_outliers", { keyword: seed, channelCountry: "VN", language: "vi", publishedWithin: "30d", minOutlierScore: 3, limit: PER_CALL });
    if (o) outliers.push(...parseVideos(o));
  }
  const [rising, questions, comments] = await Promise.all([
    call("vidiq_keyword_research", { mode: "rising", keyword: SEEDS[0], country: "VN", limit: 20 }),
    call("vidiq_keyword_research", { mode: "questions", keyword: SEEDS[0], country: "VN", limit: 20 }),
    call("vidiq_comment_insights", { mode: "niche", niche: "truyện audio tu tiên tiên hiệp", language: "vi" }),
  ]);
  if (rising) texts.push({ label: "Từ khóa đang lên", text: rising });
  if (questions) texts.push({ label: "Câu hỏi người xem hay tìm", text: questions });
  if (comments) texts.push({ label: "Bình luận / khán giả muốn gì", text: comments });
  await closeVidiq();

  const raw = { trending: dedupe(trending), outliers: dedupe(outliers) };
  if (!raw.trending.length && !raw.outliers.length && !texts.length) {
    console.warn("⚠ Không lấy được dữ liệu xu hướng từ vidIQ — bỏ qua.");
    return;
  }

  const prev = await loadTrends();
  let insights = null;
  try {
    insights = await textProvider().generateJson({
      system: "Bạn là chuyên gia tăng trưởng YouTube cho kênh truyện audio tu tiên / tiên hiệp / huyền huyễn tại Việt Nam, tối ưu view và RPM.",
      prompt: `Dữ liệu vidIQ vừa quét (Việt Nam, ${WINDOW_DAYS} ngày gần nhất):\n\n${buildTrendsPrompt({ ...raw, texts })}\n\nTóm thành insight dùng được ngay cho kênh: chỉ rút ra điều có bằng chứng trong dữ liệu, cụ thể, không nói chung chung. Mỗi danh sách 3–6 mục; "actions" là việc cụ thể kênh nên làm tuần này (đề tài, cách đặt tiêu đề/thumbnail, độ dài, lịch đăng).`,
      schema: insightsSchema,
      temperature: 0.4,
      tier: "cheap",
      task: "meta",
    });
  } catch (e) {
    console.warn("⚠ AI tóm tắt xu hướng lỗi:", e instanceof Error ? e.message : e);
  }
  // AI lỗi: giữ insight cũ, vẫn lưu dữ liệu thô mới (và scannedAt để không quét lại tốn credit trong ngày).
  await saveTrends({ scannedAt: new Date().toISOString(), raw, insights: insights ?? prev?.insights ?? null });
  console.log(`✔ Quét xu hướng: ${raw.trending.length} trending, ${raw.outliers.length} outlier${insights ? ", đã tóm tắt" : ", chưa tóm tắt được"}`);
}

/** Đã quét trong 24 giờ qua chưa — job daily chạy 3 tiếng/lần nên chỉ quét khi quá hạn. */
export async function trendsScannedToday() {
  return scannedWithin(await loadTrends(), 1);
}
