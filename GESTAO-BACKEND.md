# Backend da gestão

## Implementado: cadastros e estoque

Clientes, fornecedores e estoque estão implementados na API e conectados às telas do painel. Vendas no balcão e financeiro básico estão disponíveis e documentados em [COMERCIAL.md](COMERCIAL.md). Serviços e integração fiscal continuam pendentes.

No painel, use os menus **Clientes**, **Fornecedores** e **Estoque**, também disponíveis na área **Operação**. Clientes e fornecedores permitem busca, filtro por status, cadastro, edição e desativação. Em Estoque, pesquise um produto e clique em **Gerenciar estoque** para consultar saldo, cadastrar lote, registrar movimentações e estornar com motivo. O produto também tem um link para seu estoque na tela de edição.

### Custos, mínimos e alertas

- Produto tem **custo de compra de referência** opcional (até quatro casas decimais) e **estoque mínimo** (até três casas). Mínimo zero desativa o alerta de reposição. Alterar o custo de referência não altera o custo de entradas anteriores. Depois da primeira movimentação, a unidade do produto não pode ser trocada, para preservar o significado do histórico e dos custos por unidade.
- Entrada ou ajuste positivo aceita `custoUnitario`; quando omitido, usa o custo de referência do cadastro. Se ambos estiverem ausentes, a entrada fica sem custo, com avaliação pendente. Zero informado explicitamente é um custo conhecido, por exemplo para uma bonificação.
- Custo médio é calculado pelas entradas, ponderadas pelo saldo: valor anterior do estoque mais valor da entrada, dividido pelo saldo resultante. Saídas e ajustes negativos usam o custo vigente; o consumidor não pode definir outro custo nessas operações. Uma saída parcial usa a proporção exata do valor em estoque; ao esgotar o saldo, retira todo o valor remanescente, evitando resíduos de arredondamento. Custos exibem quatro casas; o valor dos movimentos é preservado com sete casas.
- Estorno reverte quantidade e valor do movimento original. Se deixar valor negativo, valor sem quantidade ou custo acima do limite, é recusado; é necessário desfazer os movimentos posteriores que alteraram o custo. Gravação, custo médio, valor do estoque e auditoria são atômicos. Reenvio idêntico usa a mesma chave de operação e não recalcula uma entrada com o novo custo de referência.
- Estoque antigo sem custos não recebe valor fictício na migração. Custo médio e valor permanecem pendentes enquanto houver saldo cuja avaliação não seja conhecida. Novas compras não completam custos anteriores. Ao zerar o estoque, o valor fica zero; as próximas entradas com custo iniciam uma nova média conhecida. Correções devem preservar o histórico, usando estorno e novo lançamento após conferência.
- `GET /estoque/alertas` aceita `q`, `tipo=todos|REPOSICAO|VENCIDO|A_VENCER`, `dias` (0 a 365, padrão 30), `page` e `pageSize`. Retorna lista paginada, contadores por tipo e `dataReferencia` no fuso America/Cuiaba. Os contadores acompanham a busca e o prazo e abrangem todos os tipos, mesmo quando a lista filtra um tipo específico.
- Reposição considera saldo físico total menor ou igual ao mínimo positivo de produto ativo. Validade considera apenas lotes com saldo positivo de produto ativo: vencido é anterior ao dia local; a vencer inclui o próprio dia e o limite final do prazo selecionado. Lotes sem validade não geram alerta. A tela individual sinaliza validade com prazo de 30 dias. Esses alertas não reservam estoque nem bloqueiam uma saída manual destinada a descarte de produto vencido.
- No painel, abra **Estoque → Alertas de estoque**; há também um acesso rápido no início. Use os filtros e abra o produto diretamente da linha do alerta. A tela de estoque exibe custo de referência, média, valor total e mínimo, além do custo de cada movimento. `custoMedio` e `valorEstoque` são calculados pelo sistema e não podem ser editados no cadastro.

A tela preserva a chave da movimentação ao reenviar após falha de comunicação, evitando lançamentos duplicados. Os totais são atualizados após a gravação. Histórico tem paginação; saldos incluem estoque sem lote e saldo individual de cada lote. Datas do histórico usam o fuso de Cuiabá. A contadora tem acesso restrito a estas áreas.

Todas as rotas exigem sessão de ADMIN ou OPERADOR. A empresa é obtida da sessão; não pode ser escolhida no corpo ou na consulta. Escritas exigem a origem configurada em ADMIN_ORIGIN e Content-Type application/json. Campos desconhecidos são recusados. Não existem rotas de exclusão.

### Clientes e fornecedores

| Método | Rota | Função |
|---|---|---|
| GET / POST | `/clientes` | Listar / criar |
| GET / PATCH | `/clientes/:id` | Consultar / editar |
| GET / POST | `/fornecedores` | Listar / criar |
| GET / PATCH | `/fornecedores/:id` | Consultar / editar |

Criação: `nome`, `cpfCnpj`, `email`, `telefone`, `ativo`. Apenas nome é obrigatório no cliente; fornecedor exige também CPF/CNPJ. Documento é normalizado e tem dígitos verificadores validados, inclusive CNPJ alfanumérico segundo o [manual da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj). Não há consulta cadastral à Receita. Documento repetido é recusado por empresa, separadamente em cada cadastro.

Listagem aceita `q`, `status=todos|ativos|inativos`, `page` e `pageSize` (máximo 100). Retorno: `itens`, `total`, `page`, `pageSize`, `pages`.

PATCH exige `versao` e ao menos um campo a alterar. Campos omitidos são preservados; CPF/CNPJ, e-mail e telefone do cliente podem ser limpos com null. Fornecedor não permite documento nulo. Edição com versão antiga retorna 409. A desativação usa `ativo: false`.

### Estoque

Prefixo: `/estoque/produtos/:produtoId`.

| Método | Sufixo | Função |
|---|---|---|
| GET | `/saldo` | Saldo total, sem lote e por lote; inclui lotes sem movimentos |
| GET | `/movimentos` | Histórico paginado; filtro opcional loteId |
| POST | `/lotes` | Cadastrar número e validade opcional YYYY-MM-DD |
| POST | `/movimentos` | Entrada, saída ou ajuste manual |
| POST | `/movimentos/:id/estornar` | Reverter movimento por novo lançamento |

Exemplo de movimento:

```json
{
  "tipo": "ENTRADA",
  "quantidade": "10.125",
  "loteId": null,
  "motivo": "Saldo inicial conferido",
  "chaveOperacao": "714f693d-864a-4bfe-bac3-985cd1483969"
}
```

Quantidades são strings, com até nove dígitos inteiros e três casas decimais. Vírgula também é aceita na entrada; saída da API sempre usa ponto e três casas. ENTRADA e SAIDA recebem quantidade positiva; a saída é armazenada com sinal negativo. AJUSTE aceita sinal positivo ou negativo. Zero é recusado. Não existe campo de saldo editável: o saldo deriva da soma dos movimentos.

O motivo é obrigatório (3 a 500 caracteres). Lote, quando informado, deve pertencer ao produto e à empresa. Uma saída de um lote não usa saldo de outro lote nem do estoque sem lote. O saldo de cada grupo não pode ficar negativo. Movimentos concorrentes bloqueiam a linha do produto até a transação terminar.

Chave de operação é UUID gerado pelo consumidor e deve ser preservado ao reenviar a mesma solicitação. Reenvio idêntico retorna o movimento original; chave reaproveitada com outros dados retorna 409. Cada nova operação exige outra chave. Em uso simultâneo da mesma chave para produtos diferentes, uma das solicitações retorna conflito.

Estorno recebe `motivo` e `chaveOperacao`. Gera quantidade oposta no mesmo lote, uma única vez, e também verifica saldo. Estorno de estorno é recusado. Produto inativo bloqueia novos lotes e movimentos manuais, mas permite corrigir o histórico por estorno. Movimentos gravados não podem ser alterados ou excluídos, inclusive diretamente no banco (trigger). Auditoria e mudança são gravadas na mesma transação.

### Validação

`pnpm test:gestao` exige build atualizado, PostgreSQL/Redis locais ativos e porta 43167 livre. Cria bancos temporários `sistema_loja_test_gestao_<id>` e `sistema_loja_test_custos_<id>`, aplica as migrations e remove os bancos ao concluir. Não usa os registros comerciais locais. A suíte verifica API, permissões, isolamento, precisão decimal, concorrência, idempotência, estornos, imutabilidade, custo médio, avaliação pendente, migração de dados anteriores, limites de validade no fuso de Cuiabá e rollback em falha de auditoria.

`pnpm test:gestao:painel` executa também o fluxo real no navegador, com cadastros, edição, filtros, lotes, entrada, saída, estorno, perda de resposta seguida de reenvio e permissões. Exige o build do painel, Chromium e a porta 43169 livre. Capturas de desktop e celular ficam em `artifacts/gestao-painel/`. Todos os dados são fictícios e ficam no mesmo banco temporário de teste.

## Próximas entregas do backend

1. Dados fiscais dos produtos e integração das compras com fornecedor e nota de entrada.
2. Serviços, ficha de insumos e registro de atendimentos com consumo de estoque.
3. Complementos comerciais: parcelamento, taxas e conciliação de pagamentos.
4. Complementos financeiros: categorias, transferências entre contas e fechamento físico de caixa.
5. Fiscal, importação de compras e exportação para a contadora (dependem das configurações e credenciais externas).
6. Indicadores, relatórios, gestão dos usuários e recuperação de senha.

O estoque manual calcula custo médio e gera alertas. Emissão de notas, reserva para checkout e seleção automática de lotes por validade continuam em entregas próprias.
