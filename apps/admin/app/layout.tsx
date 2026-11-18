import type { Metadata } from "next";
import "./globals.css";
import "@sistema/ui/src/premium.css";
import "./premium.css";
import "./gestao.css";
import "./comercial.css";
import "./pink-gold.css";
export const metadata: Metadata = { title: "Juliana Souza | Painel", description: "Plataforma de gestão e loja virtual" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }

