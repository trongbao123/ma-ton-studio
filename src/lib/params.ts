import { notFound } from "next/navigation";

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return id;
}
