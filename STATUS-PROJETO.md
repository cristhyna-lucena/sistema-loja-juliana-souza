# Situação atual — 17/11/2026

**Ponto de retomada para amanhã:** ler [CONTINUIDADE.md](CONTINUIDADE.md), que registra o trabalho de hoje, as decisões da cliente, o HTML correto, as verificações, os backups e as pendências. A cliente pediu para continuar em 18/11/2026.

Finalização em andamento: dependências corrigidas para Next.js 16.4.5 e Multer 2.5.0, com auditoria sem vulnerabilidades conhecidas. A cliente optou por configurar pagamentos depois. A preparação mantém todos os provedores e formas previstas; o checkout não gera cobranças enquanto o provedor não estiver configurado. O catálogo real e os dados empresariais ainda precisam ser preenchidos; os números ilustrativos do PDF não foram usados como registros reais. O HTML mais atualizado confirmado continua como referência visual.

A cliente autorizou a continuidade das etapas e correções, deixando a publicação pendente. Compras, serviços/vouchers, complementos financeiros, configuração/usuários, fiscal, relatórios e checkout foram adicionados. Foram mantidos Mercado Pago, Asaas e Pagar.me, além de Correios e frete grátis configurável. Veja [configuração, testes e limites das integrações](OPERACOES-INTEGRACOES.md).

As anotações abaixo registram entregas anteriores e não representam as funcionalidades atuais. A homologação com contas externas reais depende das credenciais e dos dados da empresa; testes com respostas simuladas não substituem essa homologação. Nenhuma publicação foi realizada.

# Etapa 1 — Estrutura inicial

Etapa autorizada pelo cliente em 26/10/2026. Próximas etapas exigem nova permissão.

## Entregue

- Monorepo pnpm e Turborepo com oito pacotes de aplicação/biblioteca.
- Loja e painel em Next.js, com páginas provisórias em português.
- API NestJS com GET /health e tratamento de porta inválida.
- Estrutura reservada para worker, banco, integrações, tipos e componentes compartilhados.
- TypeScript estrito, arquivo de dependências fixadas e instruções no README.
- Testes que iniciam os servidores compilados, verificam resposta HTTP e encerram os processos.

## Verificações executadas

- Instalação com pnpm 12.15.0: concluída.
- Reinstalação com --frozen-lockfile: concluída sem atualizar o lockfile.
- TypeScript: todas as tarefas passaram.
- Compilação de produção: os oito pacotes passaram.
- Testes de execução: três testes passaram, sem falhas (API, loja e painel).

Foi permitido especificamente o script de instalação do esbuild, necessário para a ferramenta de desenvolvimento da API. As bibliotecas compartilhadas entregam código-fonte diretamente e não geram dist; o cache foi configurado para refletir isso.

## Limites desta entrega

Sem banco conectado, autenticação, operações de negócio, filas ativas, integrações externas ou deploy. As páginas provisórias não são o layout final baseado na referência SkinCeuticals. Não foi feita validação visual em navegador nesta etapa; os testes das páginas verificam resposta HTTP, idioma e conteúdo inicial.

O Docker está instalado, mas o serviço estava desligado na verificação do ambiente. Banco e filas dependem da preparação desse ambiente na próxima etapa.

## Próxima etapa proposta na conclusão da etapa 1

Preparar PostgreSQL e Redis locais com Docker Compose, configurar Prisma e a primeira migration da base de dados; verificar conectividade e aplicação da migration. Login e cadastros ficam para etapas posteriores.

# Etapa 2 — Banco e Redis locais

Autorizada pelo cliente e concluída em 26/10/2026.

## Entregue

- Docker Desktop iniciado; PostgreSQL 16 e Redis 7 ativos e saudáveis no Docker Compose.
- Portas limitadas ao computador local: PostgreSQL 5433, Redis 6380.
- Volumes persistentes, verificações de saúde e autenticação dos serviços.
- Gerador de `.env` com senhas aleatórias, sem sobrescrever arquivo existente nem exibir credenciais.
- Prisma 7.10.1, cliente PostgreSQL e pacote de banco compilado para uso futuro pela API.
- Schema inicial com Empresa, Usuario, AuditLog e enum Perfil.
- Migration `20261026154214_base_acesso` revisada e aplicada.
- Comandos de inicialização, parada, migrations e testes documentados no README.

Foi utilizada a versão estável 7.10.1 do Prisma em vez da versão 8 candidata de lançamento indicada pela tag latest. Foram permitidos especificamente os scripts de instalação de prisma e @prisma/engines, além do esbuild já autorizado na etapa anterior.

## Validação

- Docker Compose: configuração válida; os dois serviços passaram nas verificações de saúde.
- Prisma validate: schema válido.
- Migrate deploy: primeira migration aplicada com sucesso.
- Migrate status: banco atualizado.
- Cinco testes de infraestrutura passaram: conexão e migration, relações e rollback, unicidade de e-mail por empresa, bloqueio de vínculo de auditoria a usuário de outra empresa, leitura/escrita no Redis com credencial.
- Confirmado após os testes: zero registros em Empresa, Usuario e AuditLog.
- Instalação com frozen-lockfile: aprovada.
- Verificação geral: TypeScript aprovado, build dos oito pacotes aprovado (sete reutilizaram cache válido) e três testes HTTP de execução aprovados.
- Total: oito testes de execução/infraestrutura passaram, nenhuma falha.

## Limites e estado local

Os containers permanecem ativos para desenvolvimento. A API ainda não usa o banco em suas rotas; /health continua verificando somente a execução da API. Não foram criados usuários reais nem implementados login, filas BullMQ, produtos ou integrações comerciais. O vínculo composto no banco impede a associação incorreta testada, mas não substitui o filtro por empresa e a autorização que serão implementados na API.

## Próxima etapa proposta na conclusão da etapa 2

Implementar login do painel com senha protegida por Argon2, sessões em cookie httpOnly, logout e controle de acesso por perfil; integrar a API ao banco e testar acesso permitido, acesso negado e encerramento de sessão. O primeiro administrador será criado por procedimento local, sem senha padrão no código.

# Etapa 3 — Login, sessões e permissões

Autorizada pelo cliente e concluída em 26/10/2026.

## Entregue

- Tela de login responsiva e área administrativa protegida, com identidade visual provisória.
- API integrada ao PostgreSQL para usuários, sessões e auditoria.
- Senhas em Argon2id, com 64 MiB, três iterações e paralelismo 1.
- Sessão de oito horas, token aleatório e somente hash SHA-256 armazenado no banco.
- Cookies HttpOnly e SameSite=Lax; em produção, Secure e prefixo __Host, com exigência de origem HTTPS.
- Logout revoga a sessão no banco e remove o cookie; novo login revoga a sessão apresentada anteriormente.
- Verificação de usuário/empresa ativos e perfil em cada acesso protegido.
- Proteção de origem nos POSTs de autenticação e limite de tentativas via Redis.
- Rotas de acesso por perfil na API e menus correspondentes no painel.
- Auditoria de login, logout e criação do primeiro administrador, sem senha/token nos dados registrados.
- Rotina local interativa `admin:create`, com digitação de senha oculta, confirmação e bloqueio de criação de segundo administrador.
- Migration `20261026174022_sessoes` aplicada.
- Rota `/health/ready` consulta o banco; `/health` mantém a resposta anterior.

## Verificações concluídas

- Instalação com frozen-lockfile aprovada.
- TypeScript: todas as tarefas passaram.
- Build: oito pacotes passaram; cache válido reutilizado nas aplicações sem alterações desde a compilação anterior.
- Testes de execução gerais: três passaram.
- Testes de infraestrutura: cinco passaram.
- Suíte de autenticação: 16 testes reportados pelo Node passaram, incluindo o teste principal e seus 15 subtestes.
- Testados: primeiro administrador, senha inválida, sessão ausente/falsa, origem externa, usuário inativo, outra empresa, cookie e hash, matriz de perfis, expiração, rotação, logout, limite de tentativas, auditoria, cookie de produção e inicialização em desenvolvimento.
- Playwright/Chromium percorreu login inválido e válido, recarga mantendo sessão, logout, acesso direto sem sessão, acesso negado da contadora e acesso permitido ao financeiro.
- Tela móvel de login verificada em 390 × 844, sem rolagem horizontal.
- Capturas desktop/mobile e painel inspecionadas visualmente: `artifacts/login-desktop.png`, `artifacts/login-mobile.png` e `artifacts/painel-admin.png`.
- Os processos de teste foram encerrados e as empresas, usuários, sessões, auditorias e chaves de Redis criados pela suíte foram removidos.

A primeira execução identificou tipos antigos de rotas do Next.js e o retorno void do bloqueio transacional no PostgreSQL. O comando de tipos agora regenera as rotas, e a consulta de bloqueio converte o retorno para texto. Ambos foram corrigidos e revalidados. O seletor da mensagem de erro no teste do navegador foi ajustado para não confundir a mensagem do formulário com o anunciador de rotas do Next.js.

## Limites desta entrega

O primeiro administrador real aguarda nome, e-mail e senha escolhidos pelo usuário por meio do comando local documentado. Não há senha padrão nem usuários reais criados. As áreas de configurações, operação e financeiro ainda são páginas provisórias para validação das permissões. Recuperação de senha, gerenciamento de usuários, produtos, fiscal e demais módulos comerciais não fazem parte desta etapa. Não houve deploy.

## Próxima etapa proposta na conclusão da etapa 3

Cadastro de produtos e categorias, com telas administrativas, validações, permissões e testes. Fotos, lotes e movimentações de estoque precisam de escopo próprio nas próximas entregas; não serão ativados automaticamente.

## Complemento autorizado após a etapa 3

O primeiro administrador real foi criado a pedido do usuário, com senha aleatória forte. Login, perfil ADMIN e logout da sessão de verificação foram testados. As credenciais foram entregues diretamente no chat e não são registradas neste documento. A prévia local foi iniciada para acesso pelo navegador.

# Etapa 4 — Produtos e categorias

Autorizada pelo cliente e concluída em 26/10/2026.

## Entregue

- Cadastro, edição, ativação/inativação, busca e paginação de produtos e categorias.
- Menus e páginas acessíveis a administrador e operador. Contadora bloqueada nas páginas e na API.
- Produto com nome, descrição, SKU, tipo, unidade, preço e categoria opcional.
- SKU normalizado para maiúsculas, único dentro da empresa; categoria com chave de nome normalizada e única por empresa.
- Validações compartilhadas com Zod na API e no painel. `packages/shared` agora entrega JavaScript compilado e tipos.
- Preço recebido como texto e salvo como Decimal(12,2), com limite de precisão e restrição de não negatividade também no PostgreSQL.
- Vínculo composto de categoria e empresa impede associação entre empresas diferentes.
- Controle de versão numérica em edições para impedir sobrescritas concorrentes, com resposta 409 e opção de recarregar.
- Cadastro/edição e auditoria na mesma transação, incluindo antes/depois das alterações.
- Categoria inativa impede novos vínculos; vínculos anteriores são preservados.
- Proxy do painel mantém a autenticação na mesma origem; mutações verificam origem e JSON.
- Migration `20261026183804_catalogo` revisada e aplicada, com transação SQL e CHECK de preço não negativo.
- Layout responsivo; tabela com rolagem no celular e SKU sem quebra de linha.

## Verificações concluídas

- Instalação com frozen-lockfile aprovada.
- TypeScript: todas as tarefas passaram; tipos do painel verificados novamente após o ajuste visual.
- Build dos oito pacotes aprovado; painel recompilado após os ajustes visuais.
- Suíte geral: três testes passaram.
- Infraestrutura: cinco testes passaram.
- Autenticação: 16 testes reportados pelo Node passaram (incluindo o teste principal).
- Catálogo: 12 testes reportados pelo Node passaram (incluindo o teste principal), reexecutados após o ajuste visual.
- Total reportado pelas quatro suítes: 36 testes aprovados, nenhuma falha.
- Testados: permissões/origem, cadastro e duplicidade de categorias, busca/paginação, preço exato, SKU normalizado/duplicado, entradas inválidas, isolamento de empresas, vínculo estrangeiro, CHECK de preço negativo, edição concorrente, ativação/inativação, categoria inativa e rollback quando a auditoria falha.
- Playwright percorreu criação de categoria e produto, edição, busca, erro de SKU duplicado, ativação e inativação, acesso de operador pelo celular e bloqueio da contadora.
- A suíte do catálogo criou um banco local descartável separado e o removeu ao concluir, junto com os processos e chaves Redis de teste.
- Capturas do catálogo no computador, formulário e celular foram inspecionadas. Os arquivos ficam em `artifacts/catalogo-*.png`.
- Confirmado no banco principal após as regressões: uma empresa, um usuário e nenhum produto ou categoria de teste. O administrador real foi preservado.
- Após o ajuste final de largura da categoria no celular, o painel foi recompilado e os 12 testes do catálogo passaram novamente. A captura móvel final foi revisada.
- API e painel reiniciados para uso local. Verificados HTTP 200 em `/health/ready`, `/produtos` e `/categorias` (páginas redirecionam para login sem sessão). Confirmado que não restaram bancos temporários do catálogo.

## Limites desta entrega

O catálogo administrativo não publica produtos na loja nem movimenta estoque. Fotos, lotes, validades e campos fiscais serão tratados em etapas próprias. Não houve deploy externo.

## Próxima etapa proposta na conclusão da etapa 4

Upload e organização das fotos dos produtos, incluindo validação dos arquivos e testes. Estoque e integrações fiscais permanecem para entregas posteriores.

# Etapa 5 — Fotos dos produtos

Autorizada pelo cliente; concluída em 27/10/2026.

## Entregue

- Galeria no cadastro do produto, com até oito fotos ativas e validação de tamanho/tipo/conteúdo.
- JPEG, PNG, WebP e HEIC/HEIF, até 15 MiB e 40 megapixels.
- Seleção múltipla, arrastar arquivos, progresso e processamento em segundo plano.
- Compressão no navegador para JPEG/PNG/WebP; HEIC processado no worker.
- Envio direto ao armazenamento por PUT assinado de cinco minutos, com tamanho e tipo vinculados à assinatura.
- Armazenamento privado MinIO compatível com S3, em volume Docker e portas locais 19000/19001.
- Worker BullMQ/Redis com id por foto/tentativa, novas tentativas e recuperação de pendências gravadas no PostgreSQL.
- Orientação corrigida, versões em sRGB sem EXIF, enquadramento quadrado com fundo branco, AVIF/WebP 160/480/1024/2048, JPEG 1024 e placeholder 16 px.
- Original recebido privado, separado do arquivo temporário de envio e sem rota de download pelo painel.
- Descrição alternativa, ordenação por arraste/setas, foto principal, prévia e miniatura na lista de produtos.
- Troca preserva a foto anterior até a nova ficar pronta, inclusive quando o novo arquivo falha.
- Remoção imediata com restauração por sete dias; limpeza física pelo worker após o prazo.
- Rastreamento de gerações antigas e de tentativas interrompidas para impedir arquivos órfãos após troca/restauração.
- Controle de versão da galeria independente dos demais dados do produto.
- Permissões verificadas na API e no painel: administrador/operador; contadora sem acesso às fotos.
- Migration `20261026194500_fotos` revisada e aplicada sem reset do banco. A restrição composta do produto é compatível com sua chave primária já única.

## Infraestrutura e decisões

A imagem pronta do MinIO Community não estava disponível nos registros consultados. Foi feito build local do código oficial no commit `7aac2a2c5b7c882e68c1ce017d8256be2feea27f`, com licença/aviso preservados. Como o repositório foi arquivado pelo mantenedor, a escolha de armazenamento mantido deve ser revisada antes da produção. A interface da aplicação usa S3; não houve contratação ou deploy externo.

A porta 9000 já estava ocupada; o serviço existente foi preservado, e o armazenamento desta instalação usa 19000/19001. Credenciais novas foram geradas no `.env` sem exibi-las ou versioná-las. Os arquivos ficam no volume Docker, separado da pasta do código/OneDrive; o backup externo será tratado na implantação.

## Verificações concluídas

- Instalação com frozen-lockfile aprovada.
- TypeScript aprovado em todas as tarefas e build dos nove pacotes aprovado.
- Painel recompilado e verificado após o ajuste final da mensagem de conclusão do processamento.
- Testes gerais: três passaram.
- Infraestrutura: cinco passaram.
- Autenticação: 16 testes reportados pelo Node passaram, incluindo o teste principal.
- Catálogo: 12 testes reportados pelo Node passaram, incluindo o teste principal.
- Fotos: 13 testes reportados pelo Node passaram, incluindo o teste principal; suíte repetida após o ajuste final da tela.
- Total das cinco suítes: 49 testes aprovados, nenhuma falha na verificação final.
- Testados URL/tamanho assinados, bucket privado, nove variantes sem EXIF, orientação, SVG disfarçado, excesso de pixels, HEIC real, ordenação/capa, versão, troca com falha, limite concorrente de oito, cancelamento, expiração, recuperação de job perdido, restauração e exclusão após prazo.
- Validado que uma foto em PROCESSANDO não perde o arquivo temporário enquanto aguarda recuperação.
- Playwright percorreu envio direto ao S3, envio múltiplo, arraste de arquivos/fotos, capa, descrição, prévia, troca, remoção, restauração, miniaturas e acesso móvel de operador; bloqueio da contadora confirmado.
- Capturas `artifacts/fotos-galeria-desktop.png` e `artifacts/fotos-galeria-mobile.png` inspecionadas visualmente.
- Testes usaram banco, bucket e namespace Redis exclusivos, removidos ao concluir.

As primeiras verificações identificaram uma dependência opcional de Redis que precisava ser explícita, um ajuste de tipagem do Sharp e a necessidade de aguardar o carregamento real da miniatura no navegador. Foram corrigidos e revalidados. Uma execução interrompida por tempo limite não foi considerada aprovação; a suíte foi repetida integralmente e passou. A limpeza dos recursos temporários dessa execução também foi realizada.

## Estado local

API, painel, loja e worker reiniciados para uso. HTTP 200 confirmado em `/health/ready`, `/produtos`, loja e saúde do armazenamento; worker registrou inicialização pronta. O banco principal continua com uma empresa, um usuário e nenhum produto/foto de teste. Não restaram bancos temporários. O administrador real foi preservado.

## Próxima etapa proposta, aguardando autorização

Estoque: lotes e validade, entrada inicial, ajustes com motivo, histórico de movimentações e cálculo de saldo, com testes das regras e das transações. Nenhuma movimentação de estoque foi implementada nesta entrega.

# Etapa 6 — Design do painel

Autorizada pelo cliente em 27/10/2026.

## Entregue

- Identidade em verde profundo, branco, areia e tons suaves, com ícones SVG locais.
- Novo login com apresentação da marca e controle para mostrar/ocultar senha.
- Navegação lateral no computador e horizontal no celular, página atual indicada e atalho para o conteúdo.
- Cabeçalho com perfil, atualização e busca do catálogo.
- Início com contagens reais de produtos/categorias, catálogo e atalhos de cadastro. Nenhum indicador de vendas fictício.
- Listas, filtros, formulários, estados vazios e galeria com apresentação consistente.
- Respeito a movimento reduzido e foco visível. Não representa certificação de acessibilidade.
- Direção visual registrada em DESIGN-SYSTEM.md. Loja pública e estoque continuam em etapas próprias.

## Verificações

- Build de produção do painel e TypeScript aprovados.
- Testes gerais: 3 aprovados; infraestrutura: 5; autenticação: 16; catálogo: 12.
- Teste de autenticação ampliado para conferir mostrar/ocultar senha, navegação atual e valores reais dos cartões.
- Espera de inicialização dos testes ajustada para a latência do ambiente Windows, preservando as verificações de resposta e conteúdo. A espera da primeira navegação após login passou para 15 segundos; a primeira execução excedeu os 5 segundos anteriores, e as duas repetições passaram.
- Capturas finais de login, início, listagem e formulário revisadas no computador e no celular. Corrigido espaço ausente no título móvel e recompilado.
- Painel local reiniciado; HTTP 200 confirmado no login e na prontidão da API.
- A regressão das fotos identificou largura excessiva na página móvel: a regra geral dos inputs sobrescrevia a largura dos campos de arquivo visualmente ocultos. Aplicada regra específica para preservar 1 px sem alterar os controles visíveis. A verificação que exige largura da página menor ou igual à tela foi preservada.
- Uma execução anterior da galeria não concluiu a ação de ordenação enquanto havia recompilação do painel; foi descartada e repetida com build estável. A repetição confirmou a ordenação e revelou o problema móvel descrito acima.
- A sequência automatizada de arrastar novo arquivo agora aguarda o botão Adicionar fotos ser liberado após a restauração anterior; observar os cartões renderizados ainda não significava que a ação anterior havia concluído. As verificações de processamento e quantidade de fotos foram mantidas.
- Verificação final das fotos: 13 testes aprovados, nenhuma falha, incluindo a sequência completa no navegador e a ausência de largura excedente no celular. Total das cinco suítes: 49 testes aprovados. Capturas finais da galeria no computador e no celular revisadas. Etapa de design concluída.
