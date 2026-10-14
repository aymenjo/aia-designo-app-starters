import { Logo } from "@/components/Logo";

export default function LayoutConnexion({ children }: LayoutProps<"/connexion">) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface px-4 py-12">
      <main className="grid w-full max-w-[400px] gap-6">
        <div className="justify-self-center">
          <Logo href="/" />
        </div>
        <div className="rounded-panel border border-line bg-white p-8 max-sm:p-6">{children}</div>
      </main>
    </div>
  );
}
