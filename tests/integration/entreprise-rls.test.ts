import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, nouveauClient, premiereConnexion, suffixeUnique, type Gestionnaire } from "./outils";

const suffixe = suffixeUnique();
let a: Gestionnaire;
let b: Gestionnaire;

beforeAll(async () => {
  a = await premiereConnexion(`integration-a-${suffixe}@exemple.fr`);
  b = await premiereConnexion(`integration-b-${suffixe}@exemple.fr`);
});

afterAll(async () => {
  for (const g of [a, b]) if (g) await admin.auth.admin.deleteUser(g.userId);
});

describe("entreprise : création et isolation (RLS)", () => {
  it("chaque gestionnaire voit exactement son entreprise, créée à la première connexion", async () => {
    for (const g of [a, b]) {
      const { data, error } = await g.client.from("entreprise").select("id, user_id");
      expect(error).toBeNull();
      expect(data).toEqual([{ id: g.entrepriseId, user_id: g.userId }]);
    }
  });

  it("un gestionnaire ne voit pas l'entreprise d'un autre, même en la visant par son id", async () => {
    const { data, error } = await a.client.from("entreprise").select("id").eq("id", b.entrepriseId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un visiteur sans session ne voit aucune entreprise", async () => {
    const { data } = await nouveauClient().from("entreprise").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("mon_entreprise_id() renvoie l'entreprise du gestionnaire, et rien sans session", async () => {
    expect((await a.client.rpc("mon_entreprise_id")).data).toBe(a.entrepriseId);
    expect((await b.client.rpc("mon_entreprise_id")).data).toBe(b.entrepriseId);
    expect((await nouveauClient().rpc("mon_entreprise_id")).error).not.toBeNull();
  });

  it("un gestionnaire ne peut ni créer, ni réattribuer, ni supprimer une entreprise", async () => {
    await a.client.from("entreprise").insert({ user_id: a.userId });
    await a.client.from("entreprise").update({ user_id: a.userId }).eq("id", b.entrepriseId);
    await a.client.from("entreprise").delete().eq("id", a.entrepriseId);

    const { data } = await admin
      .from("entreprise")
      .select("id, user_id")
      .in("user_id", [a.userId, b.userId])
      .order("user_id");
    expect(data).toEqual(
      [
        { id: a.entrepriseId, user_id: a.userId },
        { id: b.entrepriseId, user_id: b.userId },
      ].sort((x, y) => x.user_id.localeCompare(y.user_id)),
    );
  });

  it("supprimer l'utilisateur supprime son entreprise", async () => {
    const jetable = await premiereConnexion(`integration-c-${suffixe}@exemple.fr`);
    await admin.auth.admin.deleteUser(jetable.userId);
    const { count } = await admin
      .from("entreprise")
      .select("id", { count: "exact", head: true })
      .eq("user_id", jetable.userId);
    expect(count).toBe(0);
  });
});

describe("session absolue de 30 jours", () => {
  it("l'horodatage amr reste celui de la connexion après un rafraîchissement", async () => {
    const avant = (await a.client.auth.getClaims()).data?.claims;
    expect(avant?.amr?.[0]).toMatchObject({ method: "otp", timestamp: expect.any(Number) });

    await new Promise((fin) => setTimeout(fin, 1_100));
    const { error } = await a.client.auth.refreshSession();
    expect(error).toBeNull();

    const apres = (await a.client.auth.getClaims()).data?.claims;
    expect(apres?.iat).toBeGreaterThan(avant!.iat);
    expect(apres?.amr).toEqual(avant?.amr);
  });
});
