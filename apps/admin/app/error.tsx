"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="error-page"><h1>Não foi possível carregar o painel.</h1><p>Tente novamente em instantes.</p><button onClick={reset}>Tentar novamente</button></main>; }
