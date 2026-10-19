import Link from "next/link";

export default function PageIntrouvable() {
  return (
    <div className="grid gap-6">
      <h1 className="font-display text-title font-bold">Cette page n&apos;existe pas</h1>
      <section className="grid justify-items-start gap-2 rounded-panel border border-line p-8 max-md:p-6">
        <p className="max-w-[560px] text-secondary">
          Le lien est peut-être incorrect, ou l&apos;élément que vous cherchez n&apos;existe plus.
        </p>
        <Link href="/tableau-de-bord">Retour au tableau de bord</Link>
      </section>
    </div>
  );
}
