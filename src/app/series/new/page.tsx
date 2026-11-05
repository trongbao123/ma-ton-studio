import { createSeriesAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";

export const maxDuration = 300;

export default function NewSeriesPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Truyện mới</h1>
      <p className="text-muted">
        Viết ý tưởng thô, AI sẽ dựng story bible (nhân vật, cảnh giới, thế lực, tuyến truyện). Bạn sửa lại sau.
      </p>
      <ActionForm action={createSeriesAction} submitLabel="Tạo story bible" pendingLabel="AI đang thiết kế truyện…" className="card space-y-4">
        <div>
          <label className="label" htmlFor="idea">
            Ý tưởng
          </label>
          <textarea
            id="idea"
            name="idea"
            rows={5}
            required
            className="field"
            placeholder="Thiếu niên phế vật bị tông môn ruồng bỏ, nhặt được tàn hồn ma tôn vạn năm trước…"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="genre">
              Thể loại
            </label>
            <input id="genre" name="genre" className="field" defaultValue="tiên hiệp ma đạo" />
          </div>
          <div>
            <label className="label" htmlFor="targetWords">
              Số từ mỗi chương
            </label>
            <input id="targetWords" name="targetWords" type="number" min={1000} max={8000} step={500} className="field" defaultValue={4000} />
          </div>
        </div>
      </ActionForm>
    </div>
  );
}
