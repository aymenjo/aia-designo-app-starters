import { redirect } from "next/navigation";

// En attendant la landing (phase 16).
export default function Accueil() {
  redirect("/tableau-de-bord");
}
