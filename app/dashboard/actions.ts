"use server";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";

export async function resolveAlert(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) await sql()`update staff_alerts set resolved = true where id = ${id}`;
  revalidatePath("/dashboard");
}
