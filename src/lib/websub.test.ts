import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { needsRenew, parseFeedChannelId, parseFeedVideoIds, topicFor, verifySignature } from "./websub";

const feed = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:64x3Yi4MMYQ</id>
    <yt:videoId>64x3Yi4MMYQ</yt:videoId>
    <yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
    <title>Sương độc ăn mòn</title>
  </entry>
</feed>`;

describe("feed WebSub", () => {
  it("đọc id video và id kênh", () => {
    expect(parseFeedVideoIds(feed)).toEqual(["64x3Yi4MMYQ"]);
    expect(parseFeedChannelId(feed)).toBe("UCabcdefghijklmnopqrstuv");
  });
  it("tin xoá video không có videoId → rỗng", () => {
    expect(parseFeedVideoIds(`<feed><at:deleted-entry ref="yt:video:64x3Yi4MMYQ"/></feed>`)).toEqual([]);
  });
  it("topic đúng dạng YouTube", () => {
    expect(topicFor("UCx")).toBe("https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCx");
  });
});

describe("verifySignature", () => {
  const sig = (body: string, secret: string) => `sha1=${createHmac("sha1", secret).update(body).digest("hex")}`;
  it("nhận đúng chữ ký, từ chối sai / thiếu", () => {
    expect(verifySignature(feed, sig(feed, "s"), "s")).toBe(true);
    expect(verifySignature(feed, sig(feed, "khác"), "s")).toBe(false);
    expect(verifySignature(`${feed} `, sig(feed, "s"), "s")).toBe(false);
    expect(verifySignature(feed, null, "s")).toBe(false);
  });
});

describe("needsRenew", () => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  const cb = "https://x.app/api/youtube/websub";
  const base = { channelId: "UCx", topic: "t", callback: cb, requestedAt: "2026-11-09T00:00:00Z" };
  it("chưa đăng ký / đổi tên miền → cần", () => {
    expect(needsRenew(null, cb, now)).toBe(true);
    expect(needsRenew({ ...base, expiresAt: "2026-11-20T00:00:00Z" }, "https://khac.app/api/youtube/websub", now)).toBe(true);
  });
  it("còn > 2 ngày thì thôi, < 2 ngày thì gia hạn", () => {
    expect(needsRenew({ ...base, expiresAt: "2026-11-15T00:00:00Z" }, cb, now)).toBe(false);
    expect(needsRenew({ ...base, expiresAt: "2026-11-11T00:00:00Z" }, cb, now)).toBe(true);
  });
  it("đã gửi mà hub chưa xác nhận sau 1 giờ → gửi lại", () => {
    expect(needsRenew(base, cb, now)).toBe(true);
    expect(needsRenew({ ...base, requestedAt: "2026-11-09T23:30:00Z" }, cb, now)).toBe(false);
  });
});
