import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { series } from "@/db/schema";
import { isAuthorized } from "@/lib/auth";
import { ALL_CHANNELS, channelOptions, viewChannel } from "@/lib/channel-filter";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { ChannelSelect } from "./channel-select";

/** Bộ chọn kênh (thanh bên). Chỉ hiện khi đã đăng nhập và có từ 2 kênh trở lên. */
export async function ChannelSwitch() {
  await connection();
  const password = process.env.ADMIN_PASSWORD;
  const user = process.env.ADMIN_USER;
  const authed =
    (await verifySession((await cookies()).get(SESSION_COOKIE)?.value, password, user)) ||
    isAuthorized((await headers()).get("authorization"), password, user);
  if (!authed) return null;
  const [current, rows] = await Promise.all([viewChannel(), db().selectDistinct({ ch: series.channel }).from(series).catch(() => [])]);
  const options = await channelOptions(rows.map((r) => r.ch));
  if (options.length < 2) return null;
  return <ChannelSelect options={options.map(({ key, name }) => ({ key, name }))} current={current ?? ALL_CHANNELS} />;
}
