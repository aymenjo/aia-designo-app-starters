import { describe, expect, it } from "vitest";
import { SUJET_IMPAYE, emailImpaye } from "@/lib/abonnement/email-impaye";

// L'email d'impayé (phase 19) : envoyé par Désigno au premier échec de paiement d'une facture, à la place des emails de
// Stripe. Le bandeau de l'application prend ensuite le relais.

describe("emailImpaye", () => {
  const email = emailImpaye({ limite: "2026-11-01", urlSite: "https://designo.exemple.fr/" });

  it("annonce l'échec, et la date limite au format JJ/MM/AAAA", () => {
    expect(email.sujet).toBe(SUJET_IMPAYE);
    expect(email.texte).toContain("Le paiement de votre abonnement Pro a échoué");
    expect(email.texte).toContain(
      "Mettez à jour votre carte d'ici le 01/11/2026 : sinon, votre compte repassera en Free, sans perte de données.",
    );
    expect(email.html).toContain("01/11/2026");
  });

  it("mène à l'écran Abonnement, d'où s'ouvre le portail", () => {
    expect(email.html).toContain('href="https://designo.exemple.fr/parametres/abonnement"');
    expect(email.texte).toContain("Mettre à jour ma carte : https://designo.exemple.fr/parametres/abonnement");
  });

  it("échappe le texte dans l'email HTML", () => {
    expect(email.html).toContain("d&#39;ici le 01/11/2026");
    expect(email.html).not.toContain("d'ici le");
  });
});
