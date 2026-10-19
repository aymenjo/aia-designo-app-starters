import type { Plan } from "@/lib/abonnement/plans";

const LIBELLES: Record<Plan, string> = { free: "Free", pro: "Pro" };

const styles: Record<Plan, string> = {
  free: "border-line bg-surface text-ink",
  pro: "border-transparent bg-ink text-white",
};

/** La pilule d'un plan, en mono majuscules : « FREE » sur gris, « PRO » en encre (DESIGN.md, cadenas Pro). */
export function PastillePlan({ plan = "pro" }: { plan?: Plan }) {
  return (
    <span
      className={`inline-flex h-6 w-fit flex-none items-center rounded-full border px-2.5 font-mono text-meta font-medium uppercase ${styles[plan]}`}
    >
      {LIBELLES[plan]}
    </span>
  );
}
