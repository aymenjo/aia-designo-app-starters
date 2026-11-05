import { TYPES_FICHIER, ecrireModele } from "@/lib/flotte/regles-import";

/** Le modèle CSV à remplir : la ligne d'en-têtes, encodée pour Excel. */
export async function GET(_requete: Request, { params }: RouteContext<"/flotte/import/modeles/[modele]">) {
  const { modele } = await params;
  const type = TYPES_FICHIER.find((candidat) => candidat === modele);
  if (!type) return new Response(null, { status: 404 });

  return new Response(ecrireModele(type), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="designo-${type}.csv"`,
    },
  });
}
