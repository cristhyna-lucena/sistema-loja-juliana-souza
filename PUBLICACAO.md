# Preparação para publicação

Este roteiro prepara a execução do sistema existente. Nenhuma hospedagem, domínio, conta, regra de negócio ou integração foi contratada, publicada ou ativada por ele. Configurações comerciais e credenciais permanecem para depois, conforme decisão da cliente.

## Estrutura de execução

O projeto usa Node.js 24, pnpm 12.15.0, PostgreSQL, Redis e armazenamento S3 privado. São quatro processos persistentes:

| Processo | Comando individual a partir da raiz | Endereço interno |
| --- | --- | --- |
| Loja | `pnpm --filter @sistema/loja start` | `127.0.0.1:3000` |
| Painel | `pnpm --filter @sistema/admin start` | `127.0.0.1:3001` |
| API | `pnpm --filter @sistema/api start` | `127.0.0.1:3002` |
| Worker | `pnpm --filter @sistema/worker start` | Sem porta HTTP |

`pnpm start` inicia os quatro pelo Turbo. Não executa instalação, migrations ou build automaticamente. Os comandos `start` carregam o `.env` da raiz por `infra/production-env.mjs`, definem `NODE_ENV=production` e preservam variáveis já injetadas pelo servidor. A execução em desenvolvimento permanece com `pnpm dev`.

Os processos HTTP continuam limitados ao loopback. A topologia preparada exige execução no mesmo servidor e um proxy HTTPS para loja e painel; não é uma configuração pronta para contêineres separados. O provedor de hospedagem e o supervisor de processos serão definidos na publicação.

O teste local da inicialização compilada é `npx --yes pnpm@12.15.0 test:producao`. Ele usa portas locais de teste, uma API simulada para os proxies e consultas de saúde na API real, sem cadastrar dados comerciais ou consultar provedores externos. Exige build concluído, `.env` local e serviços de infraestrutura ativos. Não executá-lo no servidor de produção.

## Campos da publicação

`output/finalizacao/publicacao.env.example` lista os campos de infraestrutura a preencher no servidor. Não é carregado pela aplicação. Não copiar sobre o `.env` local, nem transportar senhas locais como credenciais definitivas de produção.

- `ADMIN_ORIGIN` e `LOJA_ORIGIN`: origens públicas HTTPS, sem caminho ou barra final. O endereço do painel também é usado pelo botão Gestão da página inicial.
- `API_INTERNAL_URL`: acesso privado à API; o navegador acessa os proxies do painel e da loja.
- `DATABASE_URL` e `REDIS_URL`: serviços persistentes do ambiente publicado.
- `S3_ENDPOINT`: endpoint HTTPS acessível ao servidor e ao navegador, pois o envio das fotos usa URL assinada. Configurar CORS para a origem real do painel, permitindo os cabeçalhos e métodos do upload. Manter o bucket privado.
- Os campos S3 usam os nomes já suportados pelo projeto. A escolha e manutenção do provedor S3 pertencem à implantação; o MinIO local não deve ser tratado como uma escolha aprovada para produção.
- Pagamentos, Correios, fiscal e e-mail permanecem nos campos existentes e desativados no cadastro. O modelo de teste está em `output/finalizacao/configuracao-teste.env.example`.

## Sequência no servidor, após autorização para publicar

1. Definir hospedagem, domínios, HTTPS e serviços persistentes. Configurar o ambiente do servidor sem expor credenciais em arquivos públicos.
2. Fazer backup do banco e do armazenamento, incluindo os objetos privados. Confirmar a forma de recuperação antes de substituir uma instalação existente. Preservar o administrador e os dados reais; não executar seeds ou resets.
3. Instalar as dependências com o lockfile e compilar a revisão aprovada:

   ```text
   npx --yes pnpm@12.15.0 install --frozen-lockfile
   npx --yes pnpm@12.15.0 build
   npx --yes pnpm@12.15.0 typecheck
   ```

4. Conferir migrations. Aplicar somente as pendentes, no banco correto e com backup anterior:

   ```text
   npx --yes pnpm@12.15.0 db:status
   npx --yes pnpm@12.15.0 db:migrate
   ```

5. Configurar o proxy HTTPS para as portas locais e encaminhar host/protocolo corretamente. Caso a futura implantação precise receber webhooks, encaminhar apenas as rotas necessárias; não publicar indiscriminadamente toda a API administrativa. Não abrir túnel na preparação local.
6. Iniciar os quatro processos com supervisão, reinício e logs. `npx --yes pnpm@12.15.0 start` é o comando conjunto; os comandos individuais estão acima. Não iniciar outra cópia sobre as mesmas portas.
7. Conferir `/health` e `/health/ready` da API pela rede privada; loja, login do painel, atendimento, imagens e origens dos formulários pelo HTTPS público. Conferir os cookies seguros de produção. Verificar proteção do painel sem sessão.
8. Manter os módulos ainda não configurados sem ativação. A publicação não valida automaticamente pagamentos, e-mail, entrega ou emissão fiscal; a ativação futura depende das respectivas configurações e testes reais.

O banco local já tem as nove migrations. Esse fato não permite assumir que um futuro banco de hospedagem também as tenha. Os testes automatizados do projeto usam recursos locais isolados; não executar suítes que criam bancos e buckets contra a produção.

## Retorno à versão anterior

Preservar uma cópia da revisão anterior e registrar a versão do banco antes da implantação. Se apenas o código falhar, parar os processos novos e voltar ao código compatível. Alterações de banco exigem revisão própria: não restaurar backup automaticamente sobre dados recebidos após a publicação. Nenhum rollback destrutivo foi automatizado.
