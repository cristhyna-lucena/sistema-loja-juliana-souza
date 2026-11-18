# Juliana Souza - redesign premium

## Inventário e ponto de restauração

O projeto existente foi mantido em Next.js 16.4.3, React 19 e TypeScript, com loja e painel separados. O frontend público apresenta seis linhas em um catálogo local de apresentação; não está conectado a preços, estoque ou checkout do catálogo privado.

Antes das alterações foi criado `artifacts/restauracao-premium-2026-11-04.zip`, com 69 arquivos originais do frontend, imagens, fontes, configurações dos aplicativos, documentação e teste visual anterior. O ZIP foi verificado por integridade e comparado com os arquivos finais. Não inclui credenciais ou banco de dados.

| Área | Estrutura existente | Tratamento |
|---|---|---|
| Loja `/` | `page.tsx`, `storefront.tsx`, `discovery.tsx` | Nova composição, mesmas linhas e interações |
| Detalhes | Modal nativo das seis linhas | Imagem inteira, tipografia e enquadramento responsivos |
| Busca e categorias | Estado local, normalização de acentos | Busca central adicionada ao cabeçalho, estado compartilhado |
| Guia, ritual e FAQ | Radios, checkboxes e details | Comportamento preservado |
| Login `/login` | Formulário, mostrar senha, proxy de autenticação | Nova apresentação, mesma autenticação |
| Painel `/` | Usuário e contagens obtidos pela API | Saudação, indicadores, barra com a proporção real de ativos |
| Produtos e categorias | Listas, filtros, paginação, novo e edição | Linguagem visual comum em tabelas e formulários |
| Galeria | Upload, ordenação, principal, prévia e restauração | Controles e lógica preservados; acabamento e imagem contain |
| Financeiro, operação, configurações | Acesso por perfil e módulos em preparação | Estados e permissões preservados |
| Fontes | Allura e Lato locais | Allura para identidade; Montserrat local para leitura funcional |
| Imagens | WebP oficiais e dois arranjos PNG transparentes | Arquivos preservados, sem recriar embalagens ou rótulos |

## Arquivos alterados

- `apps/loja/app/storefront.tsx`: cabeçalho com busca, banner “Beleza que Transforma”, navegação móvel inferior, vitrines, banners das linhas, seção futura de vídeos e rodapé.
- `apps/loja/app/discovery.tsx`: categorias reais em círculos, mantendo os filtros existentes.
- `apps/loja/app/layout.tsx`: utiliza a fundação compartilhada e o novo CSS da loja. Os antigos `globals.css` e `refinement.css` foram mantidos no disco, mas não são carregados pela loja.
- `apps/admin/app/layout.tsx`: carrega a fundação compartilhada e o acabamento premium após os estilos estruturais existentes.
- `apps/admin/app/(painel)/page.tsx`: saudação com o usuário autenticado e visualização da proporção de produtos ativos, exclusivamente quando os dados reais estão disponíveis.
- `apps/admin/components/catalog-list.tsx`: região da tabela identificada e acessível por teclado para rolagem horizontal; dica de rolagem também no tablet.
- `tests/storefront-visual.mjs`: atualizado para o novo cabeçalho, campanhas e estado futuro de vídeos.

## Arquivos e componentes criados

- `packages/ui/src/premium.css`: cores oficiais da nova direção, gradientes, tipografia e tokens compartilhados.
- `apps/loja/app/premium.css`: layout completo de desktop, notebook, tablet e celular, sem as camadas sucessivas do CSS anterior.
- `apps/admin/app/premium.css`: sidebar, saudação, indicadores, tabelas, formulários, galeria e login.
- `apps/loja/app/premium.tsx`: `StoreIcon`, `Butterfly`, `LineCampaign`, `CareVideos` e o contrato `CareClip`.
- `apps/{loja,admin}/public/fonts/Montserrat-Variable.ttf` e `LICENSE-montserrat.txt`: fonte oficial do repositório Google Fonts, armazenada localmente com sua licença.
- `tests/admin-premium-visual.mjs`: QA com API efêmera de fixtures, sem conexão ao banco real.

## Conferência visual

A imagem `[caminho local omitido]` foi tratada como referência estética, não aplicada como fundo da interface. A estrutura usa HTML, controles reais, fotografias e decoração independentes.

As capturas iniciais de desktop e celular foram comparadas com a referência. Foram refinados o banner, categorias circulares, botões rosé, hierarquia da vitrine e flores nas extremidades. Na revisão seguinte, os botões móveis ganharam melhor leitura, os cartões de vídeos ganharam proporção vertical e foi removido o isolamento de mistura do produto no banner para integrá-lo ao fundo sem editar a fotografia. A versão de 360 px recebeu ajuste específico no título do hero. O nome correto **Sakura Essencial Care** foi mantido em todos os textos novos.

Na conferência final, a decoração esquerda do hero foi retirada para deixar a chamada livre; as flores permanecem à direita e nos banners das linhas. As borboletas dos banners menores foram reposicionadas no desktop e ocultadas no celular para não disputar espaço com as chamadas.

No painel, foram inspecionados o início em desktop e celular, o login, formulários e galeria, além dos demais estados capturados. A decoração é limitada às áreas de identidade; dados e controles mantêm fonte funcional.

## Telas e verificações

Larguras: **1440, 1024, 768, 390 e 360 px**, em Chromium local.

- Builds de produção da loja e do admin aprovados, incluindo TypeScript.
- Loja: carregamento das imagens, `object-fit: contain`, alturas consistentes dos cards, títulos sem excesso de largura, ausência de rolagem horizontal e erros JavaScript.
- Busca no cabeçalho e catálogo, filtros, estado vazio/limpeza, detalhes das seis linhas, campanhas, Escape para fechar modal, guia facial, seleção/limpeza do ritual, FAQ e menu móvel aprovados.
- Vídeos: três cartões explicitamente “em breve”; nenhum autoplay ou depoimento inventado. O componente preparado usa controles nativos, `playsInline`, `preload="none"`, poster e legenda opcional quando recebe conteúdo autorizado.
- Admin: **55 capturas**, incluindo login, início, produtos, categorias, novo/edição de ambos, galeria e três módulos em preparação, nas cinco larguras. Login, mostrar/ocultar senha, saída, filtros, estado vazio, envio de formulário para o servidor efêmero, prévia da foto e navegação por perfil foram verificados.
- As capturas administrativas usam nome, produto e categoria explicitamente identificados como teste visual, com marca d'água. A API de fixtures existe somente no processo do teste e não altera a autenticação da aplicação.
- Teste geral existente de saúde: loja e admin aprovados; API falhou na inicialização. O Docker local está desligado e o serviço informa indisponibilidade de banco/Redis/ambiente. Nenhuma mudança de infraestrutura ou credencial foi feita.

Comandos usados:

```text
node apps/loja/node_modules/next/dist/bin/next build apps/loja
node apps/admin/node_modules/next/dist/bin/next build apps/admin
node tests/storefront-visual.mjs
node tests/admin-premium-visual.mjs
node --test tests/health.test.mjs
```

O teste da loja precisa de um servidor local em `http://127.0.0.1:3000`, ou de `STOREFRONT_URL`. O teste administrativo sobe e encerra seu próprio servidor e fixtures.

## Evidências

Em `artifacts/premium-2026-11-04/`:

- `loja-{largura}.png`: capturas completas do site.
- `login-{largura}.png`: login.
- `painel-teste-{largura}.png`: início administrativo com dados de teste identificados.
- `produtos-teste-*`, `categorias-teste-*`, `produto-novo-teste-*`, `produto-editar-teste-*`, `categoria-nova-teste-*`, `categoria-editar-teste-*`: listas e formulários.
- `financeiro-teste-*`, `operacao-teste-*`, `configuracoes-teste-*`: módulos futuros.
- `validation.json`, `admin-validation.json` e `health-check.log`: resultados das verificações.

## Diferenças restantes e arquivos necessários

| Referência | Implementação e motivo |
|---|---|
| Modelo com laço e retratos de beleza | Não há esses arquivos oficiais separados. O banner usa os produtos e flores disponíveis. Para reproduzir essa composição, faltam os retratos autorizados em alta resolução. |
| Seis categorias, presentes e serviços | Foram exibidas apenas as três categorias realmente existentes no catálogo público. |
| Preços, comprar, carrinho, conta e favoritos | A loja continua um catálogo de apresentação. Não foram inventados preços nem simulados pedidos. Os atalhos levam ao catálogo, guia e ritual existentes. |
| Frete, parcelamento, selos e formulações | Não foram exibidas condições ou características sem confirmação. A faixa de benefícios usa conteúdo já existente. |
| Dashboard com vendas e gráfico semanal | Não existe fonte de vendas implementada. Mantidas as contagens reais de catálogo e uma barra derivada desses dados; sem faturamento ou série histórica fictícios. |
| Vídeos de clientes | Faltam MP4/WebM autorizados, capas, associação à linha e legendas. O componente e o carrossel estão preparados, mas não existe upload/gestão administrativa de vídeos. |
| Newsletter, redes sociais e políticas | Sem serviços/URLs oficiais configurados. Rodapé usa somente links operacionais existentes. |

Para ativar os vídeos, primeiro fornecer os arquivos autorizados e sua relação com os produtos. A integração de armazenamento, consentimento e cadastro no painel precisa de uma etapa própria de arquitetura; não foi criada nesta revisão.

Limites: não foram testados Safari, Firefox ou aparelhos físicos. Operações reais de autenticação, persistência, upload, pagamento e infraestrutura não foram validadas; as verificações administrativas foram isoladas. Não houve deploy.

## Restauração

Para restaurar a apresentação anterior, parar os servidores, extrair o ZIP de restauração na raiz do projeto e retirar os arquivos novos listados acima. Isso recupera os arquivos alterados sem envolver banco, credenciais ou cadastros. O build deve ser refeito após a restauração.
