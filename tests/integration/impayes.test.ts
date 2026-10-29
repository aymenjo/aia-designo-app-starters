import { afterAll, describe, expect, it } from "vitest";
import { ramenerImpayesEnFree } from "@/lib/abonnement/impayes";
import type { AbonnementRelu, ClientStripe } from "@/lib/abonnement/stripe";
import { idStripe } from "../stripe";
import { admin, premiereConnexion, suffixeUnique, supprimerGestionnaire, type Gestionnaire } from "./outils";

// La tâche des impayés (phase 19), avec un faux client Stripe qui garde l'état de ses abonnements : la CI ne parle
// jamais à Stripe. La tâche parcourt toutes les entreprises en `past_due` : celles des autres tests ont des dates de
// 2026, et chaque scénario ici est en 2025, avec ses propres abonnements. Un abonnement inconnu du faux client est
// donné annulé : la tâche le laisse.

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

/** Une entreprise en Pro, son abonnement en `past_due` depuis `echoueLe`, comme le webhook l'aurait écrit. */
async function enImpaye(nom: string, echoueLe: string) {
  const g = await premiereConnexion(`impayes-${nom}-${suffixe}@exemple.fr`);
  gestionnaires.push(g);
  const abonnement = idStripe("sub");
  const { error } = await admin
    .from("entreprise")
    .update({
      plan: "pro",
      stripe_client_id: idStripe("cus"),
      stripe_abonnement_id: abonnement,
      abonnement_statut: "past_due",
      paiement_echoue_le: echoueLe,
      stripe_evenement_le: echoueLe,
    })
    .eq("id", g.entrepriseId);
  if (error) throw error;
  return { g, abonnement };
}

type Appel = { methode: "abonnement" | "annulerAbonnement" | "annulerFacture"; id: string; cle?: string };

/** Un client Stripe qui note ses appels et garde l'état de ses abonnements. */
function fauxStripe(abonnements: Record<string, AbonnementRelu>, { factureEnPanne }: { factureEnPanne?: string } = {}) {
  const appels: Appel[] = [];
  const nonUtilise = async () => {
    throw new Error("non utilisé ici");
  };
  const stripe: ClientStripe = {
    tarif: nonUtilise,
    creerClient: nonUtilise,
    mettreAJourClient: nonUtilise,
    sessionCheckout: nonUtilise,
    sessionPortail: nonUtilise,
    // La suppression de compte a ses propres tests (suppression-compte.test.ts).
    abonnementsDuClient: nonUtilise,
    async abonnement(id) {
      appels.push({ methode: "abonnement", id });
      return abonnements[id] ?? { statut: "canceled", factureId: null, factureStatut: null };
    },
    async annulerAbonnement(id) {
      appels.push({ methode: "annulerAbonnement", id });
      abonnements[id] = { ...abonnements[id], statut: "canceled" };
    },
    async annulerFacture(id, cle) {
      appels.push({ methode: "annulerFacture", id, cle });
      if (id === factureEnPanne) throw new Error("Stripe en panne");
    },
  };
  /** Les appels qui visent ces abonnements et factures. */
  const appelsPour = (...ids: string[]) => appels.filter(({ id }) => ids.includes(id));
  return { stripe, appelsPour };
}

// L'échec du 03/03/2025 à 10:00 UTC : la date limite est le 10/03/2025.
const ECHEC = "2025-03-03T10:00:00Z";

describe("tâche des impayés", () => {
  it("annule l'abonnement le lendemain de la date limite, puis sa facture ouverte, et rien de plus au rejeu", async () => {
    const { abonnement } = await enImpaye("lendemain", ECHEC);
    const facture = idStripe("in");
    const { stripe, appelsPour } = fauxStripe({
      [abonnement]: { statut: "past_due", factureId: facture, factureStatut: "open" },
    });

    // La date limite est la dernière journée entière de Pro.
    expect(await ramenerImpayesEnFree({ supabase: admin, stripe, aujourdhui: "2025-03-10" })).toEqual({
      annules: 0,
      echecs: 0,
    });
    expect(appelsPour(abonnement)).toEqual([]);

    expect(await ramenerImpayesEnFree({ supabase: admin, stripe, aujourdhui: "2025-03-11" })).toEqual({
      annules: 1,
      echecs: 0,
    });
    // L'abonnement d'abord : la facture annulée en premier le ferait repasser par `active`.
    expect(appelsPour(abonnement, facture)).toEqual([
      { methode: "abonnement", id: abonnement },
      { methode: "annulerAbonnement", id: abonnement },
      { methode: "annulerFacture", id: facture, cle: `impaye/void/${facture}` },
    ]);

    // Relancée le même jour, avant que le webhook ait repassé le compte en Free : Stripe le donne déjà annulé.
    expect(await ramenerImpayesEnFree({ supabase: admin, stripe, aujourdhui: "2025-03-11" })).toEqual({
      annules: 0,
      echecs: 0,
    });
    expect(appelsPour(abonnement, facture).filter(({ methode }) => methode !== "abonnement")).toHaveLength(2);
  });

  it("laisse un abonnement que Stripe ne donne plus en impayé : le webhook resynchronisera", async () => {
    const { abonnement } = await enImpaye("regularise", "2025-04-01T10:00:00Z");
    const { stripe, appelsPour } = fauxStripe({
      [abonnement]: { statut: "active", factureId: idStripe("in"), factureStatut: "paid" },
    });
    expect(await ramenerImpayesEnFree({ supabase: admin, stripe, aujourdhui: "2025-04-09" })).toEqual({
      annules: 0,
      echecs: 0,
    });
    expect(appelsPour(abonnement)).toEqual([{ methode: "abonnement", id: abonnement }]);
  });

  it("n'annule pas une facture qui n'est plus ouverte", async () => {
    const { abonnement } = await enImpaye("facture-close", "2025-05-01T10:00:00Z");
    const facture = idStripe("in");
    const { stripe, appelsPour } = fauxStripe({
      [abonnement]: { statut: "past_due", factureId: facture, factureStatut: "uncollectible" },
    });
    expect(await ramenerImpayesEnFree({ supabase: admin, stripe, aujourdhui: "2025-05-09" })).toEqual({
      annules: 1,
      echecs: 0,
    });
    expect(appelsPour(facture)).toEqual([]);
  });

  it("compte dans les échecs une facture qui n'a pas pu être annulée, sans arrêter les autres", async () => {
    const enPanne = await enImpaye("void-en-panne", "2025-06-01T10:00:00Z");
    const autre = await enImpaye("void-autre", "2025-06-01T10:00:00Z");
    const facturePanne = idStripe("in");
    const factureAutre = idStripe("in");
    const { stripe, appelsPour } = fauxStripe(
      {
        [enPanne.abonnement]: { statut: "past_due", factureId: facturePanne, factureStatut: "open" },
        [autre.abonnement]: { statut: "past_due", factureId: factureAutre, factureStatut: "open" },
      },
      { factureEnPanne: facturePanne },
    );
    expect(await ramenerImpayesEnFree({ supabase: admin, stripe, aujourdhui: "2025-06-09" })).toEqual({
      annules: 2,
      echecs: 1,
    });
    expect(appelsPour(factureAutre)).toHaveLength(1);
  });
});
