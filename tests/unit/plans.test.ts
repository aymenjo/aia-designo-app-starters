import { describe, expect, it } from "vitest";
import { PRIX_PRO_HT_CENTIMES, PRIX_PRO_TTC_CENTIMES } from "@/lib/abonnement/plans";
import { AMENDE_NON_DESIGNATION_CENTIMES } from "@/lib/avis/echeance";

describe("prix du Pro", () => {
  it("vaut 49 € HT, soit 58,80 € TTC", () => {
    expect(PRIX_PRO_HT_CENTIMES).toBe(4_900);
    expect(PRIX_PRO_TTC_CENTIMES).toBe(5_880);
  });

  it("coûte moins sur 12 mois qu'une seule amende de non-désignation", () => {
    // L'argument de la landing : « une seule amende évitée paie plus d'un an d'abonnement ».
    expect(12 * PRIX_PRO_HT_CENTIMES).toBeLessThan(AMENDE_NON_DESIGNATION_CENTIMES);
  });
});
