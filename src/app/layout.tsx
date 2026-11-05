import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Les variables écrasent celles de @theme (docs/DESIGN.md, « Loading »).
const display = Plus_Jakarta_Sans({
  variable: "--font-display",
  weight: ["700", "800"],
  subsets: ["latin"],
});

const sans = Geist({
  variable: "--font-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  weight: ["500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Désigno", template: "%s · Désigno" },
  description:
    "Ne laissez plus filer une échéance de désignation : Désigno lit vos avis, retrouve le conducteur et prépare le récap ANTAI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
