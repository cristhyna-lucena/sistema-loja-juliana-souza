# Operações e integrações — 17/11/2026

Atualização da finalização: Next.js 16.4.5 e Multer 2.5.0 instalados; auditoria completa sem vulnerabilidades conhecidas. A cliente solicitou manter a configuração dos provedores para depois, com todas as opções previstas disponíveis. O painel aceita dinheiro, Pix, crédito, débito, transferência e boleto; o checkout online oferece as formas habilitadas no provedor escolhido. As cobranças continuam bloqueadas enquanto não houver provedor configurado.

O banco real ainda não possui produtos comerciais nem configuração da empresa. O PDF contém dados ilustrativos, que não foram importados como preços ou estoque. A preparação e os campos necessários estão em `output/finalizacao/CONFIGURACAO-PENDENTE.md`; a tabela para preenchimento está em `output/finalizacao/catalogo-para-preencher.csv`. Esses dados podem ser completados antes da operação real.

A publicação não foi realizada. O banco local recebeu as duas novas migrations após backup em `tmp/backups/antes-etapas-finais-20261117.dump`. O código anterior está em `tmp/antes-etapas-finais/`. Essas cópias são locais; não substituem o backup externo da implantação.

## Funcionalidades disponíveis

- Compras com conversão de unidades, lotes, rateio de despesas/desconto no custo, parcelas, cancelamento e importação de XML com vínculo dos códigos do fornecedor aos produtos.
- Serviços com ficha de insumos, vouchers vendidos no painel ou na loja e baixa de estoque no atendimento. O voucher preserva preço e ficha da venda.
- Financeiro com taxas, categorias, parcelamento do saldo, transferências com estorno dos dois lados, conferência de caixa e conciliação. Vendas parceladas recebem por vencimento.
- Configuração da empresa, usuários/perfis, dados fiscais e publicação de produtos/serviços. Recuperação de senha depende do e-mail configurado.
- Recebimento de XML, consulta de notas pela Focus, manifestações, emissão/consulta/cancelamento e carta de correção quando suportada pelo modelo. Exportação mensal de XML em ZIP, relatórios e fila de integrações com tentativas e revisão de falhas.
- Loja com catálogo publicado, fotos, carrinho, conta do cliente, recuperação de acesso, checkout, histórico de pedidos e vouchers. Produtos e serviços têm checkouts separados.
- Pedidos com reserva de estoque, confirmação de pagamento consultada no provedor, proteção contra duplicidade, cancelamento/reembolso e acompanhamento de entrega. Um voucher ativo é cancelado se o pagamento for reembolsado. O reembolso externo não devolve fisicamente produtos já vendidos; a devolução de estoque exige a operação de cancelamento correspondente.

## Pagamento e frete

Foram mantidos os três provedores previstos como alternativas: Mercado Pago, Asaas e Pagar.me. O checkout usa páginas hospedadas pelos provedores; não armazena dados de cartão. Pix, boleto e cartões dependem da habilitação e das condições da conta escolhida. As opções ficam em Configurações e só aparecem como disponíveis ao cliente quando há credencial no servidor.

O frete oferece Correios e frete grátis. O administrador define se cada opção está habilitada e o valor mínimo para gratuidade; mínimo zero permite gratuidade para qualquer pedido. Correios exige contrato/credenciais, CEP de origem e peso/dimensões dos produtos. Inclui adaptador para PAC/SEDEX, pré-postagem, etiqueta e rastreio.

## Configuração antes do uso real

Os nomes das variáveis estão em `.env.example`; não colocar segredos no navegador nem no repositório. O `.env` existente não foi preenchido com credenciais inventadas.

1. Em Configurações, preencher dados reais da empresa, endereço, conta de recebimento e opções de frete/integração. Nos produtos e serviços, preencher os dados fiscais com a contadora e selecionar os itens publicados.
2. Configurar as credenciais dos provedores desejados, Correios, Focus e Resend no servidor. O ambiente padrão dos adaptadores Asaas, Pagar.me e Correios é homologação; usar `producao` somente após homologar. Mercado Pago usa a credencial fornecida e o ambiente seleciona a URL de checkout. A Focus usa o ambiente fiscal salvo na configuração e tokens separados.
3. Registrar webhooks no provedor apontando para a API pública: `/webhooks/pagamento/MERCADO_PAGO`, `/webhooks/pagamento/ASAAS`, `/webhooks/pagamento/PAGARME` e `/webhooks/focus`. Configurar os respectivos segredos. A Focus usa `Authorization: Bearer <FOCUS_WEBHOOK_TOKEN>`; Pagar.me usa Basic com usuário/senha configurados. Conferir a disponibilidade desses mecanismos na conta contratada.
4. Configurar `LOJA_ORIGIN`, `ADMIN_ORIGIN`, `PUBLIC_API_URL`, `API_INTERNAL_URL`, HTTPS e o worker no ambiente de publicação. O worker processa e-mail, criação de pagamentos, reembolsos, documentos fiscais, etiquetas e consultas periódicas. A API processa confirmações de pagamento recebidas e expira reservas.
5. Homologar transações reais de teste: cobrança e reembolso em cada provedor habilitado, emissão/cancelamento dos modelos fiscais usados pela empresa, consulta de notas recebidas, entrega de e-mail e etiqueta/rastreio com o contrato dos Correios.

Os testes locais de integração usam respostas simuladas e não comprovam homologação externa. O download de etiqueta dos Correios, em especial, precisa ser confirmado com a resposta do contrato habilitado. A emissão de NFS-e depende do município/padrão e das informações fiscais aplicáveis. Não foram feitas cobranças, emissões fiscais ou envios de e-mail reais durante os testes.

## Verificação local

Com Docker ativo e dependências instaladas:

```powershell
npx --yes pnpm@12.15.0 db:migrate
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 test:operacoes
npx --yes pnpm@12.15.0 test:operacoes:painel
```

As novas suítes criam bancos temporários e os removem ao finalizar. O teste do painel/loja usa as portas 43187, 43189 e 43190 e registra capturas em `artifacts/etapas-finais/`. Os testes anteriores continuam nos scripts `test`, `test:infra`, `test:auth`, `test:catalogo`, `test:gestao`, `test:gestao:painel`, `test:comercial`, `test:comercial:painel` e `test:fotos`.

## Resultado da verificação desta entrega

- Build: nove pacotes aprovados; verificação de tipos: 14 tarefas aprovadas.
- Novas operações/adaptadores/fila fiscal: 24 testes aprovados, incluindo configuração posterior dos provedores.
- Painel/loja e recuperação de senha: oito testes aprovados.
- Regressão de autenticação, catálogo, custos, gestão, comercial e fotos: 61 testes aprovados; suítes de navegador de gestão/comercial: 21 aprovados.
- Inicialização das aplicações: três testes aprovados; PostgreSQL/Redis: cinco aprovados.
- Nove migrations aplicadas no banco local, sem pendências. Capturas de compras, pedido e conta em celular inspecionadas.

O driver PostgreSQL emite um aviso de depreciação durante leituras relacionais do Prisma; as verificações transacionais passaram. Não foi feita alteração no código da dependência para esconder o aviso.
