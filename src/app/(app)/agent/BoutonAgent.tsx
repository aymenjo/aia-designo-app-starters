"use client";

import { Lock, MessageSquareText } from "lucide-react";
import { useAgent } from "./FournisseurAgent";

/** « Demande à Désigno », dans la barre haute de chaque écran, sur ordinateur. En Free, un cadenas suit le libellé. */
export function BoutonAgent() {
  const { ouvert, plan, basculer } = useAgent();
  return (
    <button
      type="button"
      aria-pressed={ouvert}
      onClick={basculer}
      className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-ink bg-white px-3 text-label font-medium whitespace-nowrap transition-colors duration-120 ease-enter hover:bg-[rgb(0_0_0/0.06)] aria-pressed:bg-[rgb(0_0_0/0.06)] max-md:hidden"
    >
      <MessageSquareText size={16} strokeWidth={1.5} aria-hidden />
      Demande à Désigno
      {plan !== "pro" && (
        <>
          <Lock size={16} strokeWidth={1.5} aria-hidden className="text-secondary" />
          <span className="sr-only">, fonction Pro</span>
        </>
      )}
    </button>
  );
}
