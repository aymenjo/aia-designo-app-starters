"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Déconnecte cet appareil seulement. */
export async function seDeconnecter() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/connexion");
}
