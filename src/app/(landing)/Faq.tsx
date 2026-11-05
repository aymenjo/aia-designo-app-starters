import { ChevronDown } from "lucide-react";
import { LIMITES_FREE } from "@/lib/abonnement/plans";

// Les 4 premières questions sont exigées par le PRD (« Format et support »).
const QUESTIONS: { question: string; reponse: string }[] = [
  {
    question: "Désigno désigne-t-il à ma place ?",
    reponse:
      "Non. Désigno lit l'avis, propose le conducteur et prépare le récap, mais c'est vous qui validez le conducteur et qui désignez sur le site de l'ANTAI. Rien n'est transmis à l'ANTAI ni validé automatiquement.",
  },
  {
    question: "Mes données sont-elles protégées ?",
    reponse:
      "Vos données sont hébergées dans l'Union européenne, en Irlande, et isolées par entreprise. La connexion se fait par un lien à usage unique, sans mot de passe. La lecture des avis et Demande à Désigno passent par le service Claude d'Anthropic, qui peut traiter les données hors de l'Union européenne. Les conversations avec l'agent sont effacées au bout de 30 jours, et la suppression de votre compte efface toutes les données de votre entreprise.",
  },
  {
    question: "Que se passe-t-il si je dépasse le plan Free ?",
    reponse: `Le plan Free compte ${LIMITES_FREE.vehicules} véhicules actifs : l'ajout d'un ${LIMITES_FREE.vehicules + 1}e est refusé. Au-delà de ${LIMITES_FREE.avisParMois} avis dans le mois, l'avis est quand même enregistré, « Verrouillé » : son échéance est calculée et ses alertes partent. La lecture par l'IA, la proposition du conducteur et le récap reviennent le 1er du mois suivant, ou dès le passage en Pro. Rien n'est jamais supprimé.`,
  },
  {
    question: "L'agent peut-il modifier mes données sans mon accord ?",
    reponse:
      "Non. Pour un changement, Demande à Désigno présente un récapitulatif de toutes les modifications prévues. Rien ne s'applique avant votre clic sur « Confirmer », et tout s'applique ou rien. L'agent n'a aucun outil pour désigner, classer un avis, supprimer quoi que ce soit ou écrire à quelqu'un.",
  },
  {
    question: "Comment Désigno sait-il qui conduisait ?",
    reponse:
      "Grâce aux affectations : qui conduit quel véhicule, et de quand à quand. Vous les saisissez dans le planning, ou les importez d'un fichier CSV. Sans affectation à la date de l'infraction, Désigno vous montre le conducteur d'avant et celui d'après, et vous choisissez.",
  },
  {
    question: "Puis-je arrêter le Pro quand je veux ?",
    reponse:
      "Oui, depuis le portail client, sans contacter personne. L'annulation prend effet à la fin de la période payée, puis vous retrouvez le plan Free sans perdre aucune donnée.",
  },
];

/** Questions fréquentes : `<details>` natifs, accessibles au clavier et sans JS. */
export function Faq() {
  return (
    <div className="grid gap-3">
      {QUESTIONS.map(({ question, reponse }) => (
        <details key={question} className="group rounded-card border border-line bg-white">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-card px-6 py-4 text-lead font-semibold max-md:px-5 [&::-webkit-details-marker]:hidden">
            {question}
            <ChevronDown
              size={16}
              strokeWidth={1.5}
              aria-hidden
              className="flex-none transition-transform duration-200 ease-enter group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <p className="max-w-[720px] px-6 pb-5 text-secondary max-md:px-5">{reponse}</p>
        </details>
      ))}
    </div>
  );
}
