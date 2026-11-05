"use client";

import { FileUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { LienPasserEnPro } from "@/components/LienPasserEnPro";
import { Alerte } from "@/components/ui/Alerte";
import { LIMITES_FREE } from "@/lib/abonnement/plans";
import { Bouton, classesBouton } from "@/components/ui/Bouton";
import {
  FICHIERS_ACCEPTES_IMPORT,
  MESSAGES_IMPORT,
  TAILLE_MAX_IMPORT,
  verifierDepotImport,
  type AnalyseImport,
  type Comptes,
  type RapportImport,
} from "@/lib/flotte/regles-import";
import { analyserFichiers, importerFichiers } from "./actions";
import { ApercuImport } from "./ApercuImport";

type Etape =
  | { nom: "vide" }
  | { nom: "analyse" }
  | { nom: "apercu"; fichiers: File[]; analyse: AnalyseImport }
  | { nom: "import"; fichiers: File[]; analyse: AnalyseImport }
  | { nom: "termine"; rapport: RapportImport };

function formulaire(fichiers: readonly File[]) {
  const donnees = new FormData();
  for (const fichier of fichiers) donnees.append("fichiers", fichier);
  return donnees;
}

const nombre = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** « 15 véhicules, 15 conducteurs et 12 affectations ajoutés », ou `null` si rien n'a été écrit. */
function bilan({ vehicules, conducteurs, affectations }: Comptes): string | null {
  const parties = [
    vehicules && nombre(vehicules, "véhicule"),
    conducteurs && nombre(conducteurs, "conducteur"),
    affectations && nombre(affectations, "affectation"),
  ].filter((partie): partie is string => Boolean(partie));
  if (!parties.length) return null;
  const liste = parties.length > 1 ? `${parties.slice(0, -1).join(", ")} et ${parties.at(-1)}` : parties[0];
  return `${liste} ${vehicules + conducteurs + affectations > 1 ? "ajoutés" : "ajouté"}`;
}

/** Les véhicules au-delà de la limite Free, qui ne sont pas importés. */
function horsLimite({ fichiers }: AnalyseImport): number {
  return fichiers.reduce(
    (total, fichier) =>
      total + (fichier.type === "vehicules" ? fichier.lignes.filter(({ statut }) => statut === "hors_limite").length : 0),
    0,
  );
}

/** « 2 véhicules non importés : … », avec le lien pour passer en Pro. */
function AlerteHorsLimite({ vehicules }: { vehicules: number }) {
  return (
    <Alerte>
      <p>
        {nombre(vehicules, "véhicule")} non importé{vehicules > 1 ? "s" : ""}&nbsp;: le plan Free compte {LIMITES_FREE.vehicules}{" "}
        véhicules actifs au plus.
      </p>
      <LienPasserEnPro />
    </Alerte>
  );
}

/**
 * Import de la flotte : 1 ou 2 fichiers CSV déposés ensemble, un aperçu, puis l'import des lignes valides.
 * Chaque fichier est copié au dépôt : l'import envoie exactement ce qui a été prévisualisé, même si le fichier
 * a changé entre-temps sur le disque.
 */
export function ImportFlotte() {
  const [etape, setEtape] = useState<Etape>({ nom: "vide" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [survol, setSurvol] = useState(false);
  const choisir = useRef<HTMLInputElement>(null);

  // Un fichier lâché à côté de la zone ne doit pas remplacer l'application par le fichier.
  useEffect(() => {
    const retenir = (e: globalThis.DragEvent) => e.preventDefault();
    window.addEventListener("dragover", retenir);
    window.addEventListener("drop", retenir);
    return () => {
      window.removeEventListener("dragover", retenir);
      window.removeEventListener("drop", retenir);
    };
  }, []);

  async function deposer(deposes: File[]) {
    if (!deposes.length || etape.nom === "analyse") return;
    setErreur(null);
    const controle = verifierDepotImport(deposes);
    if (!controle.ok) return setErreur(controle.erreur);

    setEtape({ nom: "analyse" });
    try {
      const fichiers = await Promise.all(
        deposes.map(async (fichier) => new File([await fichier.arrayBuffer()], fichier.name, { type: fichier.type })),
      );
      const analyse = await analyserFichiers(formulaire(fichiers));
      if (analyse.erreur) {
        setEtape({ nom: "vide" });
        setErreur(analyse.erreur);
        return;
      }
      setEtape({ nom: "apercu", fichiers, analyse });
    } catch {
      setEtape({ nom: "vide" });
      setErreur(MESSAGES_IMPORT.envoiImpossible);
    }
  }

  async function importer() {
    if (etape.nom !== "apercu") return;
    const { fichiers, analyse } = etape;
    setErreur(null);
    setEtape({ nom: "import", fichiers, analyse });
    try {
      const rapport = await importerFichiers(formulaire(fichiers));
      if (rapport.erreur) {
        setEtape({ nom: "apercu", fichiers, analyse });
        setErreur(rapport.erreur);
        return;
      }
      setEtape({ nom: "termine", rapport });
    } catch {
      // Ce qui a été écrit le reste : un nouvel essai l'ignorera.
      setEtape({ nom: "apercu", fichiers, analyse });
      setErreur(MESSAGES_IMPORT.envoiImpossible);
    }
  }

  function recommencer() {
    setErreur(null);
    setEtape({ nom: "vide" });
  }

  function aLaSelection(e: ChangeEvent<HTMLInputElement>) {
    const fichiers = Array.from(e.currentTarget.files ?? []);
    // Vidé : choisir à nouveau les mêmes fichiers relance l'analyse.
    e.currentTarget.value = "";
    void deposer(fichiers);
  }

  function aLaChute(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setSurvol(false);
    void deposer(Array.from(e.dataTransfer.files));
  }

  const message = erreur && <Alerte variante="erreur">{erreur}</Alerte>;

  if (etape.nom === "apercu" || etape.nom === "import") {
    const { aImporter } = etape.analyse;
    const total = aImporter.vehicules + aImporter.conducteurs;
    const enCours = etape.nom === "import";
    return (
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Bouton disabled={!total || enCours} aria-busy={enCours || undefined} onClick={importer}>
            {enCours ? "Import…" : total ? `Importer ${nombre(total, "ligne")}` : "Importer"}
          </Bouton>
          <Bouton variante="ghost" disabled={enCours} onClick={recommencer}>
            Changer de fichiers
          </Bouton>
          <p className="text-label text-secondary">
            {total
              ? "Seules les lignes à importer seront écrites : corrigez les autres dans votre fichier, puis déposez-le à nouveau."
              : "Aucune ligne à importer."}
          </p>
        </div>
        {message}
        {horsLimite(etape.analyse) > 0 && <AlerteHorsLimite vehicules={horsLimite(etape.analyse)} />}
        <ApercuImport resultat={etape.analyse} />
      </div>
    );
  }

  if (etape.nom === "termine") {
    const { rapport } = etape;
    const ajouts = bilan(rapport.importes);
    return (
      <div className="grid gap-6">
        {ajouts ? (
          <Alerte variante="succes">
            <p className="font-semibold">{ajouts}</p>
          </Alerte>
        ) : (
          <Alerte>Aucune ligne importée.</Alerte>
        )}
        {horsLimite(rapport) > 0 && <AlerteHorsLimite vehicules={horsLimite(rapport)} />}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/flotte/vehicules" className={classesBouton({ variante: "secondaire" })}>
            Voir les véhicules
          </Link>
          <Link href="/flotte/conducteurs" className={classesBouton({ variante: "secondaire" })}>
            Voir les conducteurs
          </Link>
          <Link href="/flotte/planning" className={classesBouton({ variante: "secondaire" })}>
            Voir le planning
          </Link>
          <Bouton variante="ghost" onClick={recommencer}>
            Importer d&apos;autres fichiers
          </Bouton>
        </div>
        <ApercuImport resultat={rapport} />
      </div>
    );
  }

  const analyse = etape.nom === "analyse";
  return (
    <div className="grid gap-4">
      <input
        ref={choisir}
        type="file"
        multiple
        accept={FICHIERS_ACCEPTES_IMPORT}
        aria-label="Choisir les fichiers CSV"
        hidden
        onChange={aLaSelection}
      />
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setSurvol(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSurvol(false);
        }}
        onDrop={aLaChute}
        className={[
          "grid justify-items-center gap-4 rounded-panel border border-dashed px-6 py-10 text-center transition-colors duration-120 ease-enter",
          survol ? "border-ink bg-surface" : "border-gray-300",
        ].join(" ")}
      >
        <FileUp size={20} strokeWidth={1.5} aria-hidden className="text-secondary" />
        <div className="grid gap-1">
          <p className="font-semibold">Glissez vos fichiers CSV ici</p>
          <p className="text-label text-secondary">
            Le fichier véhicules, le fichier conducteurs, ou les deux · {TAILLE_MAX_IMPORT / 1024} Ko max. en tout.
          </p>
        </div>
        <Bouton
          variante="secondaire"
          disabled={analyse}
          aria-busy={analyse || undefined}
          onClick={() => choisir.current?.click()}
        >
          {analyse ? "Analyse…" : "Choisir les fichiers"}
        </Bouton>
      </div>
      {message}
    </div>
  );
}
