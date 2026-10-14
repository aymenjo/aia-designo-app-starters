import { LogoSymbole } from "@/components/Logo";

export default function LayoutConnexion({ children }: LayoutProps<"/connexion">) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface px-4 py-12">
      <main className="grid w-full max-w-[400px] gap-6">
        <p className="inline-flex items-center gap-2 justify-self-center font-display text-[18px] font-extrabold tracking-[-0.02em]">
          <LogoSymbole />
          Désigno
        </p>
        <div className="rounded-panel border border-line bg-white p-8 max-sm:p-6">{children}</div>
      </main>
    </div>
  );
}
