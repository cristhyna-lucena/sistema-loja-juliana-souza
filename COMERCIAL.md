# Vendas no balcão e financeiro

## Uso no painel

- **Vendas → Nova venda**: busque produtos por nome/SKU, adicione quantidades, selecione cliente quando necessário e informe desconto e pagamento. O preço é o do cadastro. Se outro usuário o alterar, atualize os preços antes de confirmar.
- **Receber total agora**, **receber parte agora** e **receber depois** são as condições disponíveis. Saldo em aberto exige cliente ativo e vencimento a partir do dia atual. O pagamento é um registro manual; não há cobrança automática de cartão, Pix ou boleto. Confirme o recebimento real antes de salvar.
- A confirmação cria venda, itens, baixa de estoque, conta a receber e recebimento opcional em uma transação. Se qualquer passo falhar, todos são desfeitos, incluindo custos e auditoria.
- Produtos inativos e produtos apenas de insumo não podem ser vendidos. A alocação usa lotes com saldo positivo que ainda não venceram, do menor vencimento para o maior; lotes sem validade e estoque sem lote ficam por último. Lote que vence no próprio dia ainda é elegível. O fuso de referência é America/Cuiaba. Há limite de 30 produtos e 50 lotes por produto em uma venda.
- O detalhe da venda mostra itens e preços originais, valor recebido, saldo e histórico. Novos recebimentos podem ser totais ou parciais. Não é possível receber além do saldo.
- **Cancelar venda** devolve os produtos aos lotes originais, restaura os valores de estoque das baixas e registra estornos nas contas financeiras originais. Os estornos financeiros são datados no dia do cancelamento. O motivo é obrigatório; confira a devolução dos valores ao cliente. Produtos e contas que foram desativados ainda aceitam essa correção histórica.
- Uma baixa de estoque vinculada à venda não pode ser estornada pelo formulário de estoque. Use o cancelamento da venda para manter estoque e financeiro consistentes.
- **Financeiro → Pagar e receber** lista títulos manuais e os gerados pelas vendas, com busca, tipo, situação, vencimento e saldo. Contas atrasadas são identificadas pelo vencimento local. Uma venda tem um título; parcelamento em títulos separados fica para uma próxima etapa.
- **Nova conta a pagar ou receber** cadastra despesa ou receita, com fornecedor/cliente opcional. Cadastrar um título não altera o caixa. A baixa gera o lançamento financeiro e pode ser parcial. Datas futuras não são aceitas em baixas realizadas. Não é possível editar ou excluir uma baixa: registre estorno com motivo.
- Título manual só pode ser cancelado após estornar suas baixas. Título de venda só pode ser cancelado pelo cancelamento da própria venda.
- **Financeiro → Caixa e fluxo** mostra lançamentos por período e conta, entradas, saídas, resultado, saldo atual e valores abertos com vencimento no período. Por padrão, usa o mês corrente até hoje. Valores a pagar/receber incluem todas as contas porque ainda não têm conta financeira de liquidação. Saldo atual considera todo o histórico, independentemente do período. Estornos entram como movimentos inversos. Uma conta pode ter saldo negativo; não é criado saldo inicial fictício.
- **Contas financeiras** lista caixas e bancos e seus saldos calculados. Administrador pode cadastrar, renomear e desativar contas. A migração cria “Caixa da loja”, sem saldo, para empresas já existentes. Empresas criadas depois devem cadastrar suas contas no painel.
- Vendas e lançamentos ficam na mesma instalação/banco dos demais módulos; não há emissão fiscal, integração bancária, taxas de cartão, conciliação, parcelas, agenda de serviços ou fechamento físico de caixa nesta entrega.

## Permissões

| Ação | ADMIN | OPERADOR | CONTADORA |
|---|---|---|---|
| Vendas, recebimentos da venda e cancelamentos | Sim | Sim | Não |
| Nomes das contas ativas para registrar recebimento | Sim | Sim | Sim |
| Saldos, títulos, caixa e estornos financeiros | Sim | Não | Sim |
| Cadastrar/editar contas financeiras | Sim | Não | Não |

A consulta financeira de contatos fornece apenas identificador e nome de clientes/fornecedores ativos. Ela não libera o restante dos cadastros à contadora. Toda consulta é limitada à empresa da sessão.

## API

| Método | Rota | Função |
|---|---|---|
| GET/POST | `/vendas` | Listar/criar |
| GET | `/vendas/:id` | Detalhar |
| POST | `/vendas/:id/recebimentos` | Receber saldo |
| POST | `/vendas/:id/cancelar` | Cancelar com estornos |
| GET | `/financeiro/contas/opcoes` | Contas ativas, sem saldos |
| GET/POST | `/financeiro/contas` | Listar/criar contas financeiras |
| PATCH | `/financeiro/contas/:id` | Editar com versão |
| GET | `/financeiro/contatos?tipo=PAGAR|RECEBER&q=` | Contatos para vincular título |
| GET/POST | `/financeiro/titulos` | Listar/criar títulos |
| GET | `/financeiro/titulos/:id` | Título e seus lançamentos |
| POST | `/financeiro/titulos/:id/baixas` | Registrar pagamento/recebimento |
| POST | `/financeiro/titulos/:id/cancelar` | Cancelar título manual |
| POST | `/financeiro/lancamentos/:id/estornar` | Registrar movimento inverso |
| GET | `/financeiro/caixa?de=YYYY-MM-DD&ate=YYYY-MM-DD&contaId=` | Caixa e projeções do período |

Listas aceitam `page` e `pageSize` (máximo 100). Vendas aceitam `q` e `status=todos|CONFIRMADA|CANCELADA`. Títulos aceitam `q`, `tipo=todos|PAGAR|RECEBER`, `status=todos|ABERTO|PARCIAL|PAGO|CANCELADO|ATRASADO`. Toda escrita exige sessão, origem autorizada, JSON e `chaveOperacao` UUID. Dados monetários usam strings com duas casas; quantidades, três. O total do item é quantidade × preço, arredondado a centavos; o total da venda é a soma desses totais menos o desconto global. Nenhum total enviado pelo consumidor é aceito como fonte de verdade.

Operações comerciais usam trava transacional por empresa e travas de produto para coordenar estoque manual. A chave é única entre todas as operações comerciais da empresa. Reenvio com mesma ação e payload normalizado retorna o registro atual da operação original; chave reaproveitada com outros dados é recusada. Após resposta perdida, o painel mantém a chave e bloqueia a edição para reenviar a mesma operação. Confira o histórico antes de abandonar a tela e iniciar outra operação.

Itens vendidos, lançamentos financeiros e registros de idempotência são imutáveis no banco. Auditoria registra o usuário responsável. Cancelamentos e estornos não apagam o histórico. Saldo pago do título e saldo de conta vêm da soma dos lançamentos; não são campos editáveis.

## Verificação

`pnpm test:comercial` usa banco temporário `sistema_loja_test_comercial_<id>` e porta 43177. Exige PostgreSQL/Redis locais e build atualizado. Verifica concorrência, origem, perfis, isolamento, média de custo, alocação de lotes, descontos, recebimentos, cancelamentos, falha de auditoria, idempotência, projeção, conta inativa e imutabilidade. O banco é removido ao concluir.

`pnpm test:comercial:painel` executa também o fluxo no Chromium, na porta 43179, incluindo resposta perdida após gravação, reenvio sem duplicação, venda parcial, recebimento, cancelamento, despesa, baixa, estorno e uso no celular. Exige build do painel e Chromium instalado. Capturas ficam em `artifacts/comercial/`; os dados são fictícios e separados da instalação principal.
