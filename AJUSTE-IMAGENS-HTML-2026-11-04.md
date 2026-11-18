# Juliana Souza - HTML e enquadramento das imagens

## Origem e diagnóstico

Referência: `[caminho local omitido]`.

O arquivo original foi preservado. Antes dos ajustes, foi criado e verificado o backup `artifacts/restauracao-html-imagens-2026-11-04.zip`.

No HTML, o banner aplicava largura de 112% no desktop, 150% no celular e deslocamento horizontal por transform. Os banners promocionais utilizavam cover. Algumas imagens já eram recortes da arte, com partes da embalagem ausentes; CSS não recupera os pixels que faltam. A vitrine também apontava para arquivos externos `assets/prod_*.webp` que não estavam presentes no HTML único.

## Correções no projeto

- `apps/loja/app/storefront.tsx`: composição do banner baseada no HTML recebido, com retrato editorial, chamada e produtos em áreas separadas.
- `apps/loja/app/premium.css`: imagens oficiais dos produtos com contain e posição central; sem zoom ou deslocamento. Área dos cards de 240 px no desktop e 180 px até 768 px, com padding. Banners com respiro e escala limitada. Círculos com margem suficiente para não recortar as embalagens nas extremidades arredondadas.
- `apps/loja/public/brand/html-reference/beleza-editorial.webp`: retrato extraído do HTML recebido, sem alterar a imagem. Cover é utilizado somente nesse elemento decorativo, não nos produtos.
- `tests/storefront-visual.mjs`: agora verifica também posição central, encaixe dentro dos wrappers e respiro mínimo das fotografias.

A loja mantém suas seis linhas, categorias, busca, filtros, detalhes, guia e ritual. O painel administrativo real e o backend não foram alterados nesta etapa.

## HTML avulso entregue

`output/html/Juliana-Souza-HTML-imagens-corrigidas.html`.

É uma cópia revisada e independente, com imagens e fontes embutidas. Pode ser aberta diretamente no navegador. Os recortes de produtos foram substituídos por fotografias oficiais completas e as referências ausentes da vitrine foram resolvidas. O produto Body Splash, que não tinha fotografia oficial disponível no projeto, foi substituído na demonstração pelo sérum Lúminë existente, sem criar uma embalagem fictícia. As apresentações foram alinhadas às fotografias e os preços ilustrativos da vitrine foram retirados.

Também foram corrigidos o título do hero e um transbordamento do painel demonstrativo em telas menores. A newsletter, a conta, o carrinho e a gestão desse HTML continuam demonstrações identificadas, sem conexão a operações reais. Esses módulos demonstrativos não foram importados para substituir o painel real do projeto.

## Verificação

- Build de produção da loja e TypeScript aprovados.
- Chromium em 1440, 1024, 768, 390 e 360 px: loja e HTML avulso.
- Imagens carregadas, contain, posição central, limites dos contêineres, margens internas e ausência de rolagem horizontal indevida verificados.
- Capturas reais inspecionadas em desktop e celular.
- Loja: busca, filtros, seis modais, campanhas, guia, ritual, FAQ e menu móvel aprovados.
- HTML: imagens embutidas, filtros, modal e troca entre loja e gestão demonstrativa aprovados.
- Evidências em `artifacts/imagens-html-2026-11-04/`: `loja-*.png`, `html-*.png`, `html-gestao-*.png`, `validation.json` e `html-validation.json`.

Comandos: `node tests/storefront-visual.mjs` (servidor da loja ativo), `node tests/html-images-visual.mjs` e `node apps/loja/node_modules/next/dist/bin/next build apps/loja`.

Limites: sem testes em aparelhos físicos, Safari ou Firefox. Não houve deploy. As imagens decorativas extraídas do HTML conservam a resolução e o conteúdo rasterizado do material recebido; não foram apresentadas como novas fotografias oficiais de produtos.
