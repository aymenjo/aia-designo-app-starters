"use client";

import { Download, Lock } from "lucide-react";
import { useState } from "react";
import { CadenasPro } from "@/components/CadenasPro";
import { Bouton, classesBouton } from "@/components/ui/Bouton";
import { Fenetre } from "@/components/ui/Fenetre";
import { FONCTIONS_PRO, type Plan } from "@/lib/abonnement/plans";

const EXPORT_CSV = FONCTIONS_PRO.find(({ nom }) => nom === "Export CSV")!;

/** Pro : le fichier se télécharge. Free : le même bouton, cadenassé, ouvre la fenêtre qui invite à passer en Pro. */
export function ExportAvis({ plan }: { plan: Plan }) {
  const [ouverte, setOuverte] = useState(false);

  if (plan === "pro") {
    return (
      <a href="/avis/export" download className={classesBouton({ variante: "secondaire" })}>
        <Download size={16} strokeWidth={1.5} aria-hidden />
        Exporter en CSV
      </a>
    );
  }

  return (
    <>
      <Bouton variante="secondaire" onClick={() => setOuverte(true)}>
        <Download size={16} strokeWidth={1.5} aria-hidden />
        Exporter en CSV
        <Lock size={16} strokeWidth={1.5} aria-hidden className="text-secondary" />
      </Bouton>
      <Fenetre titre="Exporter en CSV" ouverte={ouverte} onFermer={() => setOuverte(false)}>
        <CadenasPro fonction={EXPORT_CSV.nom}>
          <p>{EXPORT_CSV.explication}</p>
        </CadenasPro>
      </Fenetre>
    </>
  );
}
