import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { echeanceDepassee, joursRestants } from "@/lib/avis/echeance";
import { trierPourSuivi } from "@/lib/avis/liste";
import {
  LIBELLES_MOTIF_CLASSEMENT,
  LIBELLES_STATUT,
  MESSAGES_AVIS,
  estOuvert,
  normaliserNumeroAvis,
  type Confiances,
  type MotifClassement,
  type StatutAvis,
} from "@/lib/avis/regles";
import { ajouterJours, aujourdhuiParis, depuisIso, instantParis, partiesParis } from "@/lib/dates";
import { lireFiche } from "@/lib/entreprise/fiche";
import {
  COLONNES_AFFECTATION_DETAILLEE,
  affectationCouvrante,
  affectationsVoisines,
  lireAffectations,
  type AffectationDetaillee,
} from "@/lib/flotte/affectations";
import { COLONNES_CONDUCTEUR, type Conducteur } from "@/lib/flotte/conducteurs";
import { lireInstantane } from "@/lib/flotte/recapitulatif";
import {
  LIBELLES_CHAMP_CONDUCTEUR,
  LIBELLES_CIVILITE,
  LIBELLES_TYPE,
  MESSAGES as MESSAGES_FLOTTE,
  champsManquantsConducteur,
  nomComplet,
} from "@/lib/flotte/regles";
import {
  MESSAGES_RECAPITULATIF,
  ciblesDesEntrees,
  lignesImpossibles,
  preparerRecapitulatif,
  texteLigne,
  type LigneRecapitulatif,
  type Motif,
  type StatutRecapitulatif,
} from "@/lib/flotte/regles-recapitulatif";
import { COLONNES_VEHICULE, type Vehicule } from "@/lib/flotte/vehicules";
import { formaterDate, formaterDateHeure, formaterMontant } from "@/lib/format";
import { toutLire } from "@/lib/supabase/lecture";
import { blocagesAvis, type ConducteurBlocages } from "./blocages";
import { cleElement, lienAffectation, lienElement, type TypeElement } from "./citations";
import { ENTREES_OUTILS, type NomOutil } from "./definition";

// Les outils de l'agent (phase 26) : chacun lit la flotte, le planning ou les avis sous la session du gestionnaire
// (RLS), archivés compris, et renvoie des valeurs déjà formatées (JJ/MM/AAAA, 24 h, « 135,00 € »). Chaque élément porte
// son `lien`, que l'agent recopie pour le citer ; il entre alors dans les éléments connus de la conversation, seuls à
// rester des liens dans la réponse (citations.ts). Aucun outil n'écrit dans la flotte : `proposer_modifications`
// (phase 29) vérifie les lignes, puis enregistre un récapitulatif, que seul le gestionnaire applique.

export type ContexteOutils = {
  /** Le client porteur du jeton du gestionnaire : la RLS ne laisse voir que son entreprise. */
  supabase: SupabaseClient;
  maintenant: Date;
  /** Les éléments renvoyés pendant la conversation (« avis:<id> »…) : chaque outil y ajoute les siens. */
  connus: Set<string>;
  /**
   * Enregistre le récapitulatif de la conversation en cours (src/lib/agent/recapitulatifs.ts), avec la clé secrète.
   * Absent, `proposer_modifications` est indisponible ; l'évaluation y passe une capture.
   */
  enregistrerRecapitulatif?: (lignes: LigneRecapitulatif[]) => Promise<{ id: string; statut: StatutRecapitulatif }>;
};

/** Au-delà, une liste est tronquée : l'agent le dit, et peut affiner sa recherche. */
const MAX_LIGNES = 50;

class Introuvable extends Error {}

/** Une proposition mal formée (phase 30) : rien n'est enregistré, et l'agent reçoit le motif de chaque ligne en cause. */
class RefusOutil extends Error {
  constructor(readonly motifs: readonly Motif[]) {
    super(MESSAGES_RECAPITULATIF.refusOutil);
  }
}

type Reponse<T> = { data: T | null; error: { code: string; message: string } | null };

/** Les lignes d'une lecture, ou son erreur levée. */
function lignes<T>({ data, error }: Reponse<T[]>, quoi: string): T[] {
  if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
  return data ?? [];
}

/** La ligne d'une lecture, `null` s'il n'y en a pas, ou son erreur levée. */
function ligne<T>({ data, error }: Reponse<T>, quoi: string): T | null {
  if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
  return data;
}

/** La référence d'un élément, que l'agent cite par son lien. */
function reference(ctx: ContexteOutils, type: TypeElement, id: string) {
  ctx.connus.add(cleElement(type, id));
  return lienElement(type, id);
}

function refVehicule(ctx: ContexteOutils, vehicule: Pick<Vehicule, "id" | "plaque">) {
  return { id: vehicule.id, plaque: vehicule.plaque, lien: reference(ctx, "vehicule", vehicule.id) };
}

function refConducteur(ctx: ContexteOutils, conducteur: Pick<Conducteur, "id" | "prenom" | "nom" | "archive_le">) {
  return {
    id: conducteur.id,
    nom: nomComplet(conducteur),
    ...(conducteur.archive_le && { archive_le: formaterDate(conducteur.archive_le) }),
    lien: reference(ctx, "conducteur", conducteur.id),
  };
}

function etatVehicule(vehicule: Pick<Vehicule, "archive_le" | "lecture_seule_le">) {
  if (vehicule.archive_le) return `archivé le ${formaterDate(vehicule.archive_le)}`;
  if (vehicule.lecture_seule_le) return "en lecture seule (plan Free)";
  return "actif";
}

/** Le jour de Paris où l'affectation entre dans la période : le planning s'ouvre sur cette semaine-là. */
function refAffectation(ctx: ContexteOutils, affectation: AffectationDetaillee, depuis?: string) {
  const debut = partiesParis(affectation.debut).date;
  const date = depuis && depuis > debut ? depuis : debut;
  reference(ctx, "vehicule", affectation.vehicule_id);
  return {
    id: affectation.id,
    vehicule: refVehicule(ctx, affectation.vehicule),
    type_vehicule: LIBELLES_TYPE[affectation.vehicule.type],
    conducteur: refConducteur(ctx, affectation.conducteur),
    debut: formaterDateHeure(affectation.debut),
    fin: affectation.fin ? formaterDateHeure(affectation.fin) : "sans fin",
    lien: lienAffectation(affectation.vehicule_id, date),
  };
}

/** Une comparaison sans casse, accents, espaces ni tirets : « ab123 » trouve AB-123-CD, « lea » trouve Léa. */
function cle(texte: string) {
  return texte
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\s.-]+/g, "")
    .toLowerCase();
}

/** Les affectations en cours à cet instant, pour des véhicules ou des conducteurs. */
async function affectationsEnCours(
  ctx: ContexteOutils,
  colonne: "vehicule_id" | "conducteur_id",
  ids: readonly string[],
): Promise<AffectationDetaillee[]> {
  if (!ids.length) return [];
  const instant = ctx.maintenant.toISOString();
  const reponse = await ctx.supabase
    .from("affectation")
    .select(COLONNES_AFFECTATION_DETAILLEE)
    .in(colonne, ids)
    .lte("debut", instant)
    .or(`fin.is.null,fin.gt."${instant}"`)
    .order("debut")
    .overrideTypes<AffectationDetaillee[], { merge: false }>();
  return lignes(reponse, "affectations en cours");
}

function enCours(ctx: ContexteOutils, affectation: AffectationDetaillee) {
  return {
    ...refAffectation(ctx, affectation, aujourdhuiParis(ctx.maintenant)),
    depuis: formaterDateHeure(affectation.debut),
    jusqu_au: affectation.fin ? formaterDateHeure(affectation.fin) : "sans fin",
  };
}

function tronque(total: number) {
  return total > MAX_LIGNES ? { tronque: `Seuls les ${MAX_LIGNES} premiers sur ${total} sont donnés : affinez la recherche.` } : {};
}

// Véhicules et conducteurs

async function chercherVehicules(
  ctx: ContexteOutils,
  { texte, inclure_archives }: z.output<(typeof ENTREES_OUTILS)["chercher_vehicules"]>,
) {
  let requete = ctx.supabase.from("vehicule").select(COLONNES_VEHICULE).order("plaque");
  if (!inclure_archives) requete = requete.is("archive_le", null);
  const vehicules = lignes(await requete.overrideTypes<Vehicule[], { merge: false }>(), "véhicules");
  const filtre = cle(texte ?? "");
  const trouves = vehicules.filter((v) => !filtre || cle(v.plaque).includes(filtre) || cle(v.modele ?? "").includes(filtre));
  const affiches = trouves.slice(0, MAX_LIGNES);
  const encours = await affectationsEnCours(
    ctx,
    "vehicule_id",
    affiches.map(({ id }) => id),
  );

  return {
    total: trouves.length,
    ...tronque(trouves.length),
    vehicules: affiches.map((vehicule) => {
      const affectation = encours.find(({ vehicule_id }) => vehicule_id === vehicule.id);
      return {
        ...refVehicule(ctx, vehicule),
        modele: vehicule.modele,
        type: LIBELLES_TYPE[vehicule.type],
        etat: etatVehicule(vehicule),
        affectation_en_cours: affectation ? enCours(ctx, affectation) : null,
      };
    }),
  };
}

async function chercherConducteurs(
  ctx: ContexteOutils,
  { texte, inclure_archives }: z.output<(typeof ENTREES_OUTILS)["chercher_conducteurs"]>,
) {
  let requete = ctx.supabase.from("conducteur").select(COLONNES_CONDUCTEUR).order("nom").order("prenom");
  if (!inclure_archives) requete = requete.is("archive_le", null);
  const conducteurs = lignes(await requete.overrideTypes<Conducteur[], { merge: false }>(), "conducteurs");
  const filtre = cle(texte ?? "");
  const trouves = conducteurs.filter(
    (c) =>
      !filtre ||
      cle(`${c.prenom}${c.nom}`).includes(filtre) ||
      cle(`${c.nom}${c.prenom}`).includes(filtre) ||
      cle(c.email ?? "").includes(filtre),
  );
  const affiches = trouves.slice(0, MAX_LIGNES);
  const encours = await affectationsEnCours(
    ctx,
    "conducteur_id",
    affiches.map(({ id }) => id),
  );

  return {
    total: trouves.length,
    ...tronque(trouves.length),
    conducteurs: affiches.map((conducteur) => {
      const manquants = champsManquantsConducteur(conducteur);
      return {
        ...refConducteur(ctx, conducteur),
        email: conducteur.email,
        etat: conducteur.archive_le ? `archivé le ${formaterDate(conducteur.archive_le)}` : "actif",
        fiche: manquants.length ? "incomplète" : "complète",
        champs_manquants: manquants.map((champ) => LIBELLES_CHAMP_CONDUCTEUR[champ]),
        affectations_en_cours: encours
          .filter(({ conducteur_id }) => conducteur_id === conducteur.id)
          .map((affectation) => enCours(ctx, affectation)),
      };
    }),
  };
}

async function ficheConducteur(
  ctx: ContexteOutils,
  { conducteur_id }: z.output<(typeof ENTREES_OUTILS)["fiche_conducteur"]>,
) {
  const conducteur = ligne(
    await ctx.supabase.from("conducteur").select(COLONNES_CONDUCTEUR).eq("id", conducteur_id).maybeSingle<Conducteur>(),
    "conducteur",
  );
  if (!conducteur) throw new Introuvable(MESSAGES_FLOTTE.conducteurIntrouvable);
  const manquants = champsManquantsConducteur(conducteur);
  const adresse = [conducteur.adresse, conducteur.adresse_complement, [conducteur.code_postal, conducteur.ville].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return {
    ...refConducteur(ctx, conducteur),
    civilite: conducteur.civilite ? LIBELLES_CIVILITE[conducteur.civilite] : null,
    prenom: conducteur.prenom,
    nom_de_famille: conducteur.nom,
    date_naissance: conducteur.date_naissance ? depuisIso(conducteur.date_naissance) : null,
    lieu_naissance: conducteur.lieu_naissance,
    adresse: adresse || null,
    permis_numero: conducteur.permis_numero,
    permis_delivre_le: conducteur.permis_delivre_le ? depuisIso(conducteur.permis_delivre_le) : null,
    permis_categories: conducteur.permis_categories?.join(", ") || null,
    email: conducteur.email,
    etat: conducteur.archive_le ? `archivé le ${formaterDate(conducteur.archive_le)}` : "actif",
    fiche: manquants.length ? "incomplète" : "complète",
    champs_manquants: manquants.map((champ) => LIBELLES_CHAMP_CONDUCTEUR[champ]),
  };
}

// Affectations

/** De 00:00 à Paris le premier jour à 00:00 le lendemain du dernier. */
function periodeParis(du: string | undefined, au: string | undefined) {
  if (!du && !au) return undefined;
  return {
    debut: instantParis(du ?? "1900-01-01", "00:00")!,
    fin: instantParis(ajouterJours(au ?? "2999-12-31", 1), "00:00")!,
  };
}

async function listerAffectations(
  ctx: ContexteOutils,
  { vehicule_id, conducteur_id, du, au }: z.output<(typeof ENTREES_OUTILS)["lister_affectations"]>,
) {
  if (du && au && du > au) throw new Introuvable("Le premier jour de la période suit le dernier.");
  const affectations = lignes(await lireAffectations(ctx.supabase, { vehicule_id, conducteur_id }, periodeParis(du, au)), "affectations");
  const instant = ctx.maintenant.getTime();
  return {
    total: affectations.length,
    ...tronque(affectations.length),
    affectations: affectations.slice(0, MAX_LIGNES).map((affectation) => ({
      ...refAffectation(ctx, affectation, du),
      en_cours: Date.parse(affectation.debut) <= instant && (!affectation.fin || Date.parse(affectation.fin) > instant),
    })),
  };
}

async function conducteurAuMoment(
  ctx: ContexteOutils,
  { vehicule_id, date, heure }: z.output<(typeof ENTREES_OUTILS)["conducteur_au_moment"]>,
) {
  const vehicule = ligne(
    await ctx.supabase.from("vehicule").select(COLONNES_VEHICULE).eq("id", vehicule_id).maybeSingle<Vehicule>(),
    "véhicule",
  );
  if (!vehicule) throw new Introuvable(MESSAGES_FLOTTE.vehiculeIntrouvable);
  const ref = { ...refVehicule(ctx, vehicule), type: LIBELLES_TYPE[vehicule.type], etat: etatVehicule(vehicule) };
  const planning = lienAffectation(vehicule.id, date);
  const jour = depuisIso(date);

  if (heure) {
    const instant = instantParis(date, heure);
    if (!instant) throw new Introuvable(MESSAGES_FLOTTE.heureInexistante);
    const couvrante = ligne(await affectationCouvrante(ctx.supabase, vehicule.id, instant), "affectation");
    if (couvrante) {
      return { moment: `${jour} ${heure}`, vehicule: ref, affectation: { ...refAffectation(ctx, couvrante), lien: planning } };
    }
    const voisines = ligne(await affectationsVoisines(ctx.supabase, vehicule.id, instant), "affectations voisines")!;
    return {
      moment: `${jour} ${heure}`,
      vehicule: ref,
      affectation: null,
      message: `Aucune affectation sur ${vehicule.plaque} le ${jour} à ${heure}.`,
      avant: voisines.avant && refAffectation(ctx, voisines.avant),
      apres: voisines.apres && refAffectation(ctx, voisines.apres),
      planning,
    };
  }

  const journee = periodeParis(date, date)!;
  const affectations = lignes(await lireAffectations(ctx.supabase, { vehicule_id: vehicule.id }, journee), "affectations");
  if (affectations.length) {
    return {
      jour,
      vehicule: ref,
      affectations: affectations.toReversed().map((affectation) => ({ ...refAffectation(ctx, affectation), lien: planning })),
    };
  }
  const voisines = ligne(await affectationsVoisines(ctx.supabase, vehicule.id, journee.debut), "affectations voisines")!;
  return {
    jour,
    vehicule: ref,
    affectations: [],
    message: `Aucune affectation sur ${vehicule.plaque} le ${jour}.`,
    avant: voisines.avant && refAffectation(ctx, voisines.avant),
    apres: voisines.apres && refAffectation(ctx, voisines.apres),
    planning,
  };
}

// Avis

type AvisLu = {
  id: string;
  numero: string | null;
  plaque: string | null;
  vehicule_id: string | null;
  infraction_le: string | null;
  lieu: string | null;
  infraction: string | null;
  montant_centimes: number | null;
  date_envoi: string | null;
  echeance: string | null;
  statut: StatutAvis;
  depose_le: string;
  confiances: Confiances;
  conducteur_id: string | null;
  designe_le: string | null;
  conducteur_prevenu_le: string | null;
  classe_le: string | null;
  motif_classement: MotifClassement | null;
  motif_libre: string | null;
  verrouille: boolean;
  vehicule_lecture_seule: boolean;
  vehicule: Pick<Vehicule, "id" | "plaque"> | null;
  conducteur: Conducteur | null;
};

const COLONNES_AVIS_AGENT = `id, numero, plaque, vehicule_id, infraction_le, lieu, infraction, montant_centimes, date_envoi,
  echeance, statut, depose_le, confiances, conducteur_id, designe_le, conducteur_prevenu_le, classe_le, motif_classement,
  motif_libre, verrouille, vehicule_lecture_seule,
  vehicule:vehicule!avis_vehicule_fk(id, plaque),
  conducteur:conducteur!avis_conducteur_fk(${COLONNES_CONDUCTEUR})`;

type AffectationAvecFiche = { vehicule_id: string; debut: string; fin: string | null; conducteur: Conducteur };

/** Les affectations des véhicules, avec la fiche de leur conducteur : elles donnent le conducteur proposé d'un avis. */
async function affectationsDesVehicules(ctx: ContexteOutils, vehicules: readonly string[]) {
  if (!vehicules.length) return [];
  return toutLire<AffectationAvecFiche>(
    (debut, fin) =>
      ctx.supabase
        .from("affectation")
        .select(`id, vehicule_id, debut, fin, conducteur:conducteur!affectation_conducteur_fk(${COLONNES_CONDUCTEUR})`)
        .in("vehicule_id", vehicules)
        .order("id")
        .range(debut, fin)
        .overrideTypes<AffectationAvecFiche[], { merge: false }>(),
    "affectations des avis",
  );
}

/** Comme `affectationCouvrante`, sur `[debut, fin)`. */
function couvre({ debut, fin }: { debut: string; fin: string | null }, instant: string) {
  const t = Date.parse(instant);
  return Date.parse(debut) <= t && (!fin || Date.parse(fin) > t);
}

async function listerAvis(ctx: ContexteOutils, filtres: z.output<(typeof ENTREES_OUTILS)["lister_avis"]>) {
  const { statut, vehicule_id, conducteur_id, numero, avis_id, bloques_seulement, infraction_du, infraction_au, echeance_au } =
    filtres;
  if (infraction_du && infraction_au && infraction_du > infraction_au) {
    throw new Introuvable("Le premier jour de la période suit le dernier.");
  }
  const numeroNormalise = numero ? normaliserNumeroAvis(numero) : null;
  if (numero && !numeroNormalise) throw new Introuvable(MESSAGES_AVIS.numeroMalForme);

  const avis = await toutLire<AvisLu>((debut, fin) => {
    let requete = ctx.supabase.from("avis").select(COLONNES_AVIS_AGENT);
    if (statut) requete = requete.eq("statut", statut);
    if (vehicule_id) requete = requete.eq("vehicule_id", vehicule_id);
    if (conducteur_id) requete = requete.eq("conducteur_id", conducteur_id);
    if (numeroNormalise) requete = requete.eq("numero", numeroNormalise);
    if (avis_id) requete = requete.eq("id", avis_id);
    if (infraction_du) requete = requete.gte("infraction_le", instantParis(infraction_du, "00:00")!);
    if (infraction_au) requete = requete.lt("infraction_le", instantParis(ajouterJours(infraction_au, 1), "00:00")!);
    if (echeance_au) requete = requete.lte("echeance", echeance_au);
    return requete.order("id").range(debut, fin).overrideTypes<AvisLu[], { merge: false }>();
  }, "avis");

  // Le conducteur proposé d'un avis « À valider » sans conducteur validé : celui de l'affectation qui couvre l'infraction.
  const aProposer = avis.filter((a) => a.statut === "a_valider" && a.vehicule_id && !a.conducteur_id && a.infraction_le);
  const [affectations, entreprise] = await Promise.all([
    affectationsDesVehicules(ctx, [...new Set(aProposer.map((a) => a.vehicule_id!))]),
    avis.some((a) => estOuvert(a.statut)) ? lireFiche(ctx.supabase) : null,
  ]);
  const propose = (a: AvisLu): Conducteur | null =>
    aProposer.includes(a)
      ? (affectations.find((af) => af.vehicule_id === a.vehicule_id && couvre(af, a.infraction_le!))?.conducteur ?? null)
      : null;

  const aujourdhui = aujourdhuiParis(ctx.maintenant);
  const lignes = trierPourSuivi(avis).map((a) => {
    const conducteurPropose = propose(a);
    const blocages = entreprise
      ? blocagesAvis({
          avis: a,
          conducteurValide: a.conducteur as ConducteurBlocages | null,
          conducteurPropose,
          entreprise,
        })
      : [];
    return { a, conducteurPropose, blocages };
  });
  const retenues = bloques_seulement ? lignes.filter(({ blocages }) => blocages.length) : lignes;
  const montantTotal = retenues.reduce((somme, { a }) => somme + (a.montant_centimes ?? 0), 0);

  return {
    total: retenues.length,
    montant_total: formaterMontant(montantTotal),
    ...tronque(retenues.length),
    avis: retenues.slice(0, MAX_LIGNES).map(({ a, conducteurPropose, blocages }) => {
      const ouvert = estOuvert(a.statut);
      const jours = ouvert && a.echeance ? joursRestants(a.echeance, aujourdhui) : null;
      return {
        id: a.id,
        numero: a.numero,
        statut: LIBELLES_STATUT[a.statut],
        plaque: a.plaque,
        vehicule: a.vehicule ? refVehicule(ctx, a.vehicule) : null,
        vehicule_inconnu: ouvert && Boolean(a.plaque) && !a.vehicule_id,
        infraction_le: a.infraction_le ? formaterDateHeure(a.infraction_le) : null,
        lieu: a.lieu,
        infraction: a.infraction,
        montant: a.montant_centimes ? formaterMontant(a.montant_centimes) : null,
        date_envoi: a.date_envoi ? depuisIso(a.date_envoi) : null,
        echeance: a.echeance ? depuisIso(a.echeance) : null,
        jours_restants: jours === null ? null : jours >= 0 ? `J-${jours}` : `J+${-jours}`,
        echeance_depassee: echeanceDepassee(a, aujourdhui),
        conducteur_valide: a.conducteur ? refConducteur(ctx, a.conducteur) : null,
        ...(conducteurPropose && { conducteur_propose: refConducteur(ctx, conducteurPropose) }),
        designe_le: a.designe_le ? formaterDate(a.designe_le) : null,
        ...(a.conducteur_prevenu_le && { conducteur_prevenu_par_email: true }),
        classe_le: a.classe_le ? formaterDate(a.classe_le) : null,
        motif_classement: a.motif_classement
          ? a.motif_classement === "autre" && a.motif_libre
            ? a.motif_libre
            : LIBELLES_MOTIF_CLASSEMENT[a.motif_classement]
          : null,
        blocages,
        lien: reference(ctx, "avis", a.id),
      };
    }),
  };
}

// Les modifications (phase 29)

/**
 * Prépare le récapitulatif : chaque ligne passe par les règles des écrans, sur la flotte simulée après les précédentes.
 * Il remplace le précédent de la conversation, et s'affiche sous la réponse, avec « Confirmer », « Modifier » et
 * « Annuler ». Une ligne que les règles des écrans refusent s'enregistre en rouge, avec leur motif, et « Confirmer »
 * reste désactivé (phase 30) : l'agent reçoit les motifs, pour se corriger ou demander comment. Une proposition mal
 * formée n'est pas enregistrée : l'agent reçoit le motif de chaque ligne en cause.
 */
async function proposerModifications(
  ctx: ContexteOutils,
  { modifications }: z.output<(typeof ENTREES_OUTILS)["proposer_modifications"]>,
) {
  if (!ctx.enregistrerRecapitulatif) throw new Introuvable(MESSAGES_RECAPITULATIF.nonEnregistre);
  const preparation = preparerRecapitulatif(await lireInstantane(ctx.supabase, ciblesDesEntrees(modifications)), modifications);
  if (!preparation.ok) throw new RefusOutil(preparation.motifs);

  const enregistre = await ctx.enregistrerRecapitulatif(preparation.lignes);
  if (enregistre.statut !== "propose") throw new Introuvable(MESSAGES_RECAPITULATIF.nonEnregistre);

  // Les éléments nommés par les lignes, que l'agent peut citer.
  const elements = new Map<string, { nom: string; lien: string }>();
  for (const { affichage } of preparation.lignes) {
    const changes = "apres" in affichage ? affichage.apres : undefined;
    for (const vehicule of [affichage.vehicule, changes?.vehicule]) {
      if (vehicule && "id" in vehicule.ref) {
        elements.set(vehicule.ref.id, { nom: vehicule.plaque, lien: reference(ctx, "vehicule", vehicule.ref.id) });
      }
    }
    for (const personne of [affichage.conducteur, changes?.conducteur]) {
      if (personne && "id" in personne.ref) {
        elements.set(personne.ref.id, { nom: personne.nom, lien: reference(ctx, "conducteur", personne.ref.id) });
      }
    }
  }
  const impossibles = lignesImpossibles(preparation.lignes);
  return {
    recapitulatif: impossibles.length
      ? "enregistré, avec des lignes impossibles : « Confirmer » est désactivé"
      : "enregistré, en attente de « Confirmer »",
    lignes: preparation.lignes.map((ligne, rang) => `${rang + 1}. ${texteLigne(ligne)}`),
    ...(impossibles.length ? { lignes_impossibles: impossibles } : {}),
    elements: [...elements.values()],
    consigne: impossibles.length ? MESSAGES_RECAPITULATIF.proposeImpossible : MESSAGES_RECAPITULATIF.propose,
  };
}

// Le registre

type Executeur<N extends NomOutil> = (ctx: ContexteOutils, entree: z.output<(typeof ENTREES_OUTILS)[N]>) => Promise<unknown>;

const EXECUTEURS: { [N in NomOutil]: Executeur<N> } = {
  chercher_vehicules: chercherVehicules,
  chercher_conducteurs: chercherConducteurs,
  fiche_conducteur: ficheConducteur,
  lister_affectations: listerAffectations,
  conducteur_au_moment: conducteurAuMoment,
  lister_avis: listerAvis,
  proposer_modifications: proposerModifications,
};

function estNomOutil(nom: string): nom is NomOutil {
  return Object.hasOwn(EXECUTEURS, nom);
}

/**
 * Exécute un appel d'outil de l'agent : l'entrée est vérifiée, puis l'outil lit sous la session du gestionnaire. Le
 * résultat part chez Anthropic en JSON ; une entrée refusée, un élément introuvable ou une panne reviennent en erreur,
 * que l'agent lit et dont il tient compte.
 */
export async function executerOutil(
  ctx: ContexteOutils,
  nom: string,
  entree: unknown,
): Promise<{ contenu: string; erreur: boolean }> {
  if (!estNomOutil(nom)) return { contenu: JSON.stringify({ erreur: `Outil inconnu : ${nom}.` }), erreur: true };
  const valide = ENTREES_OUTILS[nom].safeParse(entree);
  if (!valide.success) {
    const details = valide.error.issues.map(({ path, message }) => `${path.join(".") || "entrée"} : ${message}`);
    return { contenu: JSON.stringify({ erreur: "Entrée refusée.", details }), erreur: true };
  }
  try {
    const executer = EXECUTEURS[nom] as Executeur<NomOutil>;
    return { contenu: JSON.stringify(await executer(ctx, valide.data as never)), erreur: false };
  } catch (erreur) {
    if (erreur instanceof Introuvable) return { contenu: JSON.stringify({ erreur: erreur.message }), erreur: true };
    if (erreur instanceof RefusOutil) {
      return { contenu: JSON.stringify({ erreur: erreur.message, lignes_invalides: erreur.motifs }), erreur: true };
    }
    console.error(`outil ${nom}`, erreur instanceof Error ? erreur.message : erreur);
    return { contenu: JSON.stringify({ erreur: "La lecture a échoué. Réessaie une fois, puis dis-le au gestionnaire." }), erreur: true };
  }
}
