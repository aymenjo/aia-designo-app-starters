"use client";

import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { classesBouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { seDeconnecter } from "./actions";

function initiales(email: string) {
  const parties = email.split("@")[0].split(/[._-]+/).filter(Boolean);
  const lettres = parties.length > 1 ? parties[0][0] + parties[1][0] : (parties[0] ?? "").slice(0, 2);
  return lettres.toUpperCase();
}

export function MenuCompte({ email }: { email: string }) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const fermerSiDehors = (e: PointerEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    const fermerSurEchap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("pointerdown", fermerSiDehors);
    document.addEventListener("keydown", fermerSurEchap);
    return () => {
      document.removeEventListener("pointerdown", fermerSiDehors);
      document.removeEventListener("keydown", fermerSurEchap);
    };
  }, [ouvert]);

  return (
    <div ref={racine} className="relative">
      <button
        type="button"
        aria-label="Mon compte"
        aria-haspopup="true"
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
        className="grid size-8 cursor-pointer place-items-center rounded-full bg-band text-caption font-semibold text-ink"
      >
        {initiales(email)}
      </button>
      {ouvert && (
        <div className="absolute top-full right-0 z-10 mt-2 grid w-64 gap-1 rounded-card border border-line bg-white p-1 shadow-popover">
          <p className="truncate px-3 pt-2 pb-1 text-label text-secondary">{email}</p>
          <Link
            href="/parametres/compte"
            onClick={() => setOuvert(false)}
            className={`${classesBouton({ variante: "ghost", taille: "sm", pleineLargeur: true })} justify-start`}
          >
            <UserRound size={16} strokeWidth={1.5} aria-hidden />
            Mon compte
          </Link>
          <form action={seDeconnecter}>
            <BoutonEnvoi variante="ghost" taille="sm" pleineLargeur className="justify-start" enCours="Déconnexion…">
              <LogOut size={16} strokeWidth={1.5} aria-hidden />
              Se déconnecter
            </BoutonEnvoi>
          </form>
        </div>
      )}
    </div>
  );
}
