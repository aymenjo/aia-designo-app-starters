import { describe, expect, it } from "vitest";
import { MESSAGES_COMPTE, confirmationCorrecte, texteConfirmation } from "@/lib/compte/regles";

const EMAIL = "camille@exemple.fr";

describe("texteConfirmation", () => {
  it("demande la raison sociale, sans les espaces autour", () => {
    expect(texteConfirmation({ raisonSociale: "  Plomberie Martin  ", email: EMAIL })).toEqual({
      texte: "Plomberie Martin",
      parEmail: false,
    });
  });

  it("demande l'email quand la fiche n'a pas de raison sociale", () => {
    expect(texteConfirmation({ raisonSociale: null, email: EMAIL })).toEqual({ texte: EMAIL, parEmail: true });
    expect(texteConfirmation({ raisonSociale: "   ", email: EMAIL })).toEqual({ texte: EMAIL, parEmail: true });
  });
});

describe("confirmationCorrecte", () => {
  const raison = texteConfirmation({ raisonSociale: "Plomberie Martin", email: EMAIL });
  const email = texteConfirmation({ raisonSociale: null, email: EMAIL });

  it("accepte la raison sociale exacte, aux espaces près autour", () => {
    expect(confirmationCorrecte("Plomberie Martin", raison)).toBe(true);
    expect(confirmationCorrecte("  Plomberie Martin\n", raison)).toBe(true);
  });

  it("refuse la raison sociale à une casse, une lettre ou un espace près", () => {
    expect(confirmationCorrecte("plomberie martin", raison)).toBe(false);
    expect(confirmationCorrecte("Plomberie Marti", raison)).toBe(false);
    expect(confirmationCorrecte("Plomberie  Martin", raison)).toBe(false);
  });

  it("accepte l'email en majuscules ou non, et refuse un autre email", () => {
    expect(confirmationCorrecte("Camille@Exemple.FR ", email)).toBe(true);
    expect(confirmationCorrecte("camille@exemple.com", email)).toBe(false);
  });

  it("refuse une saisie vide", () => {
    expect(confirmationCorrecte("", raison)).toBe(false);
    expect(confirmationCorrecte("   ", email)).toBe(false);
    expect(confirmationCorrecte("", { texte: "", parEmail: false })).toBe(false);
  });
});

describe("MESSAGES_COMPTE", () => {
  it("rappelle le texte attendu", () => {
    expect(MESSAGES_COMPTE.saisie("Plomberie Martin")).toBe("Saisissez exactement « Plomberie Martin » pour confirmer.");
  });
});
