import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const YT_KEY = "youtube";
export type YoutubeAuth = { refreshToken: string; channel: string | null; connectedAt: string };

export async function getYoutubeAuth(): Promise<YoutubeAuth | null> {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, YT_KEY));
  const v = row?.value as Partial<YoutubeAuth> | undefined;
  return v?.refreshToken ? { refreshToken: v.refreshToken, channel: v.channel ?? null, connectedAt: v.connectedAt ?? "" } : null;
}
