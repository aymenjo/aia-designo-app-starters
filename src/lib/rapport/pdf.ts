import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { prechaufferPolices } from "./polices";
import { RapportPdf, type DonneesRapport } from "./RapportPdf";

// Le rendu du PDF, côté serveur seulement : la tâche du rapport mensuel le génère, puis le fige dans le bucket.

/** Le PDF du rapport d'un mois, prêt à joindre et à archiver. */
export async function genererPdfRapport(donnees: DonneesRapport): Promise<Buffer> {
  await prechaufferPolices();
  // `RapportPdf` rend un `Document` : react-pdf attend cet élément à la racine.
  return renderToBuffer(createElement(RapportPdf, donnees) as unknown as ReactElement<DocumentProps>);
}
