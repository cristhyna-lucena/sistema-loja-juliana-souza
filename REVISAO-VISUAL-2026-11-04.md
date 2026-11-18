# Revisão visual Juliana Souza — 04/11/2026

## Diagnóstico

A loja pública tem uma rota (`/`), montada por `page.tsx`, `storefront.tsx` e `discovery.tsx`. O primeiro componente concentra cabeçalho, catálogo, busca, filtros, destaques e modal; o segundo contém categorias, guia, seleção de ritual e FAQ. `layout.tsx` carrega os estilos. As fontes Allura e Lato e as fotografias WebP são locais em `public/fonts` e `public/products`; a logo e os arranjos oficiais estão em `public/brand`.

O CSS existente tem camadas sucessivas de personalização: cores diferentes da paleta solicitada, tamanhos cursivos fixos após regras móveis, diferentes enquadramentos do banner e espaçamentos específicos para Meraki. As fotos já utilizavam `contain`; o refinamento preserva essa escolha e remove a ampliação ao passar o mouse. Uma regra específica de Meraki deixava o card mais alto no tablet, identificada nas capturas e corrigida.

## Arquivos e melhorias

- `apps/loja/app/refinement.css` (novo): acabamento visual separado dos estilos anteriores, com a paleta oficial, Allura responsiva e espaço para seus traços, Lato nos textos funcionais, superfícies leves, bordas discretas, margens proporcionais nas imagens, alturas consistentes dos cards, links alinhados, foco visível e menu móvel com altura limitada à tela e rolagem interna.
- `apps/loja/app/layout.tsx`: importa o refinamento após os estilos existentes.
- `tests/storefront-visual.mjs` (novo): verificação reproduzível de apresentação e interações. Executar com servidor de produção ativo: `node tests/storefront-visual.mjs`. URL opcional em `STOREFRONT_URL`.
- `artifacts/refinamento-2026-11-04/`: capturas completas nas cinco larguras e relatório `validation.json`.

As imagens oficiais não foram editadas ou substituídas. Componentes, conteúdo, rotas, estado e lógica operacional foram preservados. O painel administrativo e o backend não receberam alterações. Os avisos de compra futura continuam presentes.

## Validação

- TypeScript da loja: aprovado (`node node_modules/typescript/bin/tsc --noEmit -p apps/loja/tsconfig.json`).
- Build de produção Next.js: aprovado (`node apps/loja/node_modules/next/dist/bin/next build apps/loja`), incluindo TypeScript.
- Chromium/Playwright: larguras 1440, 1024, 768, 390 e 360 px. Capturas de página completa e inspeção visual; checagem de imagens carregadas com `contain`, títulos sem excesso de largura, cards com alturas iguais, ausência de rolagem horizontal e erros JavaScript.
- Interações nas cinco larguras: filtro facial, busca, estado vazio e limpeza, abertura/fechamento das seis linhas, guia facial, seleção/limpeza de ritual e FAQ. Menu móvel verificado em 390 e 360 px.
- Teste existente `node --test tests/health.test.mjs`: loja e admin aprovados; API falhou ao iniciar, com mensagem para verificar banco, Redis e variáveis de ambiente. Não foi possível determinar qual dependência impediu a inicialização apenas por essa mensagem.

## Limites

Validação em Chromium local; Safari, Firefox e aparelhos físicos não foram testados. Login autenticado, operações administrativas e integrações dependentes da API não foram retestados. Nenhum deploy foi realizado. O servidor usado para QA é encerrado ao fim da revisão.
