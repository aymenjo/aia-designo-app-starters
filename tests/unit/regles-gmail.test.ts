import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TAILLE_MAX_FICHIER } from "@/lib/avis/regles";
import { emailInterruption, SUJET_INTERRUPTION } from "@/lib/gmail/email-interruption";
import {
  MESSAGES_GMAIL,
  contenuConforme,
  dateReception,
  estCleMessageGmail,
  lienGmail,
  schemaEvenement,
  trierPiecesJointes,
} from "@/lib/gmail/regles";
import { TOLERANCE_SIGNATURE_S, signerCorps, verifierSignature } from "@/lib/gmail/signature";
import { CONTENU_PDF, CONTENU_PNG, evenementEmail, evenementExpiration, piece } from "../composio";

// Les règles de la relève Gmail (phase 23) : la forme des événements de Composio, le tri des pièces jointes, la
// signature du webhook, et l'email d'interruption.

const FIXTURES = join(import.meta.dirname, "../fixtures/composio");

describe("schemaEvenement", () => {
  it("lit les livraisons relevées pendant l'essai", () => {
    const fichiers = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));
    expect(fichiers.length).toBeGreaterThan(0);
    for (const fichier of fichiers) {
      const evenement = schemaEvenement.safeParse(JSON.parse(readFileSync(join(FIXTURES, fichier), "utf8")));
      expect(evenement.success, fichier).toBe(true);
    }
  });

  it("lit un email relevé : son id Gmail, son expéditeur et ses parties", () => {
    const brut = evenementEmail({ declencheur: "ti_1", compte: "ca_1", messageId: "19a2b3", pieces: [piece({ nom: "a.pdf" })] });
    const lu = schemaEvenement.parse(brut);
    expect(lu.type).toBe("composio.trigger.message");
    if (lu.type !== "composio.trigger.message") return;
    expect(lu.metadata).toMatchObject({ trigger_id: "ti_1", connected_account_id: "ca_1" });
    expect(lu.data.id).toBe("19a2b3");
    expect(lu.data.payload?.parts).toHaveLength(2);
  });

  it("lit un compte expiré", () => {
    expect(schemaEvenement.parse(evenementExpiration("ca_9"))).toMatchObject({ data: { id: "ca_9" } });
  });

  it("refuse un autre type d'événement", () => {
    expect(schemaEvenement.safeParse({ type: "composio.trigger.autre", data: {} }).success).toBe(false);
  });
});

describe("dateReception", () => {
  it("lit un instant ISO, ou des millisecondes", () => {
    expect(dateReception("2026-10-26T08:12:00Z")).toBe("2026-10-26T08:12:00.000Z");
    expect(dateReception("1792915920000")).toBe(new Date(1792915920000).toISOString());
  });

  it("renvoie null pour une date absente ou illisible", () => {
    expect(dateReception(undefined)).toBeNull();
    expect(dateReception("hier")).toBeNull();
  });
});

describe("trierPiecesJointes", () => {
  const trier = (...pieces: ReturnType<typeof piece>[]) =>
    trierPiecesJointes(evenementEmail({ declencheur: "ti", compte: "ca", pieces }).data.payload);

  it("un PDF, un JPG ou un PNG de 10 Mo au plus donne un avis, avec le type stocké", () => {
    const { exploitables, ecarts } = trier(
      piece({ nom: "avis.pdf" }),
      piece({ nom: "photo.jpeg", type: "image/jpeg" }),
      piece({ nom: "scan.png", type: "image/png", taille: TAILLE_MAX_FICHIER }),
    );
    expect(ecarts).toEqual([]);
    expect(exploitables.map(({ nom, type, cle }) => ({ nom, type, cle }))).toEqual([
      { nom: "avis.pdf", type: "application/pdf", cle: "1" },
      { nom: "photo.jpeg", type: "image/jpeg", cle: "2" },
      { nom: "scan.png", type: "image/png", cle: "3" },
    ]);
  });

  it("reconnaît un format par son extension quand Gmail ne donne pas le type", () => {
    const { exploitables } = trier(piece({ nom: "AVIS.PDF", type: "application/octet-stream" }));
    expect(exploitables[0]).toMatchObject({ type: "application/pdf" });
  });

  it("écarte un HEIC, un autre format, et un fichier de plus de 10 Mo, avec leur motif", () => {
    const { exploitables, ecarts } = trier(
      piece({ nom: "IMG_1234.HEIC", type: "image/heic" }),
      piece({ nom: "avis.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      piece({ nom: "gros.pdf", taille: TAILLE_MAX_FICHIER + 1 }),
    );
    expect(exploitables).toEqual([]);
    expect(ecarts).toEqual([
      { nom: "IMG_1234.HEIC", motif: "heic" },
      { nom: "avis.docx", motif: "format" },
      { nom: "gros.pdf", motif: "taille" },
    ]);
  });

  it("ignore les images intégrées au corps, mais pas un PDF en ligne", () => {
    const { exploitables, ecarts } = trier(
      piece({ nom: "logo.png", type: "image/png", integree: true }),
      piece({ nom: "avis.pdf", integree: true }),
    );
    expect(ecarts).toEqual([]);
    expect(exploitables.map(({ nom }) => nom)).toEqual(["avis.pdf"]);
  });

  it("sépare un email mixte : une pièce jointe donne un avis, l'autre est écartée", () => {
    const { exploitables, ecarts } = trier(piece({ nom: "avis.pdf" }), piece({ nom: "photo.heic", type: "image/heic" }));
    expect(exploitables).toHaveLength(1);
    expect(ecarts).toEqual([{ nom: "photo.heic", motif: "heic" }]);
  });

  it("un email sans pièce jointe ne donne rien", () => {
    expect(trier()).toEqual({ exploitables: [], ecarts: [] });
    expect(trierPiecesJointes(undefined)).toEqual({ exploitables: [], ecarts: [] });
  });

  it("parcourt les parties imbriquées", () => {
    const { exploitables } = trierPiecesJointes({
      mimeType: "multipart/mixed",
      parts: [{ partId: "0", mimeType: "multipart/alternative", parts: [{ ...piece({ nom: "avis.pdf" }), partId: "0.1" }] }],
    });
    expect(exploitables.map(({ cle }) => cle)).toEqual(["0.1"]);
  });
});

describe("contenuConforme", () => {
  it("vérifie la signature du fichier téléchargé", () => {
    expect(contenuConforme("application/pdf", CONTENU_PDF)).toBe(true);
    expect(contenuConforme("image/png", CONTENU_PNG)).toBe(true);
    expect(contenuConforme("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  it("écarte un fichier renommé", () => {
    expect(contenuConforme("application/pdf", CONTENU_PNG)).toBe(false);
    expect(contenuConforme("image/png", CONTENU_PDF)).toBe(false);
    expect(contenuConforme("image/heic", CONTENU_PDF)).toBe(false);
  });
});

describe("verifierSignature", () => {
  const corps = JSON.stringify(evenementExpiration("ca_1"));
  const maintenant = Date.parse("2026-10-26T09:00:00Z");

  it("accepte le corps signé par le secret, dans les 5 minutes", () => {
    const entetes = new Headers(signerCorps(corps, "secret", maintenant));
    expect(verifierSignature({ corps, entetes, secret: "secret", maintenant })).toBe(true);
    const plusTard = maintenant + TOLERANCE_SIGNATURE_S * 1000;
    expect(verifierSignature({ corps, entetes, secret: "secret", maintenant: plusTard })).toBe(true);
  });

  it("accepte une signature parmi plusieurs (rotation du secret)", () => {
    const signees = signerCorps(corps, "secret", maintenant);
    const autre = signerCorps(corps, "ancien", maintenant)["webhook-signature"];
    const entetes = new Headers({ ...signees, "webhook-signature": `${autre} ${signees["webhook-signature"]}` });
    expect(verifierSignature({ corps, entetes, secret: "secret", maintenant })).toBe(true);
  });

  it("refuse un autre secret, un corps modifié, un horodatage trop ancien, ou des en-têtes absents", () => {
    const entetes = new Headers(signerCorps(corps, "secret", maintenant));
    expect(verifierSignature({ corps, entetes, secret: "autre", maintenant })).toBe(false);
    expect(verifierSignature({ corps: `${corps} `, entetes, secret: "secret", maintenant })).toBe(false);
    const tropTard = maintenant + (TOLERANCE_SIGNATURE_S + 1) * 1000;
    expect(verifierSignature({ corps, entetes, secret: "secret", maintenant: tropTard })).toBe(false);
    expect(verifierSignature({ corps, entetes: new Headers(), secret: "secret", maintenant })).toBe(false);
    expect(verifierSignature({ corps, entetes, secret: "", maintenant })).toBe(false);
  });
});

describe("lienGmail", () => {
  it("ouvre le message depuis la boîte qui l'a reçu", () => {
    expect(lienGmail("gestion@exemple.fr", "19a2b3")).toBe("https://mail.google.com/mail/u/gestion%40exemple.fr/#all/19a2b3");
    expect(lienGmail(null, "19a2b3")).toBe("https://mail.google.com/mail/u/0/#all/19a2b3");
  });
});

describe("estCleMessageGmail", () => {
  it("ne reconnaît que les messages d'une phrase", () => {
    expect(estCleMessageGmail("connexionRefusee")).toBe(true);
    expect(estCleMessageGmail("bandeau")).toBe(false);
    expect(estCleMessageGmail("ecart")).toBe(false);
    expect(estCleMessageGmail("toString")).toBe(false);
    expect(estCleMessageGmail(undefined)).toBe(false);
  });
});

describe("emailInterruption", () => {
  const email = emailInterruption({ libelle: "Avis", urlSite: "https://designo.exemple.fr/" });

  it("annonce l'interruption, le libellé, et l'absence de rattrapage", () => {
    expect(email.sujet).toBe(SUJET_INTERRUPTION);
    expect(email.texte).toContain(MESSAGES_GMAIL.bandeau("Avis"));
    expect(email.texte).toContain("ne seront pas rattrapés");
    expect(email.texte).toContain("« Avis »");
  });

  it("mène à l'écran Intégrations, d'où l'on reconnecte Gmail", () => {
    expect(email.html).toContain('href="https://designo.exemple.fr/parametres/integrations"');
    expect(email.texte).toContain("Reconnecter Gmail : https://designo.exemple.fr/parametres/integrations");
  });

  it("échappe le texte dans l'email HTML", () => {
    expect(email.html).toContain("D&#39;ici là");
    expect(email.html).not.toContain("D'ici là");
  });
});
