import { Mail } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CadenasPro } from "@/components/CadenasPro";
import { Confirmation } from "@/components/Confirmation";
import { Alerte } from "@/components/ui/Alerte";
import { FONCTIONS_PRO, type Plan } from "@/lib/abonnement/plans";
import type { LibelleGmail } from "@/lib/gmail/composio";
import type { ConnexionGmail } from "@/lib/gmail/connexion";
import { MESSAGES_GMAIL } from "@/lib/gmail/regles";
import { formaterDateAHeure } from "@/lib/format";
import { BoutonStripe } from "../abonnement/BoutonStripe";
import { connecterGmail, deconnecter } from "./actions";
import { ChoixLibelle } from "./ChoixLibelle";

type Props = {
  plan: Plan;
  connexion: ConnexionGmail | null;
  /** Les libellés de la boîte : `null` si Google refuse l'accès, `undefined` s'ils n'ont pas pu être lus. */
  libelles: LibelleGmail[] | null | undefined;
  /** Composio est configuré : sans lui, rien ne se connecte. */
  disponible: boolean;
};

const EXPLICATION = FONCTIONS_PRO.find(({ nom }) => nom === "Relève Gmail")!.explication;

function Ligne({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3">
      <dt className="text-secondary">{libelle}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

/**
 * La relève Gmail, dans l'écran Intégrations : la connexion, le libellé relevé, et ses états (à connecter, libellé à
 * choisir, active, interrompue, en pause en Free).
 */
export function CarteGmail({ plan, connexion, libelles, disponible }: Props) {
  const deconnexion = connexion && (
    <Confirmation
      libelle="Déconnecter Gmail"
      titre="Déconnecter Gmail ?"
      explication="Désigno ne relèvera plus aucun email, et son accès à votre boîte est révoqué. Les avis déjà relevés restent."
      confirmer="Déconnecter"
      enCours="Déconnexion…"
      action={deconnecter}
    />
  );
  const connecter = (libelle: string) => (
    <BoutonStripe
      action={connecterGmail}
      enCours="Ouverture de Google…"
      precision="Sur la page sécurisée de Google : choisissez la boîte où arrivent vos avis."
    >
      {libelle}
    </BoutonStripe>
  );

  const contenu = () => {
    // Retour en Free : la connexion reste, la relève est en pause, sans bandeau.
    if (plan !== "pro") {
      return (
        <>
          <CadenasPro fonction={connexion ? "Relève en pause" : "Relève Gmail"}>
            <p>
              {connexion
                ? `En Free, les emails rangés dans « ${connexion.libelle_nom ?? "votre libellé"} » ne sont plus relevés. La relève reprend seule au passage en Pro, sans rattraper les emails reçus entre-temps.`
                : EXPLICATION}
            </p>
          </CadenasPro>
          {deconnexion && <div>{deconnexion}</div>}
        </>
      );
    }
    if (!connexion) {
      return (
        <>
          <ul className="grid list-disc gap-1 pl-5 text-secondary">
            <li>{MESSAGES_GMAIL.lectureSeule}</li>
            <li>{MESSAGES_GMAIL.delai}</li>
            <li>Chaque pièce jointe PDF, JPG ou PNG devient un avis, lu par l&apos;IA.</li>
          </ul>
          {disponible ? connecter("Connecter Gmail") : <Alerte variante="erreur">{MESSAGES_GMAIL.indisponible}</Alerte>}
        </>
      );
    }

    const interrompue = connexion.interrompue_le !== null || libelles === null;
    return (
      <>
        <dl className="-my-3 divide-y divide-line">
          <Ligne libelle="Boîte">{connexion.email_compte ?? "—"}</Ligne>
          <Ligne libelle="Libellé relevé">{connexion.libelle_nom ? `« ${connexion.libelle_nom} »` : "à choisir"}</Ligne>
          {connexion.interrompue_le ? (
            <Ligne libelle="Relève interrompue depuis le">
              <span className="text-urgent">{formaterDateAHeure(connexion.interrompue_le)}</span>
            </Ligne>
          ) : (
            connexion.active_depuis && (
              <Ligne libelle="Relève active depuis le">{formaterDateAHeure(connexion.active_depuis)}</Ligne>
            )
          )}
        </dl>
        {interrompue ? (
          <>
            {/* Une interruption enregistrée a déjà son bandeau en haut de l'écran : l'alerte ne le répète pas. */}
            {!connexion.interrompue_le && (
              <Alerte variante="erreur">{MESSAGES_GMAIL.bandeau(connexion.libelle_nom)}</Alerte>
            )}
            {disponible && connecter("Reconnecter Gmail")}
          </>
        ) : libelles ? (
          <ChoixLibelle libelles={libelles} actuel={connexion.libelle_id} />
        ) : (
          !connexion.libelle_id && <Alerte variante="erreur">{MESSAGES_GMAIL.indisponible}</Alerte>
        )}
        {connexion.declencheur_id && !interrompue && (
          <p className="text-label text-secondary">
            {MESSAGES_GMAIL.lectureSeule} {MESSAGES_GMAIL.delai} Les emails qui n&apos;ont pas donné d&apos;avis vont
            dans <Link href="/avis/emails-non-exploitables">Emails non exploitables</Link>.
          </p>
        )}
        <div>{deconnexion}</div>
      </>
    );
  };

  return (
    <section aria-labelledby="releve-gmail" className="grid gap-5 rounded-card border border-line p-6 max-md:p-5">
      <div className="flex items-start gap-3">
        <Mail size={16} strokeWidth={1.5} aria-hidden className="mt-1 flex-none text-secondary" />
        <div className="grid gap-1">
          <h2 id="releve-gmail" className="font-semibold">
            Relève Gmail
          </h2>
          <p className="text-label text-secondary">
            Rangez vos avis dans un libellé de votre boîte Gmail&nbsp;: Désigno les relève et les lit pour vous.
          </p>
        </div>
      </div>
      {contenu()}
    </section>
  );
}
