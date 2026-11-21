import { recheckFactsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import type { Dossier, DossierSourceKind, FactIssue } from "@/lib/story/history-types";

const KIND_LABEL: Record<DossierSourceKind, [string, string]> = {
  wikisource: ["Sử liệu gốc", "bg-amber-500/15 text-amber-400"],
  wikipedia: ["Bách khoa", "bg-sky-500/15 text-sky-300"],
  web: ["Web", "bg-zinc-500/15 text-zinc-300"],
};

/** Trang chương kênh lịch sử: nguồn tư liệu của hồ sơ + lỗi sự thật đang chờ sửa (kèm nút soát lại). */
export function HistoryDossier({ chapterId, dossier, issues }: { chapterId: number; dossier: Dossier | null; issues: FactIssue[] | null }) {
  return (
    <div className="space-y-4">
      {issues && issues.length > 0 && (
        <section className="card space-y-3 border-red-500/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-red-400">Lỗi sự thật — chờ sửa ({issues.length})</h2>
            <ActionForm action={recheckFactsAction.bind(null, chapterId)} submitLabel="Soát lại" pendingLabel="Đang gửi lệnh…" variant="secondary" />
          </div>
          <p className="text-xs text-muted">Sửa tay đoạn sai trong ô Nội dung bên dưới (theo gợi ý), bấm “Lưu chỉnh sửa”, rồi bấm “Soát lại”. Đạt thì đề tài tự gỡ cờ.</p>
          <ol className="space-y-2 text-sm">
            {issues.map((issue, i) => (
              <li key={i} className="rounded-lg bg-white/[.03] p-3">
                <p>
                  <span className="text-muted">Câu: </span>“{issue.quote}”
                </p>
                <p>
                  <span className="text-muted">Hồ sơ nói: </span>
                  {issue.note}
                </p>
                {issue.fix && (
                  <p className="text-jade">
                    <span className="text-muted">Gợi ý sửa: </span>“{issue.fix}”
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="card space-y-2">
        <h2 className="font-semibold">Nguồn tư liệu{dossier ? ` (${dossier.sources.length})` : ""}</h2>
        {!dossier ? (
          <p className="text-sm text-muted">Chưa gom hồ sơ — hệ thống gom khi viết lượt đầu.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {dossier.sources.map((src, i) => {
              const [label, tone] = KIND_LABEL[src.kind ?? "wikipedia"];
              return (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
                  <span className="text-xs uppercase text-muted">{src.lang}</span>
                  <a href={src.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent">
                    {src.title}
                  </a>
                  <span className="text-xs tabular-nums text-muted">{src.text.length.toLocaleString("vi-VN")} ký tự</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
