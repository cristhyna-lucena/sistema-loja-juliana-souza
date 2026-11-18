# Relatório E2E completo — 18/11/2026

Execução: 18/11/2026, 15:49:34 AMT até 18/11/2026, 16:10:25 AMT (America/Cuiaba).

Resultado do executor: **APROVADO**.

## Escopo e método

Inventário atual: 58 páginas/rotas de página e 130 declarações de rotas HTTP. A suíte reúne navegação real no Chromium, formulários, API, banco, Redis, armazenamento e worker. O inventário não representa uma medição de cobertura de código ou aprovação individual de todos os endpoints.

Os percursos funcionais usam bancos e dados exclusivos de teste, removidos ao final. As verificações de infraestrutura que acessam o banco principal usam transações revertidas. A inicialização de produção consulta saúde e autenticação sem cadastrar dados. Não houve deploy, alteração de DNS ou envio ao GitHub.

## Resultados por suíte

| Suíte | Aprovados pelo executor | Falhas | Ignorados | Resultado |
| --- | ---: | ---: | ---: | --- |
| infraestrutura | 5 | 0 | 0 | Aprovada |
| autenticacao | 16 | 0 | 0 | Aprovada |
| catalogo | 12 | 0 | 0 | Aprovada |
| gestao | 14 | 0 | 0 | Aprovada |
| comercial | 8 | 0 | 0 | Aprovada |
| fotos | 13 | 0 | 0 | Aprovada |
| operacoes | 24 | 0 | 0 | Aprovada |
| operacoes-painel | 8 | 0 | 0 | Aprovada |
| producao | 4 | 0 | 0 | Aprovada |
| saude | 3 | 0 | 0 | Aprovada |
| complementar | 71 | 0 | 0 | Aprovada |

Totais do Node: **178 aprovações, 0 falhas e 0 ignorados**. As aprovações incluem testes agrupadores. Excluindo esses agrupadores, foram aprovados 169 cenários individuais.

## Funcionalidades exercitadas

- Login do painel e do cliente, sessão, persistência, logout, recuperação/redefinição de senha, cookies seguros e revogação de sessões.
- Cadastro, consulta, edição, pesquisa, paginação, inativação e validação de categorias, produtos, clientes, fornecedores e usuários.
- Permissões de administrador, operador e contadora; isolamento entre empresas; bloqueio de origem; usuário inativo e último administrador.
- Fotos com upload real, processamento, variantes, organização, troca, remoção, restauração e recuperação do worker.
- Lotes, validade, estoque decimal, custos, alertas, concorrência, estornos e preservação do histórico.
- Vendas, compras, parcelas, recebimentos, despesas, caixa, transferências, conciliação e relatórios.
- Serviços, fichas de insumos, vouchers, uso e cancelamento; XML de entrada, de-para e fila fiscal.
- Loja, catálogo publicado, carrinho, conta, cadastro do cliente, checkout, reservas, consulta de pedidos e prevenção de duplicação.
- Abertura dos módulos, formulários, menus, mensagens de erro, indisponibilidade simulada, responsividade e comparação com o HTML aprovado.

A lista descreve o que foi exercitado. A aprovação de cada cenário consta no detalhamento abaixo; uma área com cenário reprovado não deve ser considerada totalmente aprovada.

## Falhas identificadas

Nenhuma falha reportada nesta execução. Nenhuma funcionalidade da aplicação foi alterada para obter aprovação.

### Diagnóstico e repetições

- Na primeira tentativa da suíte complementar, dois seletores genéricos de alerta também encontraram o anunciador interno do Next.js. A correção restringiu os seletores aos formulários, sem alterar a aplicação.
- A espera por networkidle atingiu timeout devido ao pré-carregamento RSC da página inicial. As consultas da loja respondiam HTTP 200 e o catálogo era exibido. O teste passou a aguardar conteúdo, fontes e estados de carregamento; o retorno pela logo foi verificado explicitamente e passou.
- A primeira tentativa complementar foi encerrada após esse diagnóstico para evitar repetir esperas incorretas; seu banco e namespace Redis exclusivos foram removidos. A repetição executou toda a suíte complementar até o fim. Os logs da tentativa inicial continuam preservados.
- Esta consolidação usa a execução aprovada de cada uma das 11 suítes, sem somar repetições nem apagar os resultados originais. Nenhuma funcionalidade do sistema foi alterada.

## Não executado contra serviços reais

| Validação externa | Motivo | O que foi possível testar |
| --- | --- | --- |
| Cobrança, liquidação e reembolso nos gateways | Contas e credenciais adiadas | Contratos simulados, idempotência, valores e bloqueio quando desativados |
| Correios: contrato, preço, prazo, etiqueta e rastreio reais | Contrato e credenciais não configurados | Contrato do adaptador com resposta simulada |
| Emissão, cancelamento, correção fiscal e NFS-e municipal reais | Provedor e configuração tributária não homologados | XML, validações locais e processamento de fila com respostas simuladas |
| Entrega de e-mail real | Remetente e conta não configurados | Tokens, filas e recuperação de senha sem enviar e-mail externo |
| DNS, HTTPS público e webhooks pela internet | Fora do escopo; domínio/deploy proibidos nesta etapa | Origens, proxies e cookies de produção em processos locais |
| Navegadores e dispositivos físicos adicionais | Suíte executada no Chromium local | Desktop e viewports móveis; sem certificação em Safari/Firefox/aparelhos reais |

A newsletter do HTML permanece uma manifestação local de interesse; o envio não está implementado nem é considerado aprovado. Funções com exclusão física não disponível usam a inativação, cancelamento ou estorno já previstos; nenhuma exclusão nova foi criada.

## Preservação do ambiente

Comparação do banco principal e .env: **PRESERVADOS**.
Tabelas com diferença de conteúdo/quantidade: nenhuma. .env: idêntico.

As assinaturas usadas na comparação ficam apenas nos artefatos locais; os registros e segredos não são copiados para o relatório.

## Confirmação dos fluxos críticos

Os fluxos críticos cobertos pela suíte passaram nas condições locais descritas: autenticação e permissões, cadastros, estoque, vendas/compras, recebimentos e estornos, conta/carrinho/checkout e processamento de fotos. Isso não confirma as integrações reais listadas como não executadas.

## Detalhamento dos testes

### infraestrutura

Tipo: Infraestrutura e transações revertidas. Log: `artifacts/e2e-completo/1795031374639/infraestrutura.log`.

- APROVADO: PostgreSQL: conexão e migration inicial aplicada
- APROVADO: Prisma: relacionamentos e auditoria, com rollback sem dados residuais
- APROVADO: Prisma: impede e-mail duplicado dentro da empresa
- APROVADO: Prisma: impede vincular auditoria a usuário de outra empresa
- APROVADO: Redis: autenticação, leitura, escrita e remoção de chave temporária

### autenticacao

Tipo: API e navegador reais. Log: `artifacts/e2e-completo/1795031374639/autenticacao.log`.

- APROVADO: Primeiro administrador: hash forte, auditoria e bloqueio de duplicação
- APROVADO: Rejeita ausência de sessão, token falso e dados inválidos
- APROVADO: Rejeita origem externa e não cria sessão
- APROVADO: Rejeita usuário inativo e credencial de outra empresa
- APROVADO: Login emite cookie protegido e grava apenas hash da sessão
- APROVADO: Permissões: administrador, contadora e operador
- APROVADO: Desativação do usuário invalida acesso imediatamente
- APROVADO: Expiração é verificada pelo servidor
- APROVADO: Novo login troca o token e revoga a sessão anterior
- APROVADO: Logout exige origem válida e revoga a sessão
- APROVADO: Limite de tentativas responde 429
- APROVADO: Navegador: login, persistência, logout, permissões e tela móvel
- APROVADO: Produção: cookie Secure, HttpOnly e prefixo __Host
- APROVADO: Desenvolvimento: API inicia pelo executor TypeScript
- APROVADO: Auditoria registra login e logout sem senha ou token
- APROVADO: Autenticação e permissões com banco, Redis e navegador reais

### catalogo

Tipo: API e navegador reais. Log: `artifacts/e2e-completo/1795031374639/catalogo.log`.

- APROVADO: Permissões e proteção de origem
- APROVADO: Categorias: criação, normalização, busca e paginação
- APROVADO: Produto: cadastro, preço exato e SKU normalizado
- APROVADO: Rejeita preço inválido, SKU duplicado e campos indevidos sem gravar
- APROVADO: Isolamento entre empresas e categoria estrangeira
- APROVADO: Banco rejeita preço negativo mesmo fora da API
- APROVADO: Edição protege contra sobrescrita e preserva os centavos
- APROVADO: Ativação e filtros por status, nome e SKU
- APROVADO: Categoria inativa impede novos vínculos e edição exige versão atual
- APROVADO: Falha da auditoria desfaz o cadastro completo
- APROVADO: Navegador: cadastrar, editar, pesquisar e verificar permissões no celular
- APROVADO: Catálogo: banco isolado, API e navegador

### gestao

Tipo: API e navegador reais. Log: `artifacts/e2e-completo/1795031374639/gestao.log`.

- APROVADO: Migração de custos preserva histórico antigo e identifica saldos sem avaliação
- APROVADO: Autenticação, permissões, origem e campos desconhecidos
- APROVADO: Cadastros: documentos, duplicidade, pesquisa e conflito de edição
- APROVADO: Lotes: unicidade, data válida e vínculo restrito ao produto/empresa
- APROVADO: Estoque decimal, idempotência e rejeição de saldo insuficiente
- APROVADO: Saídas concorrentes não vendem o mesmo saldo duas vezes
- APROVADO: Estornos preservam histórico e impedem duplicação e saldo negativo
- APROVADO: Falha de auditoria desfaz cadastros e movimentos
- APROVADO: Produto inativo bloqueia novas entradas e permite estorno
- APROVADO: Custos: média ponderada, estornos, referência, ajustes e idempotência
- APROVADO: Custos: entradas sem custo, gratuidade explícita, precisão e estorno impossível
- APROVADO: Alertas: mínimo, validade, paginação, isolamento e virada do dia em Cuiabá
- APROVADO: Painel: clientes, fornecedores, custos, alertas, reenvio e permissões
- APROVADO: Gestão: API e regras de estoque em PostgreSQL isolado

### comercial

Tipo: API e navegador reais. Log: `artifacts/e2e-completo/1795031374639/comercial.log`.

- APROVADO: Permissões, origem, isolamento e opções sem saldos para operador
- APROVADO: Venda parcial, FEFO sem vencidos, recebimentos concorrentes, caixa e cancelamento
- APROVADO: Falhas de validação e falta de estoque desfazem venda, custo, caixa e operação
- APROVADO: Duas vendas concorrentes não consomem o mesmo estoque
- APROVADO: Falha no final do cancelamento desfaz devolução, estornos e status
- APROVADO: Contas manuais, pagamento parcial, projeção, datas e estornos imutáveis
- APROVADO: Painel: venda parcial, reenvio, recebimento, cancelamento, despesa e celular
- APROVADO: Vendas e financeiro: transações reais, concorrência e navegador isolado

### fotos

Tipo: API, S3, Redis, worker e navegador reais. Log: `artifacts/e2e-completo/1795031374639/fotos.log`.

- APROVADO: Permissões, origem, tamanho e metadados inválidos
- APROVADO: URL assinada limita tamanho; processamento gera nove versões sem EXIF
- APROVADO: Conteúdo disfarçado e imagem acima de 40 MP são recusados
- APROVADO: HEIC real, PNG e WebP são processados
- APROVADO: Ordenação, foto principal, descrição e controle de versão
- APROVADO: Troca mantém foto anterior, inclusive se o novo arquivo falhar
- APROVADO: Limite de oito fotos é transacional e permite troca sem nona vaga
- APROVADO: Cancelamento preserva a foto atual e reservas expiradas podem ser refeitas
- APROVADO: Pendência é retomada após perda do job e reinício do worker
- APROVADO: Remoção é imediata; restauração e exclusão após sete dias funcionam
- APROVADO: Limpeza temporária preserva o original validado e as versões atuais
- APROVADO: Navegador: envio direto, progresso, arrastar, capa, troca, remoção e restauração
- APROVADO: Fotos: armazenamento e banco isolados, fila e navegador reais

### operacoes

Tipo: Domínio integrado ao banco; provedores simulados. Log: `artifacts/e2e-completo/1795031374639/operacoes.log`.

- APROVADO: Mercado Pago preserva referência, moeda e chave de idempotência
- APROVADO: Asaas consulta cobrança anterior antes de criar e usa checkout hospedado
- APROVADO: Pagar.me usa centavos e estorna cobranças do pedido
- APROVADO: Correios calcula preço e prazo com credencial no cabeçalho
- APROVADO: Focus reutiliza referência e bloqueia download fora da origem do provedor
- APROVADO: Falhas temporárias são identificadas para nova tentativa
- APROVADO: Adaptadores respeitam os contratos dos provedores com respostas simuladas
- APROVADO: XML preserva códigos e lotes, recusa entidades externas e exporta ZIP interoperável
- APROVADO: Compra converte unidades, avalia estoque, gera parcelas e reenvia sem duplicação
- APROVADO: Compra inválida desfaz todos os itens e a auditoria
- APROVADO: Atendimento congela a ficha, consome uma vez e cancela com estornos
- APROVADO: Transferências preservam o total e estornam os dois lados
- APROVADO: Taxa de recebimento acompanha a baixa e seu estorno
- APROVADO: Conciliação altera apenas metadados e mantém lançamentos imutáveis
- APROVADO: Último administrador ativo é preservado
- APROVADO: Provedores podem ser configurados depois sem criar cobranças enquanto desativados
- APROVADO: Checkout calcula total no servidor e serializa reservas concorrentes
- APROVADO: Confirmação duplicada gera uma venda e uma baixa de estoque
- APROVADO: Cancelamento da compra consumida desfaz a tentativa inteira
- APROVADO: Parcelas da venda recebem por vencimento e cancelam todo o grupo
- APROVADO: Voucher online congela preço e ficha, recebe uma vez e cancela atomicamente
- APROVADO: Relatórios agregam vendas, caixa e estoque com dados reais
- APROVADO: Fila fiscal guarda XML, fatura todos os vouchers e envia cada nota uma vez
- APROVADO: Compras, serviços, financeiro e checkout preservam transações e histórico

### operacoes-painel

Tipo: API e navegador reais; pagamentos simulados. Log: `artifacts/e2e-completo/1795031374639/operacoes-painel.log`.

- APROVADO: Compras no painel atualizam estoque e parcelas
- APROVADO: Cadastro de serviço e publicação ficam disponíveis na loja
- APROVADO: Configurações, financeiro e relatórios funcionam pelo painel
- APROVADO: XML recebido permite de-para e entrada sem digitar todos os itens
- APROVADO: Cliente cria conta, compra e reenvia após perda de resposta sem duplicar pedido
- APROVADO: Permissões, origem e webhooks rejeitam requisições inválidas
- APROVADO: Recuperação de senha usa token único e revoga sessões do painel e cliente
- APROVADO: Painel e loja: compras, serviços, fiscal, configuração e checkout reais no navegador

### producao

Tipo: Inicialização real; API simulada para proxies. Log: `artifacts/e2e-completo/1795031374639/producao.log`.

- APROVADO: produção carrega o .env da raiz e preserva variáveis do servidor
- APROVADO: API compilada inicia em produção com origem HTTPS e serviços locais
- APROVADO: loja: produção usa as origens e API configuradas em execução
- APROVADO: admin: produção usa as origens e API configuradas em execução

### saude

Tipo: Servidores compilados reais. Log: `artifacts/e2e-completo/1795031374639/saude.log`.

- APROVADO: API compilada inicia e responde à rota de saúde
- APROVADO: loja: servidor de produção entrega a página inicial
- APROVADO: admin: servidor de produção entrega a página inicial

### complementar

Tipo: Navegador, usuários, navegação, visual e formulários. Log: `artifacts/e2e-completo/1795032432547/complementar.log`.

- APROVADO: Login: campos obrigatórios, e-mail inválido e credenciais incorretas
- APROVADO: Recuperação do painel: páginas abrem, confirmação diverge e token inválido é recusado
- APROVADO: Carregamento autenticado do painel: /
- APROVADO: Carregamento autenticado do painel: /produtos
- APROVADO: Carregamento autenticado do painel: /produtos/novo
- APROVADO: Carregamento autenticado do painel: /produtos/[id]
- APROVADO: Carregamento autenticado do painel: /categorias
- APROVADO: Carregamento autenticado do painel: /categorias/novo
- APROVADO: Carregamento autenticado do painel: /categorias/[id]
- APROVADO: Carregamento autenticado do painel: /operacao
- APROVADO: Carregamento autenticado do painel: /clientes
- APROVADO: Carregamento autenticado do painel: /clientes/novo
- APROVADO: Carregamento autenticado do painel: /clientes/[id]
- APROVADO: Carregamento autenticado do painel: /fornecedores
- APROVADO: Carregamento autenticado do painel: /fornecedores/novo
- APROVADO: Carregamento autenticado do painel: /fornecedores/[id]
- APROVADO: Carregamento autenticado do painel: /estoque
- APROVADO: Carregamento autenticado do painel: /estoque/[id]
- APROVADO: Carregamento autenticado do painel: /estoque/alertas
- APROVADO: Carregamento autenticado do painel: /vendas
- APROVADO: Carregamento autenticado do painel: /vendas/nova
- APROVADO: Carregamento autenticado do painel: /compras
- APROVADO: Carregamento autenticado do painel: /compras/nova
- APROVADO: Carregamento autenticado do painel: /servicos
- APROVADO: Carregamento autenticado do painel: /servicos/novo
- APROVADO: Carregamento autenticado do painel: /servicos/[id]
- APROVADO: Carregamento autenticado do painel: /vouchers
- APROVADO: Carregamento autenticado do painel: /pedidos
- APROVADO: Carregamento autenticado do painel: /financeiro
- APROVADO: Carregamento autenticado do painel: /financeiro/conferencia
- APROVADO: Carregamento autenticado do painel: /financeiro/titulos/novo
- APROVADO: Carregamento autenticado do painel: /fiscal
- APROVADO: Carregamento autenticado do painel: /fiscal/recebidas
- APROVADO: Carregamento autenticado do painel: /fiscal/emitidas
- APROVADO: Carregamento autenticado do painel: /relatorios
- APROVADO: Carregamento autenticado do painel: /configuracoes
- APROVADO: Navegação real pelos menus, submenu Operação e atualização
- APROVADO: Usuários: formulário recusa e-mail inválido sem cadastrar
- APROVADO: Usuários: cria operador pelo formulário e persiste senha protegida
- APROVADO: Usuários: duplicidade retorna conflito e mensagem de erro
- APROVADO: Novo operador autentica e tem acesso negado às configurações e API de usuários
- APROVADO: Usuários: edita nome/perfil, revoga sessão e permite login como contadora
- APROVADO: Usuários: inativa o cadastro, revoga o acesso e rejeita novo login
- APROVADO: Usuários: bloqueia inativação do último administrador e mostra mensagem
- APROVADO: Página pública e formulário no celular: /
- APROVADO: Página pública e formulário no celular: /produtos
- APROVADO: Página pública e formulário no celular: /c/[id]
- APROVADO: Página pública e formulário no celular: /p/produto-e2e
- APROVADO: Página pública e formulário no celular: /servicos
- APROVADO: Página pública e formulário no celular: /servicos/[id]
- APROVADO: Página pública e formulário no celular: /carrinho
- APROVADO: Página pública e formulário no celular: /checkout
- APROVADO: Página pública e formulário no celular: /entrar
- APROVADO: Página pública e formulário no celular: /cadastro
- APROVADO: Página pública e formulário no celular: /recuperar-senha
- APROVADO: Página pública e formulário no celular: /redefinir-senha
- APROVADO: Página pública e formulário no celular: /trocas
- APROVADO: Página pública e formulário no celular: /privacidade
- APROVADO: Catálogo público: pesquisa, categoria e resultado vazio reais
- APROVADO: Logo da loja retorna à página inicial HTML após navegar no catálogo
- APROVADO: Carrinho: adiciona, altera quantidade, persiste ao recarregar e remove
- APROVADO: Checkout real permanece bloqueado com os três gateways desativados
- APROVADO: Rotas inexistentes e detalhes inexistentes retornam erro sem quebrar a navegação
- APROVADO: Indisponibilidade da API mostra mensagem e a página recupera após recarregar
- APROVADO: Cliente: cadastro real, consentimento, logout e novo login
- APROVADO: Cliente: encerramento exige confirmação, desativa acesso e preserva histórico
- APROVADO: Visual aprovado em cinco larguras e acessos reais
- APROVADO: Três provedores preparados e nenhuma cobrança sem ativação
- APROVADO: Menu de operação, formulários e usuários cabem em tela de 390px
- APROVADO: Logout pelo botão do painel revoga sessão e bloqueia nova navegação protegida
- APROVADO: E2E complementar: navegação completa, usuários, formulários e loja

## Como repetir

Consulte `TESTES-E2E.md`. Com build e infraestrutura locais prontos: `npx --yes pnpm@12.15.0 test:e2e`.

Resultado estruturado: `artifacts/e2e-completo/consolidado-1795032634224/resultado.json`.

## Encerramento e retomada local

Conferência final: nenhum banco temporário e nenhum bucket de fotos de teste restante. A empresa, identificação, contato e administrador reais foram preservados. Os servidores de desenvolvimento foram reiniciados: loja, login do painel e prontidão da API responderam HTTP 200 após a inicialização. O worker também registrou inicialização pronta. Não houve deploy nem alteração de domínio.
