# Validação E2E antes da publicação

A suíte combina percursos reais no Chromium, integração com PostgreSQL/Redis/S3/worker e verificações de domínio. Resultados de contratos simulados são separados de homologação externa. Não faz deploy, não altera DNS e não cadastra dados de teste na empresa real.

## Executar

Com Node.js 24, dependências instaladas, Chromium e Docker local disponíveis:

1. Pausar somente os servidores de desenvolvimento deste projeto antes de compilar. Não executar `next dev` e a compilação sobre o mesmo `.next`.
2. Manter PostgreSQL, Redis e MinIO locais ativos, sem recriar volumes ou substituir `.env`.
3. Na raiz:

   ```text
   npx --yes pnpm@12.15.0 build
   npx --yes pnpm@12.15.0 typecheck
   npx --yes pnpm@12.15.0 test:e2e
   ```

O runner compara o conteúdo do banco principal e do `.env` antes/depois, executa as suítes sequencialmente e gera o relatório em `output/e2e/RELATORIO-E2E-2026-11-18.md`. Continua o levantamento após uma falha e termina com código diferente de zero se alguma suíte falhar ou se a comparação detectar alterações. Não corrige a aplicação automaticamente.

Para repetir somente uma área, usar `node tests/e2e/run.mjs --only=complementar` ou outra identificação da tabela. Cada execução mantém logs próprios em `artifacts/e2e-completo/<identificador>/`. `ultima-execucao.txt` aponta para a rodada mais recente. O resultado detalhado é `resultado.json`; os eventos de cada caso ficam nos arquivos `.ndjson`.

## Cobertura por fluxo

| Identificação | Fluxos e tipos de validação |
| --- | --- |
| infraestrutura | Conexão, migrations, relações, isolamento, rollback e Redis. As escritas de infraestrutura são transações revertidas. |
| autenticacao | Primeiro administrador, login no navegador, erro de credencial/origem, sessão, expiração, limites, logout, cookies de produção e perfis. |
| catalogo | Categorias/produtos: criar, pesquisar, paginar, editar, validar, inativar, precisão de preços, conflitos, auditoria e celular. |
| gestao | Clientes/fornecedores no navegador; lotes, estoque, custos, alertas, idempotência, concorrência, estornos e migração do histórico. |
| comercial | Venda no navegador, recebimentos, parcelas, cancelamento, despesas, caixa, reenvio após resposta perdida e permissões. |
| fotos | Upload real no S3 privado, validação dos bytes, worker, variantes, fila, recuperação, arraste, capa, ordenação, troca, remoção, restauração e limpeza. |
| operacoes | Compras, conversão de unidades, serviços/vouchers, financeiro, checkout, reservas, fila fiscal e XML/ZIP; contratos de provedores simulados. |
| operacoes-painel | Compras, serviço publicado, configurações, transferências, relatórios, importação XML, cadastro/compra do cliente, idempotência, erros e recuperação de senha no navegador/API. |
| producao | Leitura do ambiente, inicialização compilada, origens, API privada, proteção dos proxies e saúde em produção local. |
| saude | Abertura da loja, login do painel e API compilada. |
| complementar | Abertura dos módulos e formulários; cadastro/edição/inativação de usuários pelo navegador; login com novo perfil; bloqueio do último administrador; carrinho; conta do cliente e encerramento; erros/recuperação; visual original em cinco larguras. |

O inventário de páginas e rotas HTTP é gerado por `node tests/e2e/inventory.mjs`. Inventário não equivale, por si só, à aprovação de cada endpoint. A evidência é o resultado do cenário que percorre o fluxo correspondente.

## Isolamento e evidências

As suítes funcionais usam bancos com identificadores aleatórios, contas fictícias, namespaces Redis e, no teste de fotos, bucket S3 exclusivo. Removem seus próprios recursos ao finalizar. A suíte complementar grava trace de navegação e cobertura de páginas em `artifacts/e2e-complementar/`. Screenshots das outras suítes ficam em suas pastas de artefatos existentes.

Não usar esta suíte contra produção. Não habilitar integrações reais para executá-la. O relatório deve declarar os fluxos não executados, erros e limitações sem transformar respostas simuladas em validação dos provedores reais.

Sem contas/configurações reais, não estão homologados: cobrança e reembolso nos gateways; entrega, preço e etiqueta no contrato Correios; emissão/cancelamento/correção fiscal e regras municipais; entrega de e-mail; DNS, TLS e webhooks externos. Esses itens não serão ativados por esta etapa.
