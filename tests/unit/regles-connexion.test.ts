import { describe, expect, it } from "vitest";
import {
  MESSAGES,
  PAGE_APRES_CONNEXION,
  cheminSuivantSur,
  connexionExpiree,
  masquerEmail,
  schemaEmail,
} from "@/lib/auth/regles";
import { borneCookieSession } from "@/lib/supabase/cookies";

const JOUR_S = 24 * 60 * 60;
const CONNEXION_S = Date.UTC(2026, 9, 1, 8, 0, 0) / 1000;
const apres = (secondes: number) => new Date((CONNEXION_S + secondes) * 1000);
const amr = [{ method: "otp", timestamp: CONNEXION_S }];

describe("connexionExpiree", () => {
  it("garde la session jusqu'à 30 jours après la connexion", () => {
    expect(connexionExpiree(amr, apres(29 * JOUR_S + 23 * 3600))).toBe(false);
  });

  it("expire la session à 30 jours pile, et au-delà", () => {
    expect(connexionExpiree(amr, apres(30 * JOUR_S))).toBe(true);
    expect(connexionExpiree(amr, apres(31 * JOUR_S))).toBe(true);
  });

  it("compte depuis la première méthode d'authentification", () => {
    const deux = [...amr, { method: "password", timestamp: CONNEXION_S + 20 * JOUR_S }];
    expect(connexionExpiree(deux, apres(30 * JOUR_S))).toBe(true);
  });

  it("considère expirée une session sans horodatage", () => {
    expect(connexionExpiree(undefined, apres(0))).toBe(true);
    expect(connexionExpiree([], apres(0))).toBe(true);
    expect(connexionExpiree(["otp"], apres(0))).toBe(true);
  });
});

describe("cheminSuivantSur", () => {
  it("accepte un chemin interne, avec sa requête", () => {
    expect(cheminSuivantSur("/avis/1")).toBe("/avis/1");
    expect(cheminSuivantSur("/flotte/planning?vehicule=3&date=2026-03-12")).toBe(
      "/flotte/planning?vehicule=3&date=2026-03-12",
    );
  });

  it.each([
    ["//evil.example", "protocole implicite"],
    ["/\\evil.example", "antislash"],
    ["https://evil.example/avis", "URL absolue"],
    ["javascript:alert(1)", "schéma"],
    ["avis/1", "chemin relatif"],
    ["", "chaîne vide"],
  ])("refuse %s (%s)", (suivant) => {
    expect(cheminSuivantSur(suivant)).toBe(PAGE_APRES_CONNEXION);
  });

  it("renvoie la page par défaut sans valeur", () => {
    expect(cheminSuivantSur(null)).toBe(PAGE_APRES_CONNEXION);
    expect(cheminSuivantSur(undefined)).toBe(PAGE_APRES_CONNEXION);
  });
});

describe("schemaEmail", () => {
  it("normalise l'adresse", () => {
    expect(schemaEmail.parse("  Camille.Dupont@Exemple.FR ")).toBe("camille.dupont@exemple.fr");
  });

  it("explique une adresse vide ou mal formée", () => {
    expect(schemaEmail.safeParse("").error?.issues[0].message).toBe(MESSAGES.emailVide);
    expect(schemaEmail.safeParse("   ").error?.issues[0].message).toBe(MESSAGES.emailVide);
    expect(schemaEmail.safeParse("pas-une-adresse").error?.issues[0].message).toBe(MESSAGES.emailInvalide);
  });
});

describe("masquerEmail", () => {
  it("ne garde que la première lettre et le domaine", () => {
    expect(masquerEmail("camille@exemple.fr")).toBe("c…@exemple.fr");
  });
});

describe("borneCookieSession", () => {
  it("ramène les cookies de session à 30 jours", () => {
    expect(borneCookieSession({ path: "/", maxAge: 400 * JOUR_S }).maxAge).toBe(30 * JOUR_S);
  });

  it("laisse passer les suppressions", () => {
    expect(borneCookieSession({ path: "/", maxAge: 0 }).maxAge).toBe(0);
  });
});
