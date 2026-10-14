import Link from "next/link";
import type { ReactNode } from "react";
import { Plaque } from "@/components/Plaque";
import { Alerte } from "@/components/ui/Alerte";
import {
  COLONNES,
  LIBELLES_FICHIER,
  MESSAGES_IMPORT,
  type AnalyseImport,
  type FicheArchivee,
  type LigneConducteur,
  type LigneVehicule,
  type Motifs,
  type StatutLigne,
  type TypeFichier,
} from "@/lib/flotte/regles-import";
import { PastilleType } from "../vehicules/PastilleType";

// L'aperçu de l'import, puis son rapport : une section par fichier, et ses lignes groupées par statut.
// Une ligne en erreur montre, pour chaque colonne fautive, la valeur relevée et le motif des écrans.

const GROUPES: { statut: StatutLigne; titre: string; decompte: (n: number) => string }[] = [
  { statut: "en_erreur", titre: "En erreur", decompte: (n) => `${n} en erreur` },
  { statut: "ignoree", titre: "Déjà dans votre flotte", decompte: (n) => `${n} déjà dans votre flotte` },
  { statut: "a_importer", titre: "À importer", decompte: (n) => `${n} à importer` },
  { statut: "importee", titre: "Importées", decompte: (n) => `${n} importée${n > 1 ? "s" : ""}` },
];

const ENTETES = Object.fromEntries(
  (Object.keys(COLONNES) as TypeFichier[]).map((type) => [
    type,
    Object.fromEntries(COLONNES[type].map(({ champ, entete }) => [champ, entete])),
  ]),
) as Record<TypeFichier, Record<string, string>>;

function LienFiche({ fiche }: { fiche: FicheArchivee }) {
  const href = fiche.type === "vehicule" ? `/flotte/vehicules/${fiche.id}` : `/flotte/conducteurs/${fiche.id}`;
  return (
    <Link href={href} className="justify-self-start text-label">
      Ouvrir sa fiche
    </Link>
  );
}

/** Les motifs d'une ligne. En erreur : la colonne, la valeur relevée en mono, puis le motif, en rouge. */
function ListeMotifs({
  type,
  statut,
  motifs,
  valeurs,
}: {
  type: TypeFichier;
  statut: StatutLigne;
  motifs: Motifs<string>;
  valeurs: Partial<Record<string, string>>;
}) {
  const entrees = Object.entries(motifs);
  if (!entrees.length) return null;
  const erreur = statut === "en_erreur";
  return (
    <ul className={`grid gap-0.5 text-label ${erreur ? "text-urgent" : "text-secondary"}`}>
      {entrees.map(([champ, motif]) => {
        const valeur = valeurs[champ];
        return (
          <li key={champ}>
            {erreur && champ !== "general" && (
              <>
                {ENTETES[type][champ]}&nbsp;:{" "}
                {valeur && (
                  <>
                    <span className="font-mono font-medium break-all">{valeur}</span>.{" "}
                  </>
                )}
              </>
            )}
            {motif}
          </li>
        );
      })}
    </ul>
  );
}

function Ligne({
  ligne,
  statut,
  cle,
  details,
  children,
  ficheArchivee,
}: {
  ligne: number;
  statut: StatutLigne;
  cle: ReactNode;
  details?: ReactNode;
  children?: ReactNode;
  ficheArchivee?: FicheArchivee;
}) {
  return (
    <li className={`grid min-h-13 content-center gap-1.5 px-4 py-2.5 ${statut === "en_erreur" ? "bg-urgent-tint" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-16 flex-none text-label text-secondary">Ligne {ligne}</span>
        {cle}
        {details}
      </div>
      {(children || ficheArchivee) && (
        <div className="grid gap-1 pl-19 max-md:pl-0">
          {children}
          {ficheArchivee && <LienFiche fiche={ficheArchivee} />}
        </div>
      )}
    </li>
  );
}

function LigneDeVehicule({ ligne }: { ligne: LigneVehicule }) {
  const valide = ligne.statut === "a_importer" || ligne.statut === "importee";
  return (
    <Ligne
      ligne={ligne.ligne}
      statut={ligne.statut}
      ficheArchivee={ligne.ficheArchivee}
      cle={
        ligne.plaque ? (
          <Plaque plaque={ligne.plaque} />
        ) : (
          <span className="font-mono text-label font-medium break-all">{ligne.valeurs.plaque ?? "Sans plaque"}</span>
        )
      }
      details={
        valide && (
          <>
            {ligne.valeurs.modele && <span className="text-secondary">{ligne.valeurs.modele}</span>}
            {ligne.type && <PastilleType type={ligne.type} />}
            {ligne.attitre && (
              <span>
                {ligne.attitre.nom} <span className="text-secondary">depuis le {ligne.attitre.depuis}</span>
              </span>
            )}
          </>
        )
      }
    >
      <ListeMotifs type="vehicules" statut={ligne.statut} motifs={ligne.motifs} valeurs={ligne.valeurs} />
    </Ligne>
  );
}

function LigneDeConducteur({ ligne }: { ligne: LigneConducteur }) {
  const valide = ligne.statut === "a_importer" || ligne.statut === "importee";
  return (
    <Ligne
      ligne={ligne.ligne}
      statut={ligne.statut}
      ficheArchivee={ligne.ficheArchivee}
      cle={<span className="font-medium">{ligne.nom || "Sans nom"}</span>}
      details={valide && ligne.valeurs.email && <span className="text-secondary">{ligne.valeurs.email}</span>}
    >
      <ListeMotifs type="conducteurs" statut={ligne.statut} motifs={ligne.motifs} valeurs={ligne.valeurs} />
    </Ligne>
  );
}

function Groupe({ titre, nombre, children }: { titre: string; nombre: number; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <h3 className="font-mono text-meta font-medium text-secondary uppercase">
        {titre} · {nombre}
      </h3>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">{children}</ul>
    </div>
  );
}

export function ApercuImport({ resultat }: { resultat: AnalyseImport }) {
  return (
    <div className="grid gap-8">
      {resultat.fichiers.map((fichier, index) => {
        if (!fichier.type) {
          return (
            <Alerte key={index} variante="erreur">
              {fichier.erreur}
            </Alerte>
          );
        }
        const lignes: (LigneVehicule | LigneConducteur)[] = fichier.lignes;
        const groupes = GROUPES.map((groupe) => ({
          ...groupe,
          lignes: lignes.filter(({ statut }) => statut === groupe.statut),
        })).filter((groupe) => groupe.lignes.length);

        return (
          <section key={index} className="grid gap-4">
            <div className="grid gap-0.5">
              <h2 className="font-semibold">
                Fichier {LIBELLES_FICHIER[fichier.type]}{" "}
                <span className="font-normal break-all text-secondary">· {fichier.nom}</span>
              </h2>
              {groupes.length > 0 && (
                <p className="text-label text-secondary">
                  {groupes.map(({ decompte, lignes }) => decompte(lignes.length)).join(" · ")}
                </p>
              )}
              {fichier.colonnesIgnorees.length > 0 && (
                <p className="text-label text-secondary">{MESSAGES_IMPORT.colonnesIgnorees(fichier.colonnesIgnorees)}</p>
              )}
            </div>
            {!lignes.length && <Alerte>{MESSAGES_IMPORT.aucuneLigne}</Alerte>}
            {groupes.map((groupe) => (
              <Groupe key={groupe.statut} titre={groupe.titre} nombre={groupe.lignes.length}>
                {groupe.lignes.map((ligne) =>
                  fichier.type === "vehicules" ? (
                    <LigneDeVehicule key={ligne.ligne} ligne={ligne as LigneVehicule} />
                  ) : (
                    <LigneDeConducteur key={ligne.ligne} ligne={ligne as LigneConducteur} />
                  ),
                )}
              </Groupe>
            ))}
          </section>
        );
      })}
    </div>
  );
}
