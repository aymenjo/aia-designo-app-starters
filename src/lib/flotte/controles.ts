import { MESSAGES, nomAbrege, nomComplet, type TypeVehicule } from "./regles";

// Les contrôles d'écriture de la flotte qui portent sur l'état de la base (archivage, lecture seule, unicité,
// chevauchement), définis une seule fois. Purs : les écritures des écrans les appellent sur ce qu'elles viennent de lire,
// et le récapitulatif de l'agent (phase 29) sur l'état simulé après les lignes précédentes. Chacun renvoie le message
// des écrans, ou `null` si l'écriture passe. Les contraintes en base (unicités, chevauchement) restent le filet.

type VehiculeControle = { plaque: string; archive_le: string | null; lecture_seule_le: string | null };
type ConducteurControle = { prenom: string; nom: string; archive_le: string | null };
type Personne = { prenom: string; nom: string };
type Creneau = { debut: string; fin: string | null };

/** Le véhicule choisi pour une affectation : ni introuvable, ni archivé, ni en lecture seule (retour en Free). */
export function refusVehiculeAffectation(vehicule: VehiculeControle | null): string | null {
  if (!vehicule) return MESSAGES.vehiculeIntrouvable;
  if (vehicule.archive_le) return MESSAGES.vehiculeArchiveAffectation(vehicule.plaque);
  if (vehicule.lecture_seule_le) return MESSAGES.affectationLectureSeule(vehicule.plaque);
  return null;
}

/** Le conducteur choisi pour une affectation : ni introuvable, ni archivé. */
export function refusConducteurAffectation(conducteur: ConducteurControle | null): string | null {
  if (!conducteur) return MESSAGES.conducteurIntrouvable;
  if (conducteur.archive_le) return MESSAGES.conducteurArchiveAffectation(nomComplet(conducteur));
  return null;
}

/**
 * L'affectation à modifier ou à clôturer : elle reste en lecture seule tant que son véhicule ou son conducteur est
 * archivé. Sur un véhicule en lecture seule (retour en Free), elle se clôture encore, mais ne se modifie plus.
 */
export function refusAffectationModifiable(
  affectation: { vehicule: VehiculeControle; conducteur: { archive_le: string | null } } | null,
  { cloture = false }: { cloture?: boolean } = {},
): string | null {
  if (!affectation) return MESSAGES.affectationIntrouvable;
  if (affectation.vehicule.archive_le || affectation.conducteur.archive_le) return MESSAGES.affectationArchivee;
  if (affectation.vehicule.lecture_seule_le && !cloture) return MESSAGES.affectationLectureSeule(affectation.vehicule.plaque);
  return null;
}

/** Une affectation déjà clôturée se modifie, elle ne se reclôture pas. */
export function refusCloture(affectation: { fin: string | null }): string | null {
  return affectation.fin ? MESSAGES.affectationDejaCloturee : null;
}

/** Un véhicule ou un conducteur qui a encore une affectation ouverte (sans fin) ne s'archive pas. */
export function refusArchivage(ouverte: { conducteur: Personne; vehicule: { plaque: string } } | null): string | null {
  return ouverte ? MESSAGES.affectationEnCours(nomAbrege(ouverte.conducteur), ouverte.vehicule.plaque) : null;
}

/** Un véhicule de pool n'a que des affectations avec une fin : il ne passe pas en pool avec une affectation ouverte. */
export function refusPassagePool(type: TypeVehicule, ouverte: { conducteur: Personne } | null): string | null {
  return type === "pool" && ouverte ? MESSAGES.poolAvecAffectationOuverte(nomAbrege(ouverte.conducteur)) : null;
}

/** Un véhicule en lecture seule (retour en Free) ne se modifie plus : il s'archive, ou se rend actif. */
export function refusModificationVehicule(vehicule: { lecture_seule_le: string | null }): string | null {
  return vehicule.lecture_seule_le ? MESSAGES.vehiculeLectureSeule : null;
}

/** Une fiche archivée ne se modifie plus : elle se réactive d'abord. */
export function refusFicheArchivee(
  fiche: ({ plaque: string } | Personne) & { archive_le: string | null },
): string | null {
  if (!fiche.archive_le) return null;
  return "plaque" in fiche
    ? MESSAGES.vehiculeArchiveModification(fiche.plaque)
    : MESSAGES.conducteurArchiveModification(nomComplet(fiche));
}

/** Archiver une fiche déjà archivée ne change rien. */
export function refusDejaArchivee(fiche: ({ plaque: string } | Personne) & { archive_le: string | null }): string | null {
  if (!fiche.archive_le) return null;
  return "plaque" in fiche ? MESSAGES.vehiculeDejaArchive(fiche.plaque) : MESSAGES.conducteurDejaArchive(nomComplet(fiche));
}

/** La plaque est déjà celle d'un véhicule de la flotte, archivé compris. */
export function refusPlaque(plaque: string, existant: { archive_le: string | null } | null): string | null {
  if (!existant) return null;
  return existant.archive_le ? MESSAGES.plaqueArchivee(plaque) : MESSAGES.plaqueDejaPresente(plaque);
}

/** Le n° de permis ou l'email est déjà celui d'un conducteur, archivé compris. */
export function refusUnicite(champ: "permis_numero" | "email", existant: ConducteurControle | null): string | null {
  if (!existant) return null;
  const nom = nomComplet(existant);
  if (existant.archive_le) return champ === "email" ? MESSAGES.emailArchive(nom) : MESSAGES.permisArchive(nom);
  return champ === "email" ? MESSAGES.emailDejaPresent(nom) : MESSAGES.permisDejaPresent(nom);
}

const borne = (fin: string | null) => (fin ? Date.parse(fin) : Infinity);

/**
 * Comme la contrainte d'exclusion, sur `[debut, fin)` : deux affectations bout à bout ne se chevauchent pas, et une fin
 * vide vaut l'infini. Les instants se comparent en millisecondes, jamais en chaînes (« Z » et « +00:00 »).
 */
export function chevauche(a: Creneau, b: Creneau): boolean {
  return Date.parse(a.debut) < borne(b.fin) && Date.parse(b.debut) < borne(a.fin);
}

/** La première affectation, par début, qui chevauche le créneau : celle que le message de conflit nomme. */
export function premierConflit<T extends Creneau>(creneau: Creneau, autres: readonly T[]): T | null {
  const conflits = autres.filter((autre) => chevauche(creneau, autre));
  return conflits.toSorted((a, b) => Date.parse(a.debut) - Date.parse(b.debut))[0] ?? null;
}

/** « Conflit avec : Karim B. sur AB-123-CD du 03/03 08:00 au 03/03 18:00. » */
export function messageConflit(conflit: Creneau & { conducteur: Personne }, plaque: string): string {
  return MESSAGES.conflitAffectation(nomAbrege(conflit.conducteur), plaque, conflit.debut, conflit.fin);
}
