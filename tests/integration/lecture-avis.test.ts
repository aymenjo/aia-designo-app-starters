import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BUCKET_AVIS, modifierAvis, versValeurs, type Avis } from "@/lib/avis/avis";
import { lireEtRemplirAvis, type Lecteur, type Lecture } from "@/lib/avis/lecture";
import { CHAMPS_AVIS, CHAMPS_REQUIS_AVIS, MESSAGES_AVIS, type ChampAvis, type Confiance } from "@/lib/avis/regles";
import { creerVehicule } from "@/lib/flotte/vehicules";
import {
  PNG,
  admin,
  avisEnBase,
  deposerAvis,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

// La lecture IA sur le Supabase local, avec un lecteur factice : l'API Claude n'est jamais appelée.

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;

beforeAll(async () => {
  a = await premiereConnexion(`lecture-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`lecture-b-${suffixe}@exemple.fr`);
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await supprimerGestionnaire(g);
});

const LUES: Record<ChampAvis, string> = {
  numero: "6660000001",
  plaque: "LR-101-AA",
  infraction_date: "03/10/2026",
  infraction_heure: "08:30",
  lieu: "A6, Auxerre",
  infraction: "Excès de vitesse inférieur à 20 km/h",
  montant: "135,00",
  date_envoi: "06/10/2026",
};

/** Une lecture où tout est lu et sûr, sauf les champs donnés : [valeur, niveau]. */
function lecture(autres: Partial<Record<ChampAvis, [string | null, Confiance?]>> = {}): Lecture {
  return Object.fromEntries(
    CHAMPS_AVIS.map((champ) => {
      const [valeur, confiance = "sur"] = autres[champ] ?? [LUES[champ]];
      return [champ, { valeur, confiance }];
    }),
  ) as Lecture;
}

/** Un lecteur factice qui renvoie toujours cette lecture. */
const lecteur = (lue: Lecture) => vi.fn<Lecteur>(async () => lue);

const TOUT_SUR = Object.fromEntries(CHAMPS_REQUIS_AVIS.map((champ) => [champ, "sur"]));

describe("lecture IA d'un avis déposé", () => {
  it("pré-remplit les champs avec leurs niveaux, rattache le véhicule et passe l'avis « À valider » si tout est sûr", async () => {
    const vehicule = await creerVehicule(a.client, { plaque: "LR-101-AA", type: "attitre" });
    if (!vehicule.ok) throw new Error("véhicule");
    const { id } = await deposerAvis(a);
    const lire = lecteur(lecture());

    expect(await lireEtRemplirAvis(a.client, id, lire)).toEqual({ lecture: "lue" });
    expect(lire).toHaveBeenCalledOnce();
    const [fichier] = lire.mock.calls[0];
    expect(fichier.type).toBe("image/png");
    expect(fichier.contenu.equals(PNG)).toBe(true);

    expect(await avisEnBase(id)).toMatchObject({
      numero: "6660000001",
      plaque: "LR-101-AA",
      vehicule_id: vehicule.vehicule.id,
      infraction_le: expect.stringMatching(/^2026-10-03T06:30:00/),
      montant_centimes: 13500,
      date_envoi: "2026-10-06",
      statut: "a_valider",
      lecture_ia: "lue",
      confiances: TOUT_SUR,
    });
  });

  it("un champ rouge ou vide laisse l'avis « À traiter »", async () => {
    const { id } = await deposerAvis(a);
    const lue = lecture({ numero: ["6660000002"], date_envoi: ["06/10/2026", "non_lu"], lieu: [null, "non_lu"] });
    await lireEtRemplirAvis(a.client, id, lecteur(lue));

    expect(await avisEnBase(id)).toMatchObject({
      date_envoi: "2026-10-06",
      lieu: null,
      statut: "a_traiter",
      confiances: { ...TOUT_SUR, date_envoi: "non_lu", lieu: "non_lu" },
    });
  });

  it("un avis n'est lu qu'une fois : une seconde lecture n'appelle pas le lecteur", async () => {
    const { id } = await deposerAvis(a);
    await lireEtRemplirAvis(a.client, id, lecteur(lecture({ numero: ["6660000003"] })));

    const encore = lecteur(lecture({ numero: ["6660000099"] }));
    expect(await lireEtRemplirAvis(a.client, id, encore)).toEqual({ lecture: "ignoree" });
    expect(encore).not.toHaveBeenCalled();
    expect((await avisEnBase(id))?.numero).toBe("6660000003");
  });

  it("deux lectures lancées ensemble n'appellent le lecteur qu'une fois", async () => {
    const { id } = await deposerAvis(a);
    const lire = lecteur(lecture({ numero: ["6660000004"] }));
    const resultats = await Promise.all([lireEtRemplirAvis(a.client, id, lire), lireEtRemplirAvis(a.client, id, lire)]);
    expect(resultats).toEqual(expect.arrayContaining([{ lecture: "lue" }, { lecture: "ignoree" }]));
    expect(lire).toHaveBeenCalledOnce();
  });

  it("si le lecteur échoue, l'avis reste vide, marqué en échec, et n'est plus relu", async () => {
    const { id } = await deposerAvis(a);
    const panne = vi.fn<Lecteur>(async () => {
      throw new Error("API indisponible");
    });
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await lireEtRemplirAvis(a.client, id, panne)).toEqual({ lecture: "echec" });
    expect(await avisEnBase(id)).toMatchObject({
      numero: null,
      plaque: null,
      statut: "a_traiter",
      lecture_ia: "echec",
      confiances: {},
    });
    expect(await lireEtRemplirAvis(a.client, id, lecteur(lecture()))).toEqual({ lecture: "ignoree" });
    expect(journal).toHaveBeenCalledWith("avis", "lecture", "API indisponible");
    journal.mockRestore();
  });

  it("sans lecteur (pas de clé d'API), rien n'est lu", async () => {
    const { id } = await deposerAvis(a);
    expect(await lireEtRemplirAvis(a.client, id, null)).toEqual({ lecture: "ignoree" });
    expect((await avisEnBase(id))?.lecture_ia).toBeNull();
  });

  it("ne remplit que les champs encore vides : une saisie faite entre-temps est gardée, sans niveau", async () => {
    const { id } = await deposerAvis(a);
    await modifierAvis(a.client, id, { lieu: "Saisi à la main" });
    await lireEtRemplirAvis(a.client, id, lecteur(lecture({ numero: ["6660000005"] })));

    const avis = await avisEnBase(id);
    expect(avis).toMatchObject({ lieu: "Saisi à la main", numero: "6660000005" });
    expect(avis?.confiances).not.toHaveProperty("lieu");
  });

  it("une valeur lue mais refusée par les règles laisse le champ vide, et se garde avec son motif jusqu'à la saisie", async () => {
    const { id } = await deposerAvis(a);
    await lireEtRemplirAvis(a.client, id, lecteur(lecture({ numero: ["2026-08-LY-004817"] })));
    const lu = await avisEnBase(id);
    expect(lu).toMatchObject({
      numero: null,
      statut: "a_traiter",
      confiances: { numero: "non_lu" },
      valeurs_refusees: { numero: { valeur: "2026-08-LY-004817", motif: MESSAGES_AVIS.numeroMalForme } },
    });

    // Enregistrer sans remplir le champ la garde ; le remplir l'efface, avec son niveau.
    await modifierAvis(a.client, id, versValeurs(lu));
    expect((await avisEnBase(id))?.valeurs_refusees).toHaveProperty("numero");
    await modifierAvis(a.client, id, { ...versValeurs(lu), numero: "6660000010" });
    const saisi = await avisEnBase(id);
    expect(saisi).toMatchObject({ numero: "6660000010", statut: "a_valider", valeurs_refusees: {} });
    expect(saisi?.confiances).not.toHaveProperty("numero");
  });

  it("un n° lu déjà pris abandonne le dépôt, fichier compris, et renvoie l'avis existant", async () => {
    const existant = await deposerAvis(a);
    await modifierAvis(a.client, existant.id, { numero: "6660000006" });
    const depot = await deposerAvis(a);

    expect(await lireEtRemplirAvis(a.client, depot.id, lecteur(lecture({ numero: ["66 6000 0006"] })))).toEqual({
      lecture: "doublon",
      existant: { id: existant.id, numero: "6660000006" },
    });
    expect(await avisEnBase(depot.id)).toBeNull();
    expect((await admin.storage.from(BUCKET_AVIS).download(depot.chemin)).data).toBeNull();
    expect((await avisEnBase(existant.id))?.numero).toBe("6660000006");
  });

  it("un gestionnaire ne lit pas l'avis d'une autre entreprise", async () => {
    const { id } = await deposerAvis(a);
    const lire = lecteur(lecture({ numero: ["6660000007"] }));

    expect(await lireEtRemplirAvis(b.client, id, lire)).toEqual({ lecture: "ignoree" });
    expect(lire).not.toHaveBeenCalled();
    expect(await avisEnBase(id)).toMatchObject({ numero: null, lecture_ia: null });
  });
});

describe("saisie d'un avis lu", () => {
  let id: string;

  beforeAll(async () => {
    id = (await deposerAvis(a)).id;
    const lue = lecture({ numero: ["6660000008"], plaque: ["LR-202-BB", "a_verifier"], date_envoi: ["06/10/2026", "non_lu"] });
    await lireEtRemplirAvis(a.client, id, lecteur(lue));
  });

  async function valeursEnBase() {
    const { data } = await a.client.from("avis").select("*").eq("id", id).single<Avis>();
    return versValeurs(data!);
  }

  it("enregistrer sans rien changer garde les niveaux, et le champ rouge bloque « À valider »", async () => {
    expect(await modifierAvis(a.client, id, await valeursEnBase())).toMatchObject({
      ok: true,
      avis: { statut: "a_traiter", confiances: { plaque: "a_verifier", date_envoi: "non_lu" } },
    });
  });

  it("confirmer le champ rouge lève son niveau et passe l'avis « À valider » ; un champ modifié perd le sien", async () => {
    const resultat = await modifierAvis(a.client, id, { ...(await valeursEnBase()), plaque: "LR-203-BB" }, ["date_envoi"]);
    expect(resultat).toMatchObject({ ok: true, avis: { statut: "a_valider", plaque: "LR-203-BB" } });
    if (!resultat.ok) return;
    expect(resultat.avis.confiances).toEqual({
      numero: "sur",
      infraction_le: "sur",
      lieu: "sur",
      infraction: "sur",
      montant_centimes: "sur",
    });
  });
});
