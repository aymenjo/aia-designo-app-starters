"use client";

import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";

/** Niveaux de zoom, en part de la largeur du cadre : 1 = l'avis tient en largeur. */
const ZOOMS = [1, 1.5, 2, 3, 4];

// Le cadre tient dans l'écran à côté des champs, sous la barre d'outils.
const HAUTEUR = "h-[70vh] lg:h-[calc(100vh-136px)]";

type Props = {
  /** URL signée d'une heure : le bucket est privé. */
  url: string | null;
  type: string;
};

/** L'avis déposé, à côté des champs : la visionneuse du navigateur pour un PDF, une visionneuse zoomable pour une image. */
export function VisionneuseAvis({ url, type }: Props) {
  if (!url) {
    return <Alerte variante="erreur">Le fichier de l&apos;avis ne peut pas être affiché. Rechargez la page.</Alerte>;
  }
  if (type === "application/pdf") {
    return (
      <iframe src={url} title="Fichier de l'avis" className={`${HAUTEUR} w-full rounded-card border border-line bg-surface`} />
    );
  }
  return <ImageZoomable url={url} />;
}

function ImageZoomable({ url }: { url: string }) {
  const [zoom, setZoom] = useState(ZOOMS[0]);
  const cadre = useRef<HTMLDivElement>(null);
  const glisse = useRef<{ x: number; y: number; gauche: number; haut: number } | null>(null);
  const rang = ZOOMS.indexOf(zoom);

  /** Change le zoom en gardant au centre du cadre ce qui y était. */
  function zoomer(suivant: number) {
    const el = cadre.current;
    if (!el) return setZoom(suivant);
    const centreX = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
    const centreY = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
    setZoom(suivant);
    requestAnimationFrame(() => {
      el.scrollLeft = centreX * el.scrollWidth - el.clientWidth / 2;
      el.scrollTop = centreY * el.scrollHeight - el.clientHeight / 2;
    });
  }

  // À la souris, on déplace l'image en la glissant ; au doigt, le défilement natif suffit.
  function saisir(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { scrollLeft: gauche, scrollTop: haut } = e.currentTarget;
    glisse.current = { x: e.clientX, y: e.clientY, gauche, haut };
  }

  function deplacer(e: PointerEvent<HTMLDivElement>) {
    const depart = glisse.current;
    if (!depart) return;
    e.currentTarget.scrollLeft = depart.gauche - (e.clientX - depart.x);
    e.currentTarget.scrollTop = depart.haut - (e.clientY - depart.y);
  }

  const lacher = () => (glisse.current = null);

  return (
    <div className="grid gap-2">
      <div role="toolbar" aria-label="Zoom" className="flex items-center gap-1">
        <Bouton
          variante="ghost"
          taille="sm"
          aria-label="Dézoomer"
          title="Dézoomer"
          disabled={rang === 0}
          onClick={() => zoomer(ZOOMS[rang - 1])}
        >
          <ZoomOut size={16} strokeWidth={1.5} aria-hidden />
        </Bouton>
        <span className="w-12 text-center font-mono text-meta text-secondary" aria-live="polite">
          {Math.round(zoom * 100)}&nbsp;%
        </span>
        <Bouton
          variante="ghost"
          taille="sm"
          aria-label="Zoomer"
          title="Zoomer"
          disabled={rang === ZOOMS.length - 1}
          onClick={() => zoomer(ZOOMS[rang + 1])}
        >
          <ZoomIn size={16} strokeWidth={1.5} aria-hidden />
        </Bouton>
        <Bouton variante="ghost" taille="sm" disabled={rang === 0} onClick={() => zoomer(ZOOMS[0])}>
          <Maximize2 size={16} strokeWidth={1.5} aria-hidden />
          Ajuster
        </Bouton>
      </div>
      <div
        ref={cadre}
        tabIndex={0}
        aria-label="Image de l'avis"
        onPointerDown={saisir}
        onPointerMove={deplacer}
        onPointerUp={lacher}
        onPointerCancel={lacher}
        className={`${HAUTEUR} cursor-grab overflow-auto rounded-card border border-line bg-surface active:cursor-grabbing`}
      >
        {/* URL signée d'une heure, hors de notre domaine : l'optimiseur d'images de Next la garderait au-delà. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Avis de contravention déposé"
          draggable={false}
          style={{ width: `${zoom * 100}%` }}
          className="block h-auto max-w-none select-none"
        />
      </div>
    </div>
  );
}
