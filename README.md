# Sistema Loja

Referência visual vigente: [HTML original mais atualizado confirmado pela cliente](LOJA-HTML-ORIGINAL.md). A página inicial usa esse HTML preservado, e não a interpretação anterior do catálogo.

Gestão: [rotas, regras e pendências](GESTAO-BACKEND.md). Clientes, fornecedores, estoque manual, custo médio e alertas de reposição e validade implementados na API e nas telas do painel.

Comercial: [vendas no balcão e financeiro](COMERCIAL.md), com baixa automática de estoque, recebimentos parciais, contas a pagar/receber, caixa e cancelamento com estornos.

Sistema descrito no Planner Técnico. Inclui autenticação, catálogo, fotos, estoque, vendas, compras, serviços/vouchers, financeiro, administração, fiscal e checkout da loja. Consulte [operações e integrações](OPERACOES-INTEGRACOES.md) para configuração e limites de validação. A publicação permanece pendente por solicitação da cliente.

## Requisitos

- Node.js 24 LTS e npm.
- pnpm 12.15.0, executável sem instalação global com `npx --yes pnpm@12.15.0`.

## Instalar e verificar

```powershell
npx --yes pnpm@12.15.0 install --frozen-lockfile
npx --yes pnpm@12.15.0 typecheck
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 test
```

## Executar

```powershell
npx --yes pnpm@12.15.0 dev
```

- Loja: http://127.0.0.1:3000
- Painel: http://127.0.0.1:3001/login
- API: http://127.0.0.1:3002/health
- Worker: processamento e limpeza das fotos, sem porta pública.

Os comandos de desenvolvimento escutam somente em localhost. `/health` confirma que a API está executando; `/health/ready` consulta o PostgreSQL. A API exige PostgreSQL e Redis disponíveis para iniciar.

## Organização

`apps/loja`, `apps/admin`: Next.js. `apps/api`: NestJS. `apps/worker`: base do processador de filas. `packages/shared`, `packages/ui`, `packages/db`, `packages/integracoes`: pacotes compartilhados preparados para as próximas etapas.

As versões do framework foram selecionadas a partir do registro npm disponível na preparação, em vez de reproduzir automaticamente as versões antigas do planner. Nenhuma integração fiscal, pagamento ou publicação está ativa. A API usa o banco para autenticação, sessões, permissões e auditoria.

## Banco e Redis locais — etapa 2

Inicie o Docker Desktop e execute na raiz do projeto:

```powershell
npx --yes pnpm@12.15.0 infra:env
npx --yes pnpm@12.15.0 media:env
npx --yes pnpm@12.15.0 media:build
npx --yes pnpm@12.15.0 infra:up
npx --yes pnpm@12.15.0 db:migrate
npx --yes pnpm@12.15.0 db:status
npx --yes pnpm@12.15.0 test:infra
```

`infra:env` gera senhas aleatórias no `.env` e preserva qualquer arquivo existente. O `.env` é ignorado pelo Git e não deve ser compartilhado. Não troque suas senhas sem sincronizar os serviços já inicializados.

PostgreSQL 16 escuta em `127.0.0.1:5433`, Redis 7 em `127.0.0.1:6380`. Os dois usam volumes persistentes e verificações de saúde. Para parar sem apagar os dados:

```powershell
npx --yes pnpm@12.15.0 infra:stop
```

A primeira migration cria Empresa, Usuario, AuditLog e Perfil. E-mails são únicos por empresa, e a chave estrangeira composta impede vincular uma auditoria ao usuário de outra empresa. O isolamento das consultas por empresa será implementado junto da autenticação; estas relações não substituem autorização na API.

`packages/db` gera o Prisma Client e compila para `dist`. `createDatabase(connectionString)` cria um cliente; o consumidor deve encerrá-lo com `$disconnect()`. Builds e verificação de tipos geram o cliente sem exigir um servidor PostgreSQL ativo.

Os testes de infraestrutura precisam dos containers ativos e das migrations aplicadas. Escritas no PostgreSQL são feitas em transações desfeitas ao final dos testes. A chave temporária do Redis é removida e também possui expiração. O teste geral das páginas continua disponível com `pnpm test` após o build.

Comandos úteis para alterações futuras no schema:

```powershell
npx --yes pnpm@12.15.0 --filter @sistema/db validate
npx --yes pnpm@12.15.0 --filter @sistema/db migrate:dev --name nome_da_alteracao
```

Referência técnica: [configuração do Prisma](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference) e [geração do cliente](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators).

## Login e permissões — etapa 3

Com os serviços iniciados, migrations aplicadas e o projeto compilado, crie o primeiro administrador em um terminal interativo:

```powershell
npx --yes pnpm@12.15.0 admin:create
```

O comando pede nome da empresa, nome do administrador, e-mail e senha com confirmação. A digitação da senha fica oculta. A senha deve ter entre 12 e 128 caracteres. Não há senha padrão, cadastro público de operadores nem conta de demonstração permanente. O comando recusa criar um segundo administrador na empresa e registra a criação em auditoria. Não informe sua senha pelo chat.

Depois execute `npx --yes pnpm@12.15.0 dev` e abra http://127.0.0.1:3001/login. Use esse endereço de forma consistente, pois a origem permitida é configurada explicitamente. O administrador real não foi criado automaticamente nesta etapa.

- ADMIN: configurações, financeiro e operação.
- CONTADORA: financeiro.
- OPERADOR: operação.
- Todos os perfis autenticados: início e identificação da própria sessão.

Os módulos comerciais possuem telas e permissões próprias. Recuperação de senha está disponível mediante configuração do serviço de e-mail; o gerenciamento de usuários fica em Configurações.

As senhas usam Argon2id (64 MiB, três iterações, paralelismo 1). A sessão tem validade absoluta de oito horas, token aleatório de 32 bytes e apenas seu hash SHA-256 no banco. O cookie é HttpOnly, SameSite=Lax e host-only. Em produção, exige HTTPS e usa Secure com o nome `__Host-loja_session`. Novo login substitui a sessão apresentada; logout revoga a sessão no banco e remove o cookie. Cada acesso relê o usuário e sua empresa, impedindo acesso de contas desativadas.

O painel encaminha as chamadas de autenticação por `/api/auth/*`, na mesma origem do navegador. A API verifica a origem nos POSTs de login/logout. Não há CORS liberado. Respostas de autenticação não são armazenadas em cache.

Variáveis de execução (os valores locais abaixo são os padrões):

```text
ADMIN_ORIGIN=http://127.0.0.1:3001
API_INTERNAL_URL=http://127.0.0.1:3002
```

A API lê o `.env` da raiz. Variáveis personalizadas do painel devem ser passadas ao processo Next.js pelo ambiente ou pelo arquivo `.env.local` de `apps/admin` (ignorado pelo Git). `API_INTERNAL_URL` é uma variável do servidor e nunca deve usar o prefixo NEXT_PUBLIC. Em produção, defina NODE_ENV=production e ADMIN_ORIGIN com a origem HTTPS exata. Havendo mais de uma empresa ativa, configure EMPRESA_ID na API e no comando de criação do administrador.

O Redis limita tentativas a cinco por e-mail em 15 minutos e 30 por endereço de conexão da API por minuto, incluindo tentativas bem-sucedidas. Pelo proxy local, o endereço de conexão é o servidor do painel. O tratamento de endereços do proxy de produção depende da topologia de deploy e não foi habilitado implicitamente. Falha do Redis bloqueia novas tentativas de login.

## Testes de autenticação e navegador

```powershell
npx --yes pnpm@12.15.0 exec playwright install chromium
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 test:auth
```

A suíte usa o PostgreSQL e Redis locais reais, empresas e usuários temporários, e instâncias de teste da API e do painel. Os registros criados e as chaves de teste são removidos ao concluir. Os servidores de teste também são encerrados. As portas 43137 a 43140 devem estar livres. As capturas de tela ficam em `artifacts/`, com usuários fictícios.

Referências: [node-argon2](https://github.com/ranisalt/node-argon2), [cliente Node.js do Redis](https://redis.io/docs/latest/develop/clients/nodejs/connect/) e [cookies no Next.js](https://nextjs.org/docs/app/api-reference/functions/cookies).

## Produtos e categorias — etapa 4

No painel, use os menus Produtos e Categorias. Administrador e operador podem criar, editar, pesquisar, ativar e desativar cadastros. A contadora não tem acesso ao catálogo, inclusive pela API.

- Produtos: nome, descrição, SKU, tipo (revenda, insumo ou ambos), unidade, preço, categoria opcional e status.
- Categorias: nome e status. Nomes repetidos na mesma empresa são recusados, considerando normalização de espaços, Unicode e maiúsculas/minúsculas.
- SKU normalizado para maiúsculas e único por empresa. Aceita até 64 letras sem acentos, números, ponto, barra, hífen e sublinhado.
- Preço aceita vírgula ou ponto, até dez dígitos inteiros e duas casas decimais. Zero é permitido, inclusive para insumos sem preço de revenda. Valores negativos, numéricos JSON e casas decimais excedentes são recusados. A API recebe e devolve preços como texto e o banco usa Decimal(12,2).
- Produto pode ficar sem categoria. Categoria inativa não aceita novos vínculos; vínculos existentes são preservados.
- Edições verificam uma versão numérica para impedir que duas pessoas sobrescrevam alterações. O segundo salvamento com a versão antiga responde 409 e permite recarregar o cadastro.
- Alterações e auditoria são gravadas na mesma transação. Falha na auditoria desfaz a alteração.
- Listas têm busca, status e paginação. Produto pode ser buscado por nome ou SKU.

Rotas da API: GET/POST `/produtos` e `/categorias`; GET/PATCH `/produtos/:id` e `/categorias/:id`; GET `/categorias/opcoes`. O PATCH exige `versao` atual e pelo menos um campo a alterar. Não há DELETE. A empresa vem da sessão; campos não reconhecidos no corpo e nas consultas são recusados. As mutações também verificam origem e JSON.

As validações Zod ficam em `packages/shared`, compilado para CommonJS e declarações TypeScript para uso na API e nas telas. Documentação: [schemas do Zod](https://zod.dev/api) e [transações e controle de concorrência no Prisma](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

Essa etapa não publica produtos na loja e não altera estoque. Fotos, dados fiscais, lotes, validades e movimentações terão entregas próprias.

### Testes do catálogo

```powershell
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 test:catalogo
```

A suíte exige PostgreSQL e Redis locais ativos, Chromium instalado e portas 43147/43149 livres. Ela cria um banco `sistema_loja_test_catalogo_<identificador aleatório>`, aplica as migrations, testa a API e percorre as telas com Playwright. O banco temporário é removido ao final; os dados comerciais e o administrador da instalação local são preservados. A role PostgreSQL local precisa poder criar bancos de teste.

São verificados duplicidade, precisão de centavos, preço negativo no banco, isolamento de empresas, proteção de origem, permissões, ativação/inativação, paginação, conflitos de edição e rollback em falha da auditoria. O navegador testa criação, edição, busca, erro de SKU duplicado, bloqueio da contadora e layout móvel. Capturas ficam em `artifacts/catalogo-*.png`.


## Fotos dos produtos — etapa 5

Abra Produtos → Editar → Gerenciar fotos deste produto. O produto precisa estar salvo. Administrador e operador podem gerenciar a galeria; contadora não tem acesso. A galeria salva suas operações separadamente dos demais campos do produto.

- Até oito fotos ativas por produto, incluindo envios pendentes ou com erro. Para repetir uma foto com erro, use Trocar arquivo; isso não exige uma nona vaga.
- JPG, PNG, WebP e HEIC/HEIF, até 15 MiB e 40 megapixels.
- Seleção de vários arquivos, arrastar arquivos, progresso de envio e processamento em segundo plano.
- Descrição alternativa obrigatória, sugerida pelo nome do produto.
- Ordenação por arraste ou setas e escolha da foto principal. A primeira foto disponível é usada como principal e aparece na lista de produtos.
- Troca preserva a foto anterior até a nova ficar pronta. Se a conversão falhar, a anterior continua disponível.
- Remoção imediata da galeria, com restauração por até sete dias. A limpeza física ocorre no primeiro ciclo do worker após esse prazo.
- Prévia de card, página de produto e zoom. A entrega é autenticada e privada; não há bucket público ou CDN configurado nesta etapa.

### Armazenamento e execução

O MinIO local usa as portas 19000 (S3) e 19001 (console), limitadas ao computador local. O volume `minio_data` mantém os arquivos entre reinicializações. As credenciais são geradas em `.env` por `media:env`, sem alterar variáveis existentes ou exibir segredos.

```powershell
npx --yes pnpm@12.15.0 media:env
npx --yes pnpm@12.15.0 media:build
npx --yes pnpm@12.15.0 infra:up
npx --yes pnpm@12.15.0 db:migrate
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 dev
```

`dev` inicia também o worker. Para executar o worker já compilado separadamente: `npx --yes pnpm@12.15.0 --filter @sistema/worker start`. Não execute duas instâncias de desenvolvimento sem necessidade.

A imagem pronta do MinIO Community não estava disponível nos registros consultados. O Dockerfile compila o código oficial no commit `7aac2a2c5b7c882e68c1ce017d8256be2feea27f`, com licença e aviso preservados na imagem. O [repositório oficial](https://github.com/minio/minio) foi arquivado e informa que não é mais mantido. Esse build atende ao ambiente local; o provedor S3 e sua manutenção devem ser revistos na implantação de produção.

As fotos ficam no volume do Docker, e não dentro da pasta do código ou do OneDrive. Backup externo do armazenamento será tratado na etapa de implantação. Os testes usam bucket e banco próprios e não apagam arquivos da instalação principal.

### Fluxo técnico

1. A API reserva a foto em transação, com trava no produto para garantir o limite de oito.
2. O navegador reduz JPEG/PNG/WebP para até 2560 px e aproximadamente 1 MiB quando possível; HEIC segue para conversão no servidor.
3. A API fornece um PUT assinado por cinco minutos, com tipo e tamanho vinculados à assinatura. Os bytes vão diretamente ao MinIO; a API não recebe o arquivo binário de upload.
4. A confirmação confere tamanho/ETag e grava PROCESSANDO no PostgreSQL. Essa linha é a pendência durável; o worker reconcilia a fila a cada 15 segundos.
5. BullMQ usa um job único por foto/tentativa, até três tentativas e espera exponencial. Uma confirmação repetida não duplica o processamento.
6. O worker valida os bytes reais antes de decodificar. Recusa SVG, GIF/animação, conteúdo inválido e imagens acima dos limites.
7. Sharp corrige orientação, converte para sRGB, remove metadados das versões exibidas e enquadra em quadrado com fundo branco, sem cortar a imagem.
8. Gera AVIF e WebP de 160/480/1024/2048 px, JPEG de 1024 px e placeholder de 16 px. O original recebido fica privado em chave separada do arquivo temporário de envio.
9. Uma troca só altera a referência atual depois de todos os arquivos novos estarem gravados. Arquivos antigos ficam retidos por sete dias.
10. O worker limpa temporários e arquivos vencidos a cada minuto. Reservas não confirmadas expiram em 15 minutos. Um envio já confirmado em PROCESSANDO é preservado enquanto aguarda recuperação.

As fotos têm chave com empresa, produto, imagem, tentativa e hash. URLs de upload não permitem alterar os arquivos já validados. As versões são servidas pela API/painel com sessão, checagem de empresa/perfil, `nosniff` e cache privado sem armazenamento. O original não tem rota de download pelo painel.

Rotas sob `/produtos/:produtoId/imagens`: GET galeria; POST iniciar/ordenar; POST `:id/confirmar`, `:id/remover`, `:id/restaurar`, `:id/cancelar`; PATCH `:id` para descrição; GET `:id/arquivo/:variant` para versões permitidas. Ordenação, descrição, remoção e restauração exigem a versão atual da galeria.

### Testes das fotos

```powershell
npx --yes pnpm@12.15.0 test:fotos
```

Exige serviços locais ativos, build e Chromium instalado. Usa portas 43157/43159, banco `sistema_loja_test_fotos_<id>`, bucket `sistema-loja-fotos-test-<id>` e namespace Redis próprios, removidos ao terminar.

A suíte verifica permissões, origem, tamanho assinado, conteúdo disfarçado, limite de pixels, HEIC real, versões e ausência de EXIF, precisão da ordenação, trocas com falha, limite concorrente de oito fotos, cancelamento, expiração, recuperação de job perdido, remoção/restauração e limpeza após prazo. O navegador percorre envio direto ao S3, arraste, escolha de principal, troca, prévia, remoção, restauração, miniaturas e acesso móvel.

A amostra HEIC usada somente nos testes vem de [libheif/examples/example.heic](https://github.com/strukturag/libheif/blob/12a259a5882dd99d45ec5fc77e296a3b620d1e2e/examples/example.heic), com origem fixada e hash SHA-256 verificado. Ela é baixada para `artifacts/` (ignorado pelo Git), sem ser usada como foto de produto real. Capturas ficam em `artifacts/fotos-galeria-*.png`.

Referências: [Sharp](https://sharp.pixelplumbing.com/api-output/), [BullMQ e jobs idempotentes](https://docs.bullmq.io/patterns/idempotent-jobs), [heic-decode](https://github.com/catdad-experiments/heic-decode) e [CORS do MinIO](https://docs.min.io/aistor/administration/cors-configuration/).

## Visual do painel

O painel recebeu identidade Juliana Souza em rosé, dourado e branco quente, com a logo oficial e detalhes discretos de Sakura, navegação adaptada ao celular, login renovado, cartões com dados reais do catálogo e apresentação consistente para produtos, categorias, formulários e fotos. A direção visual está documentada em [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).

Acesso local: http://127.0.0.1:3001/login. A loja pública está em http://127.0.0.1:3000, com produtos publicados pelo painel e checkout integrado ao estoque e financeiro. Os provedores externos precisam ser configurados e homologados antes do uso real.

## Preparação para publicação

O roteiro de execução, os campos de infraestrutura e os comandos de produção estão em [PUBLICACAO.md](PUBLICACAO.md). Após compilar e configurar o servidor, `pnpm start` inicia loja, painel, API e worker. A preparação local não publica nem ativa integrações.

## Testes E2E completos

A execução consolidada dos percursos do navegador, APIs, banco, fotos e integrações simuladas está disponível em `pnpm test:e2e`. Consulte [TESTES-E2E.md](TESTES-E2E.md) para os requisitos, isolamento, repetição por módulo, relatórios e limites das verificações externas. Não executar contra produção.
