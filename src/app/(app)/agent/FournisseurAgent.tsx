"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Plan } from "@/lib/abonnement/plans";
import { PanneauAgent } from "./PanneauAgent";

// Le panneau « Demande à Désigno » (phase 26) : ouvert ou fermé, il reste tel quel d'un écran à l'autre, car le layout
// de l'application ne se démonte pas à la navigation. À partir de 1440 px, il pousse le contenu ; en dessous, il passe
// par-dessus. Il n'existe pas sur téléphone.

type EtatAgent = { ouvert: boolean; plan: Plan; basculer: () => void; fermer: () => void };

const ContexteAgent = createContext<EtatAgent | null>(null);

export function useAgent() {
  const etat = useContext(ContexteAgent);
  if (!etat) throw new Error("useAgent hors de FournisseurAgent");
  return etat;
}

/** La grille de l'application : la barre latérale, le contenu, puis le panneau quand il est ouvert. */
export function FournisseurAgent({ plan, children }: { plan: Plan; children: ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  const etat = useMemo(
    () => ({ ouvert, plan, basculer: () => setOuvert((o) => !o), fermer: () => setOuvert(false) }),
    [ouvert, plan],
  );

  return (
    <ContexteAgent.Provider value={etat}>
      <div
        data-agent-ouvert={ouvert ? "" : undefined}
        className="grid min-h-screen md:grid-cols-[232px_minmax(0,1fr)] wide:data-agent-ouvert:grid-cols-[232px_minmax(0,1fr)_400px]"
      >
        {children}
        {ouvert && <PanneauAgent plan={plan} fermer={etat.fermer} />}
      </div>
    </ContexteAgent.Provider>
  );
}
