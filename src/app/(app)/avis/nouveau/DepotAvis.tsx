"use client";

import { Camera, FileUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton, classesBouton } from "@/components/ui/Bouton";
import { BUCKET_AVIS, cheminFichier } from "@/lib/avis/avis";
import {
  FICHIERS_ACCEPTES,
  MESSAGES_AVIS,
  TAILLE_MAX_FICHIER,
  TYPES_STOCKES,
  verifierDepot,
  type FormatStocke,
} from "@/lib/avis/regles";
import { createClient } from "@/lib/supabase/client";
import { deposerAvis, lireAvisDepose, type LectureDepot } from "../actions";

type Etape =
  | { nom: "pret" }
  | { nom: "conversion" }
  | { nom: "envoi" }
  | { nom: "lecture" }
  | { nom: "enregistre"; id: string; lue: boolean };

const EN_COURS = { conversion: "Conversion de la photo…", envoi: "Envoi…", lecture: "Lecture de l'avis…" } as const;

/** Le bucket refuse un fichier trop lourd ou d'un type non accepté : son code d'erreur le dit (le statut HTTP vaut 400). */
function messageEnvoi(error: Error) {
  const code = "code" in error ? error.code : null;
  if (code === "EntityTooLarge") return MESSAGES_AVIS.fichierTropLourd;
  if (code === "InvalidMimeType") return MESSAGES_AVIS.formatRefuse;
  return MESSAGES_AVIS.envoiImpossible;
}

/** Un HEIC (photo d'iPhone) devient un JPEG : le seul format d'image que lisent tous les navigateurs et l'IA. */
async function versJpeg(fichier: File): Promise<Blob> {
  const { heicTo } = await import("heic-to");
  return heicTo({ blob: fichier, type: "image/jpeg", quality: 0.9 });
}

/**
 * Dépôt d'un avis : un fichier par avis, envoyé directement du navigateur au bucket (une server action est limitée
 * à 1 Mo), puis l'avis est créé et lu par l'IA. Sur ordinateur, on ouvre l'avis pré-rempli ; sur téléphone, on propose
 * d'en photographier un autre.
 * `existant` : le dépôt précédent doublait cet avis et a été abandonné, ce qui est rappelé jusqu'au dépôt suivant.
 */
export function DepotAvis({
  entrepriseId,
  existant,
}: {
  entrepriseId: string;
  existant: { id: string; numero: string } | null;
}) {
  const router = useRouter();
  const [etape, setEtape] = useState<Etape>({ nom: "pret" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [doublonEvite, setDoublonEvite] = useState(existant);
  const [survol, setSurvol] = useState(false);
  const choisir = useRef<HTMLInputElement>(null);
  const photographier = useRef<HTMLInputElement>(null);
  const occupe = etape.nom in EN_COURS;

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

  function refuser(message: string) {
    setEtape({ nom: "pret" });
    setErreur(message);
  }

  async function deposer(fichiers: File[]) {
    if (!fichiers.length || occupe) return;
    setErreur(null);
    setDoublonEvite(null);
    const controle = verifierDepot(fichiers);
    if (!controle.ok) return refuser(controle.erreur);
    const [fichier] = fichiers;

    let contenu: Blob = fichier;
    let format: FormatStocke;
    if (controle.format === "heic") {
      setEtape({ nom: "conversion" });
      try {
        contenu = await versJpeg(fichier);
      } catch {
        return refuser(MESSAGES_AVIS.conversionImpossible);
      }
      if (contenu.size > TAILLE_MAX_FICHIER) return refuser(MESSAGES_AVIS.fichierTropLourd);
      format = "jpeg";
    } else format = controle.format;

    setEtape({ nom: "envoi" });
    const chemin = cheminFichier(entrepriseId, format);
    try {
      const { error } = await createClient()
        .storage.from(BUCKET_AVIS)
        .upload(chemin, contenu, { contentType: TYPES_STOCKES[format], upsert: false });
      if (error) return refuser(messageEnvoi(error));

      const resultat = await deposerAvis(chemin, fichier.name);
      if (!resultat.ok) return refuser(resultat.erreur);

      setEtape({ nom: "lecture" });
      const lecture = await lire(resultat.id);
      // Le n° lu est celui d'un avis déjà enregistré : ce dépôt n'existe plus, on mène à l'existant.
      if (!lecture.ok) {
        setEtape({ nom: "pret" });
        setDoublonEvite(lecture.existant);
        return;
      }
      // L'écran du téléphone est trop étroit pour saisir à côté de l'image : on enchaîne les photos.
      if (window.matchMedia("(max-width: 767px)").matches) {
        setEtape({ nom: "enregistre", id: resultat.id, lue: lecture.lue });
      } else router.push(`/avis/${resultat.id}`);
    } catch {
      refuser(MESSAGES_AVIS.envoiImpossible);
    }
  }

  /** L'avis est créé : si sa lecture échoue en route, il se saisira à la main. */
  async function lire(id: string): Promise<LectureDepot> {
    try {
      return await lireAvisDepose(id);
    } catch {
      return { ok: true, lue: false };
    }
  }

  function aLaSelection(e: ChangeEvent<HTMLInputElement>) {
    const fichiers = Array.from(e.currentTarget.files ?? []);
    // Vidé : choisir à nouveau le même fichier relance le dépôt.
    e.currentTarget.value = "";
    void deposer(fichiers);
  }

  function aLaChute(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setSurvol(false);
    void deposer(Array.from(e.dataTransfer.files));
  }

  function photographierUnAutre() {
    setEtape({ nom: "pret" });
    photographier.current?.click();
  }

  const libelle = (repos: string) => (occupe ? EN_COURS[etape.nom as keyof typeof EN_COURS] : repos);

  return (
    <div className="grid gap-4">
      <input
        ref={choisir}
        type="file"
        accept={FICHIERS_ACCEPTES}
        aria-label="Choisir le fichier de l'avis"
        hidden
        onChange={aLaSelection}
      />
      <input
        ref={photographier}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Photographier l'avis"
        hidden
        onChange={aLaSelection}
      />

      {etape.nom === "enregistre" ? (
        <>
          <Alerte variante="succes">
            <p className="font-semibold">Avis enregistré</p>
            <p>
              {etape.lue
                ? "Désigno l'a lu : vérifiez ses informations maintenant, ou plus tard depuis votre ordinateur."
                : "Il est « À traiter » : saisissez ses informations maintenant, ou plus tard depuis votre ordinateur."}
            </p>
          </Alerte>
          <Bouton taille="lg" pleineLargeur onClick={photographierUnAutre}>
            <Camera size={20} strokeWidth={1.5} aria-hidden />
            Photographier un autre avis
          </Bouton>
          <Link
            href={`/avis/${etape.id}`}
            className={classesBouton({ variante: "secondaire", taille: "tactile", pleineLargeur: true })}
          >
            Voir l&apos;avis
          </Link>
        </>
      ) : (
        <>
          {/* En encre sur gris : rien d'urgent, Désigno a évité de traiter deux fois le même avis. */}
          {doublonEvite && (
            <Alerte>
              <p className="font-semibold">
                Cet avis existe déjà&nbsp;: n° <span className="font-mono font-medium">{doublonEvite.numero}</span>.
              </p>
              <p>{MESSAGES_AVIS.depotAbandonne}</p>
              <p>
                <Link href={`/avis/${doublonEvite.id}`}>Ouvrir l&apos;avis existant</Link>
              </p>
            </Alerte>
          )}
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
              "grid justify-items-center gap-4 rounded-panel border border-dashed px-6 py-10 text-center transition-colors duration-120 ease-enter max-md:py-8",
              survol ? "border-ink bg-surface" : "border-gray-300",
            ].join(" ")}
          >
            <FileUp size={20} strokeWidth={1.5} aria-hidden className="text-secondary" />
            <div className="grid gap-1">
              <p className="font-semibold max-md:hidden">Glissez l&apos;avis ici</p>
              <p className="font-semibold md:hidden">Photographiez l&apos;avis à plat, bien éclairé</p>
              <p className="text-label text-secondary">PDF, JPG, PNG ou HEIC · 10 Mo max. Un fichier par avis.</p>
            </div>
            <Bouton
              variante="secondaire"
              className="max-md:hidden"
              disabled={occupe}
              aria-busy={occupe || undefined}
              onClick={() => choisir.current?.click()}
            >
              {libelle("Choisir un fichier")}
            </Bouton>
          </div>

          <div className="grid gap-3 md:hidden">
            <Bouton
              taille="lg"
              pleineLargeur
              disabled={occupe}
              aria-busy={occupe || undefined}
              onClick={() => photographier.current?.click()}
            >
              <Camera size={20} strokeWidth={1.5} aria-hidden />
              {libelle("Photographier un avis")}
            </Bouton>
            <Bouton
              variante="secondaire"
              taille="tactile"
              pleineLargeur
              disabled={occupe}
              onClick={() => choisir.current?.click()}
            >
              Choisir un fichier
            </Bouton>
          </div>

          {erreur && <Alerte variante="erreur">{erreur}</Alerte>}
        </>
      )}
    </div>
  );
}
