import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listerAvisPourExport } from "@/lib/avis/export";
import {
  admin,
  passerEnPro,
  premiereConnexion,
  suffixeUnique,
  supprimerGestionnaire,
  type Gestionnaire,
} from "./outils";

// L'export CSV (phase 24) lit tout l'historique, au-delà des 1 000 lignes que rend PostgREST d'un coup, et rien que
// les avis de l'entreprise (RLS).

const suffixe = suffixeUnique();
const gestionnaires: Gestionnaire[] = [];
const NOMBRE = 1001;

/** Sème `nombre` avis vides hors RLS, d'un seul insert : ils ont tous le même instant de dépôt. */
async function semer(g: Gestionnaire, nombre: number) {
  const { error } = await admin.from("avis").insert(
    Array.from({ length: nombre }, () => ({
      entreprise_id: g.entrepriseId,
      fichier: `${g.entrepriseId}/${crypto.randomUUID()}.png`,
      fichier_type: "image/png",
    })),
  );
  if (error) throw error;
}

let a: Gestionnaire;
let b: Gestionnaire;

beforeAll(async () => {
  a = await premiereConnexion(`export-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`export-b-${suffixe}@exemple.fr`);
  gestionnaires.push(a, b);
  await passerEnPro(a.entrepriseId);
  await passerEnPro(b.entrepriseId);
  await semer(a, NOMBRE);
  await semer(b, 1);
});

afterAll(async () => {
  for (const g of gestionnaires) await supprimerGestionnaire(g);
});

describe("listerAvisPourExport", () => {
  it("lit tous les avis, page par page, sans doublon, du dernier déposé au premier", async () => {
    const avis = await listerAvisPourExport(a.client);
    expect(avis).toHaveLength(NOMBRE);
    expect(new Set(avis.map(({ id }) => id)).size).toBe(NOMBRE);
    // Déposés au même instant, ils sont départagés par leur id : l'ordre ne change pas d'une page à l'autre.
    const ids = avis.map(({ id }) => id);
    expect(ids).toEqual([...ids].sort());
  });

  it("ne lit aucun avis d'une autre entreprise", async () => {
    const avis = await listerAvisPourExport(b.client);
    expect(avis).toHaveLength(1);
    const { data } = await admin.from("avis").select("entreprise_id").eq("id", avis[0].id).single();
    expect(data?.entreprise_id).toBe(b.entrepriseId);
  });
});
