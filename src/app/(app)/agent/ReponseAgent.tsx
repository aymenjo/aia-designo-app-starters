import Link from "next/link";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { analyserLien } from "@/lib/agent/citations";

// Une réponse de l'agent, écrite en Markdown (phase 26). Le serveur l'a déjà nettoyée de tout lien inconnu ; ici, seul
// ce qui a la forme d'un lien autorisé (un élément, le planning d'un véhicule, un écran) devient un lien, et le HTML
// brut est ignoré. Les liens restent en encre, soulignés (DESIGN.md).

const COMPOSANTS: Components = {
  a({ href, children }) {
    const analyse = href ? analyserLien(href) : null;
    if (!analyse) return <span>{children}</span>;
    return <Link href={"ecran" in analyse ? analyse.ecran : analyse.element.lien}>{children}</Link>;
  },
  img: ({ alt }) => <span>{alt}</span>,
  h1: ({ children }) => <p className="font-semibold">{children}</p>,
  h2: ({ children }) => <p className="font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
  ul: ({ children }) => <ul className="grid list-disc gap-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="grid list-decimal gap-1 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => <code className="font-mono text-label">{children}</code>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-label">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line py-1.5 pr-3 text-left font-mono text-meta font-medium text-secondary uppercase">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-line py-1.5 pr-3 align-top">{children}</td>,
};

export function ReponseAgent({ contenu }: { contenu: string }) {
  return (
    <div className="grid gap-2.5 text-body break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPOSANTS} skipHtml>
        {contenu}
      </Markdown>
    </div>
  );
}
