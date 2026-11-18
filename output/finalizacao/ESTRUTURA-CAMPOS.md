# Estrutura para configuração posterior

Escopo confirmado pela cliente em 18/11/2026: preparar campos, incluindo teste, mantendo o funcionamento atual. Definição de regras, ativação e implementação de funcionalidades adicionais ficam para depois.

## Campos existentes conferidos

| Área | Campos preparados | Local |
| --- | --- | --- |
| Empresa | Nome, CNPJ, razão social, inscrições estadual e municipal, e-mail e telefone | Configurações do painel; schema compartilhado |
| Endereço | CEP, logradouro, número, complemento, bairro, cidade, UF e código IBGE | Configurações do painel; schema compartilhado |
| Fiscal | Regime tributário, ambiente de homologação/produção, séries NF-e e NFC-e | Configurações do painel; schema compartilhado |
| Recebimentos | Conta financeira para recebimentos online | Configurações do painel; schema compartilhado |
| Integrações | Campos de ativação e indicação da presença de credenciais | Configurações do painel |
| Entrega | CEP de origem, Correios, frete grátis e valor mínimo | Configurações do painel; schema compartilhado |
| Catálogo | Apresentação, SKU, preço, quantidade, lote, validade, peso, medidas e NCM | Modelo existente `catalogo-para-preencher.csv` |
| Teste de pagamentos e Correios | Ambiente de homologação e campos de credenciais/webhooks | `.env.example`; modelo separado `configuracao-teste.env.example` |
| Teste fiscal | Ambiente de homologação e campo de token correspondente | Painel e modelo separado |
| E-mail | Chave e remetente | Modelo separado; não há simulação nova nesta etapa |

Os campos de credenciais pertencem à configuração do servidor; não foram acrescentadas caixas de senha ao painel. O modelo separado não é carregado pela aplicação e não modifica o `.env`.

## Estado preservado

Dados já recebidos continuam cadastrados. Os demais campos ficam aguardando preenchimento, sem dados fictícios. Nenhuma regra, funcionalidade, integração, migration, preço, estoque ou configuração em execução foi alterada nesta revisão. Nenhuma publicação realizada.

Conferência somente de fontes e modelos; não foi necessário repetir testes funcionais, pois esta revisão alterou apenas documentação e um modelo inativo de configuração.

## Conferência final do modelo de teste

Os 19 campos do modelo foram comparados com `.env.example`: nomes já previstos, sem duplicatas, credenciais vazias e seletores de ambiente em homologação. A leitura dos fontes de API, worker, integrações e infraestrutura não encontrou referência ao arquivo de modelo. Os seletores de ambiente também foram localizados nos adaptadores existentes. Nenhum teste externo foi executado e nenhuma configuração em uso foi modificada.
