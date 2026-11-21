"use client";

import { connectFacebookAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";

export type FacebookPageStatus = { channel: string; pageName: string; pageId: string };

/** Kết nối Page Facebook cho kênh: dán user token từ Graph API Explorer, server đổi ra token Page không hết hạn. */
export function FacebookConnect({ connected }: { connected: FacebookPageStatus[] }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="font-semibold">Facebook Page</h2>
        <p className="text-xs text-muted">
          Cần FB_APP_ID / FB_APP_SECRET ở trên. Graph API Explorer → chọn app → User Token với quyền pages_show_list,
          pages_read_engagement, pages_manage_posts, publish_video → dán vào đây (token này chỉ dùng một lần, không lưu).
        </p>
      </div>
      {connected.length > 0 && (
        <ul className="text-sm">
          {connected.map((c) => (
            <li key={c.channel}>
              <span className="text-jade">Đã kết nối</span> {c.channel} → {c.pageName} ({c.pageId})
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={connectFacebookAction} submitLabel="Kết nối" pendingLabel="Đang kết nối…" className="flex flex-wrap items-center gap-2">
        <input name="channel" defaultValue="lich-su" className="field w-28" aria-label="Khoá kênh" />
        <input name="pageId" defaultValue="61596491473917" className="field w-44" aria-label="Page ID" />
        <input name="userToken" type="password" autoComplete="off" spellCheck={false} placeholder="User token" className="field min-w-0 flex-1 basis-40" />
      </ActionForm>
    </section>
  );
}
