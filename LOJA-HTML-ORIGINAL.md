# Referência vigente da loja

A cliente confirmou em 17/11/2026 o HTML mais atualizado da lista apresentada: `Juliana-Souza-Atualização Original (3).html`, recebido em Downloads. A cópia preservada está em `references/loja/Juliana-Souza-Atualizacao-Original-3.html`.

Esta referência substitui a interpretação visual anterior de `apps/loja/app/storefront.tsx`. A página inicial agora entrega o HTML importado por `apps/loja/app/route.ts`; não utiliza aquele componente antigo.

O importador `infra/import-original-storefront.py` mantém a marcação, os estilos e os scripts originais e extrai imagens/fontes incorporadas para arquivos locais sem alterar seus bytes. A saída fica em `apps/loja/public/original-storefront.html`, `apps/loja/public/brand/html-original/` e `apps/loja/app/original-html.css`. Execute `python infra/import-original-storefront.py` para reconstruir a partir da referência preservada.

`original-storefront-bridge.js` conecta conta, carrinho e gestão às áreas reais. Os detalhes do catálogo levam à consulta dos produtos publicados no sistema, sem inventar preços ou estoque. Favoritos e a manifestação de interesse na newsletter conservam o comportamento local do HTML. O cadastro de interesse informa que ainda não envia e-mails.

As páginas reais de compra e conta usam o cabeçalho, a logo, os estilos e o rodapé dessa mesma referência. A gestão real continua protegida pelo login; os botões de gestão do HTML encaminham para o painel real.

Validação: `node tests/storefront-html-original.mjs` compara a composição da referência com a loja em 1440, 1024, 768, 390 e 360 px, verifica transbordamento e testa os acessos reais. Capturas: `artifacts/html-original-aplicado/`. A comparação de pixels do banner e benefícios em desktop não encontrou diferenças. A suíte `test:operacoes:painel` aprovou os oito testes após a troca visual.

A compilação da loja foi concluída. Na etapa seguinte de finalização, Next.js foi atualizado para 16.4.5 e o Multer utilizado pela API para 2.5.0. A auditoria completa passou sem vulnerabilidades conhecidas; resultado em `artifacts/auditoria-finalizacao.json`. O visual do HTML aprovado foi preservado e não houve publicação.
