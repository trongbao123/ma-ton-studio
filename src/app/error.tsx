"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card space-y-3">
      <h1 className="text-lg font-bold text-accent">Có lỗi</h1>
      <p className="text-sm">{error.message || "Lỗi không rõ."}</p>
      <button type="button" onClick={reset} className="btn-secondary">
        Thử lại
      </button>
    </div>
  );
}
