# Dados necessários para a operação real

Escopo atual confirmado em 18/11/2026: somente estrutura dos campos, incluindo teste. Os itens abaixo são pendências para uma etapa futura e não impedem concluir a estrutura atual. Ver `ESTRUTURA-CAMPOS.md` e o modelo inativo `configuracao-teste.env.example`. Não implementar regras nem ativar funcionalidades adicionais nesta etapa.

A revisão do banco local encontrou uma empresa, um administrador ativo e nenhum produto cadastrado no catálogo comercial. Endereço e contato foram salvos em 18/11/2026; a configuração empresarial ainda aguarda os demais dados reais. O HTML aprovado continua sendo a apresentação visual da marca.

O PDF disponível no projeto identifica os valores, estoques e telas como propostas ilustrativas. Por isso, seus números não foram cadastrados como preços ou estoque real.

## Empresa e catálogo

Em 18/11/2026, a cliente forneceu endereço, CEP, e-mail, telefone, CNPJ e razão social, registrados apenas na instalação privada. Código municipal confirmado no IBGE. Faltam regime tributário e conta financeira de recebimento. A contadora deve confirmar inscrições e campos tributários aplicáveis.

`catalogo-para-preencher.csv` contém os quatro produtos de destaque identificados no HTML, com os dados de apresentação disponíveis. Preço, SKU, estoque, lote, validade, medidas e tributação ficaram vazios. As demais apresentações das linhas também poderão ser cadastradas quando seus dados forem informados. A revisão não criou preços, saldos ou lotes fictícios.

## Credenciais

Preencher as chaves somente no `.env` local ou no gerenciador de segredos do servidor. Não enviar chaves, senhas ou tokens no chat. Os nomes das variáveis estão em `.env.example`.

| Serviço | Variáveis necessárias |
| --- | --- |
| Mercado Pago | `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` |
| Asaas | `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` |
| Pagar.me | `PAGARME_SECRET_KEY`, `PAGARME_WEBHOOK_PASSWORD`; usuário em `PAGARME_WEBHOOK_USER` |
| Correios | `CORREIOS_USUARIO`, `CORREIOS_CODIGO_ACESSO`, `CORREIOS_CARTAO_POSTAGEM`; contrato se aplicável |
| Focus, homologação | `FOCUS_TOKEN`, `FOCUS_WEBHOOK_TOKEN` |
| Focus, produção | `FOCUS_TOKEN_PRODUCAO`, `FOCUS_WEBHOOK_TOKEN` |
| E-mail | `RESEND_API_KEY`, `EMAIL_FROM`; remetente/domínio verificado no provedor |

As chaves precisam pertencer ao ambiente correto. Não trocar as variáveis de ambiente para produção antes de validar o fluxo correspondente. A simples presença de uma chave não comprova funcionamento.

## Validação com os provedores

Após inserir credenciais de teste e dados da empresa, validar checkout, confirmação e reembolso nos provedores habilitados; preço/prazo e etiqueta/rastreio com o contrato dos Correios; modelos fiscais aplicáveis com a Focus; recuperação de senha e notificações por e-mail.

Os provedores precisam alcançar os webhooks da API. `127.0.0.1` não é acessível a eles. A publicação continua pendente; um endpoint temporário de homologação, se necessário, deve ser combinado antes de expor o sistema local.

Nenhuma cobrança, emissão fiscal ou envio externo foi realizado por esta revisão. A cliente solicitou que as contas e credenciais sejam configuradas posteriormente, mantendo todos os provedores e formas previstas disponíveis para configuração. As compras online só serão ativadas com um provedor configurado.

Para repetir a conferência sem exibir segredos: `node apps/api/scripts/verificar-prontidao.mjs`. O relatório usa apenas consultas e não altera o banco.
