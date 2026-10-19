"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { lireAvisDepose } from "../actions";

/**
 * Un avis déverrouillé (plan Free), jamais lu : sa lecture IA a lieu à son ouverture, comme juste après un dépôt. Le
 * formulaire (`children`) attend la fin de la lecture : il fige ses valeurs à son montage, et l'enregistrer effacerait
 * ce que l'IA vient de lire. Si l'appel échoue en route, le formulaire s'affiche : l'avis se saisit à la main.
 */
export function LectureDifferee({ id, children }: { id: string; children: ReactNode }) {
  const router = useRouter();
  const lancee = useRef(false);
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    // Une seule lecture, même quand React monte l'effet deux fois (StrictMode) ; le verrou en base l'assure aussi.
    if (lancee.current) return;
    lancee.current = true;
    lireAvisDepose(id).then(
      (lecture) => {
        // Le n° lu est celui d'un avis déjà enregistré : ce dépôt n'existe plus, on mène à l'existant, comme au dépôt.
        if (!lecture.ok) router.replace(`/avis/nouveau?existant=${lecture.existant.id}`);
        else router.refresh();
      },
      () => setEchec(true),
    );
  }, [id, router]);

  if (echec) return children;
  return (
    <section role="status" className="grid gap-1 rounded-card border border-line p-6 max-md:p-5">
      <p className="font-semibold">Lecture de l&apos;avis…</p>
      <p className="text-label text-secondary">
        Cet avis vient d&apos;être déverrouillé&nbsp;: Désigno lit ses informations, comme après un dépôt. Les champs
        déjà saisis sont gardés.
      </p>
    </section>
  );
}
