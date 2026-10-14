import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enregistrerFiche, lireFiche } from "@/lib/entreprise/fiche";
import { MESSAGES } from "@/lib/entreprise/regles";
import { admin, nouveauClient, premiereConnexion, suffixeUnique, type Gestionnaire } from "./outils";

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;

const saisie = {
  raison_sociale: " Plomberie Martin SARL ",
  siren: "404 833 048",
  tva: "",
  representant_prenom: "Claire",
  representant_nom: "Martin",
  representant_fonction: "Gérante",
  siege_adresse: "12 rue des Lilas",
  siege_complement: "",
  siege_code_postal: "69 003",
  siege_ville: "Lyon",
};

beforeAll(async () => {
  a = await premiereConnexion(`fiche-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`fiche-b-${suffixe}@exemple.fr`);
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await admin.auth.admin.deleteUser(g.userId);
});

async function enBase(g: Gestionnaire) {
  const { data } = await admin.from("entreprise").select("user_id, raison_sociale, siren, tva").eq("id", g.entrepriseId).single();
  return data;
}

describe("fiche entreprise : enregistrement", () => {
  it("une entreprise neuve a une fiche vide", async () => {
    const fiche = await lireFiche(a.client);
    expect(Object.values(fiche).every((valeur) => valeur === null)).toBe(true);
  });

  it("une fiche incomplète s'enregistre, normalisée", async () => {
    const resultat = await enregistrerFiche(a.client, saisie);
    expect(resultat).toEqual({
      ok: true,
      fiche: {
        ...saisie,
        raison_sociale: "Plomberie Martin SARL",
        siren: "404833048",
        tva: null,
        siege_complement: null,
        siege_code_postal: "69003",
      },
    });
    expect(await lireFiche(a.client)).toMatchObject({ siren: "404833048", tva: null });
  });

  it("un SIREN ou une TVA faux bloquent l'enregistrement, sans rien modifier", async () => {
    expect(await enregistrerFiche(a.client, { ...saisie, siren: "404833049", raison_sociale: "Autre" })).toEqual({
      ok: false,
      erreurs: { siren: MESSAGES.sirenInvalide },
    });
    expect(await enregistrerFiche(a.client, { ...saisie, tva: "FR44732829320" })).toEqual({
      ok: false,
      erreurs: { tva: MESSAGES.tvaIncoherente("FR83404833048") },
    });
    expect(await enBase(a)).toMatchObject({ raison_sociale: "Plomberie Martin SARL", tva: null });
  });

  it("deux comptes peuvent déclarer le même SIREN", async () => {
    const resultat = await enregistrerFiche(b.client, { siren: "404833048", tva: "FR83404833048" });
    expect(resultat).toMatchObject({ ok: true, fiche: { siren: "404833048", tva: "FR83404833048" } });
  });
});

describe("fiche entreprise : isolation et droits (RLS)", () => {
  it("chaque gestionnaire n'enregistre que sa propre fiche", async () => {
    await enregistrerFiche(b.client, { raison_sociale: "Électricité Durand" });
    expect(await enBase(a)).toMatchObject({ raison_sociale: "Plomberie Martin SARL" });
    expect(await enBase(b)).toMatchObject({ raison_sociale: "Électricité Durand" });
  });

  it("un gestionnaire ne modifie pas la fiche d'une autre entreprise, même en la visant par son id", async () => {
    const { data } = await b.client
      .from("entreprise")
      .update({ raison_sociale: "Piratée" })
      .eq("id", a.entrepriseId)
      .select();
    expect(data ?? []).toEqual([]);
    expect(await enBase(a)).toMatchObject({ raison_sociale: "Plomberie Martin SARL" });
  });

  it("un visiteur sans session ne modifie aucune fiche", async () => {
    await nouveauClient().from("entreprise").update({ raison_sociale: "Piratée" }).eq("id", a.entrepriseId);
    expect(await enBase(a)).toMatchObject({ raison_sociale: "Plomberie Martin SARL" });
  });

  it("user_id ne se modifie pas, même sur sa propre entreprise", async () => {
    const { error } = await a.client.from("entreprise").update({ user_id: b.userId }).eq("id", a.entrepriseId);
    expect(error).not.toBeNull();
    expect(await enBase(a)).toMatchObject({ user_id: a.userId });
  });
});

describe("fiche entreprise : filet de sécurité en base", () => {
  it.each<{ cas: string; valeurs: Record<string, string> }>([
    { cas: "un SIREN non normalisé", valeurs: { siren: "404 833 048" } },
    { cas: "une TVA non normalisée", valeurs: { tva: "fr83404833048" } },
    { cas: "la TVA d'un autre SIREN", valeurs: { siren: "404833048", tva: "FR44732829320" } },
    { cas: "un code postal à 4 chiffres", valeurs: { siege_code_postal: "6900" } },
    { cas: "une raison sociale trop longue", valeurs: { raison_sociale: "x".repeat(121) } },
  ])("la base refuse $cas", async ({ valeurs }) => {
    const { error } = await a.client.from("entreprise").update(valeurs).eq("id", a.entrepriseId);
    expect(error?.code).toBe("23514");
  });
});
