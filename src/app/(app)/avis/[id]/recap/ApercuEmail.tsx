import { Plaque } from "@/components/Plaque";
import type { ContenuEmailConducteur } from "@/lib/avis/email-conducteur";

const META = "font-mono text-meta font-medium text-secondary uppercase";

/**
 * L'aperçu de l'email au conducteur, tel qu'il partira au clic : les en-têtes, puis le corps. Le même contenu que
 * l'email envoyé (`contenuEmailConducteur`), en texte : ni lien ni pièce jointe.
 */
export function ApercuEmail({ contenu }: { contenu: ContenuEmailConducteur }) {
  const entetes = [
    { libelle: "À", valeur: contenu.a },
    { libelle: "Répondre à", valeur: contenu.repondreA },
    { libelle: "Objet", valeur: contenu.sujet },
  ];

  return (
    <section aria-label="Aperçu de l'email" className="grid gap-4 rounded-card border border-line p-5 max-md:p-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5">
        {entetes.map(({ libelle, valeur }) => (
          <div key={libelle} className="contents">
            <dt className={META}>{libelle}</dt>
            <dd className="wrap-anywhere">{valeur}</dd>
          </div>
        ))}
      </dl>
      <hr className="border-line" />
      <div className="grid gap-3">
        <p>{contenu.salutation}</p>
        {contenu.paragraphes.map((paragraphe) => (
          <p key={paragraphe}>{paragraphe}</p>
        ))}
        <dl className="divide-y divide-line border-y border-line">
          {contenu.faits.map((fait) => (
            <div key={fait.libelle} className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-4 py-2.5 max-sm:grid-cols-1 max-sm:gap-1">
              <dt className="text-label text-secondary">{fait.libelle}</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {fait.plaque && <Plaque plaque={fait.plaque} />}
                {fait.plaque && fait.valeur && <span aria-hidden>·</span>}
                {fait.valeur && <span className="whitespace-pre-line">{fait.valeur}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p>{contenu.question}</p>
        <p className="text-label text-secondary">{contenu.pied}</p>
      </div>
    </section>
  );
}
