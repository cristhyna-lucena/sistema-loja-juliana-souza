import type { Metadata } from "next";
import "@sistema/ui/src/premium.css";
import "./original-html.css";
import "./shop.css";
export const metadata: Metadata = { title: "Juliana Souza | Cabelos, pele e cuidado diário", description: "Sua loja de cosméticos Juliana Souza. Conheça as linhas Sakura, Milagre Capilar, Ritual dos Cachos, Scalp Hair, Lúminë e Meraki." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }

