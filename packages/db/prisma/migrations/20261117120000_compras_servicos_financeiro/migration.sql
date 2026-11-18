-- CreateEnum
CREATE TYPE "StatusCompra" AS ENUM ('CONFIRMADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusVoucher" AS ENUM ('ATIVO', 'USADO', 'CANCELADO');

-- AlterTable
ALTER TABLE "MovimentoEstoque" ADD COLUMN     "origemId" TEXT,
ADD COLUMN     "origemTipo" TEXT;

-- AlterTable
ALTER TABLE "TituloFinanceiro" ADD COLUMN     "categoriaId" TEXT,
ADD COLUMN     "origemId" TEXT,
ADD COLUMN     "origemTipo" TEXT,
ADD COLUMN     "parcela" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "totalParcelas" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "LancamentoFinanceiro" ADD COLUMN     "conciliadoEm" TIMESTAMPTZ(3),
ADD COLUMN     "referenciaExterna" TEXT;

-- CreateTable
CREATE TABLE "Compra" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "chaveNota" TEXT,
    "emitidaEm" DATE NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "StatusCompra" NOT NULL DEFAULT 'CONFIRMADA',
    "observacao" TEXT,
    "canceladaEm" TIMESTAMPTZ(3),
    "motivoCancelamento" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompraItem" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "compraId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "codigoFornecedor" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "fatorConversao" DECIMAL(12,3) NOT NULL,
    "custoUnitario" DECIMAL(12,4) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "loteId" TEXT,

    CONSTRAINT "CompraItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinculoFornecedorProduto" (
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "codigoFornecedor" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "fatorConversao" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "VinculoFornecedorProduto_pkey" PRIMARY KEY ("empresaId","fornecedorId","codigoFornecedor")
);

-- CreateTable
CREATE TABLE "Servico" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(12,2) NOT NULL,
    "duracaoMin" INTEGER NOT NULL,
    "codigoMunicipal" TEXT,
    "validadeDias" INTEGER NOT NULL DEFAULT 365,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicoInsumo" (
    "empresaId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "ServicoInsumo_pkey" PRIMARY KEY ("empresaId","servicoId","produtoId")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "servicoNome" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "ficha" JSONB NOT NULL,
    "validoAte" DATE NOT NULL,
    "status" "StatusVoucher" NOT NULL DEFAULT 'ATIVO',
    "usadoEm" TIMESTAMPTZ(3),
    "canceladoEm" TIMESTAMPTZ(3),
    "motivo" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoEmpresa" (
    "empresaId" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "inscricaoEstadual" TEXT,
    "inscricaoMunicipal" TEXT,
    "regimeTributario" TEXT,
    "endereco" JSONB,
    "email" TEXT,
    "telefone" TEXT,
    "cepOrigem" TEXT,
    "serieNfe" INTEGER NOT NULL DEFAULT 1,
    "serieNfce" INTEGER NOT NULL DEFAULT 1,
    "ambienteFiscal" TEXT NOT NULL DEFAULT 'homologacao',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "integracoes" JSONB,
    "freteGratisAtivo" BOOLEAN NOT NULL DEFAULT false,
    "freteGratisMinimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "correiosAtivo" BOOLEAN NOT NULL DEFAULT false,
    "contaOnlineId" TEXT,

    CONSTRAINT "ConfiguracaoEmpresa_pkey" PRIMARY KEY ("empresaId")
);

-- CreateTable
CREATE TABLE "RecuperacaoSenha" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usadaEm" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecuperacaoSenha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProdutoComplemento" (
    "produtoId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "ncm" TEXT,
    "cest" TEXT,
    "ean" TEXT,
    "cfopVenda" TEXT,
    "origem" INTEGER NOT NULL DEFAULT 0,
    "csosn" TEXT,
    "cst" TEXT,
    "aliquotaIcms" DECIMAL(7,4),
    "aliquotaIbs" DECIMAL(7,4),
    "aliquotaCbs" DECIMAL(7,4),
    "pesoGramas" INTEGER,
    "alturaCm" INTEGER,
    "larguraCm" INTEGER,
    "comprimentoCm" INTEGER,
    "publicadoLoja" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProdutoComplemento_pkey" PRIMARY KEY ("produtoId")
);

-- CreateTable
CREATE TABLE "NotaRecebida" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "fornecedorNome" TEXT NOT NULL,
    "fornecedorDocumento" TEXT NOT NULL,
    "emitidaEm" DATE NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "versaoFocus" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'NOVA',
    "xml" TEXT,
    "dados" JSONB NOT NULL,
    "compraId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotaRecebida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotaEmitida" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "vendaId" TEXT,
    "voucherId" TEXT,
    "modelo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "payload" JSONB NOT NULL,
    "retorno" JSONB,
    "xml" TEXT,
    "danfeUrl" TEXT,
    "mensagem" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotaEmitida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegracaoJob" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bloqueadoAte" TIMESTAMPTZ(3),
    "bloqueioToken" TEXT,
    "erro" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegracaoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvento" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "chaveExterna" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processadoEm" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaCliente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "consentimentoEm" TIMESTAMPTZ(3) NOT NULL,
    "excluidaEm" TIMESTAMPTZ(3),

    CONSTRAINT "ContaCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessaoCliente" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SessaoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoOnline" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "chaveOperacao" TEXT NOT NULL,
    "hashOperacao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO',
    "itens" JSONB NOT NULL,
    "endereco" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "frete" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "servicoFrete" TEXT NOT NULL,
    "prazoDias" INTEGER,
    "gateway" TEXT NOT NULL,
    "gatewayId" TEXT,
    "checkoutUrl" TEXT,
    "pagamentoId" TEXT,
    "vendaId" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "pagoEm" TIMESTAMPTZ(3),
    "rastreio" TEXT,
    "etiquetaUrl" TEXT,
    "eventos" JSONB,
    "cpfNaNota" BOOLEAN NOT NULL DEFAULT false,
    "notaPorEmail" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedidoOnline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservaEstoque" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReservaEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaFinanceira" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeChave" TEXT NOT NULL,
    "tipo" "TipoTituloFinanceiro" NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CategoriaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FechamentoCaixa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "saldoEsperado" DECIMAL(18,2) NOT NULL,
    "saldoContado" DECIMAL(18,2) NOT NULL,
    "diferenca" DECIMAL(18,2) NOT NULL,
    "observacao" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FechamentoCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Compra_empresaId_createdAt_idx" ON "Compra"("empresaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_empresaId_id_key" ON "Compra"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_empresaId_chaveNota_key" ON "Compra"("empresaId", "chaveNota");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_empresaId_fornecedorId_numero_key" ON "Compra"("empresaId", "fornecedorId", "numero");

-- CreateIndex
CREATE INDEX "CompraItem_empresaId_compraId_idx" ON "CompraItem"("empresaId", "compraId");

-- CreateIndex
CREATE INDEX "Servico_empresaId_ativo_nome_idx" ON "Servico"("empresaId", "ativo", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Servico_empresaId_id_key" ON "Servico"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_codigo_key" ON "Voucher"("codigo");

-- CreateIndex
CREATE INDEX "Voucher_empresaId_clienteId_idx" ON "Voucher"("empresaId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_empresaId_id_key" ON "Voucher"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecuperacaoSenha_tokenHash_key" ON "RecuperacaoSenha"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoComplemento_empresaId_slug_key" ON "ProdutoComplemento"("empresaId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoComplemento_empresaId_produtoId_key" ON "ProdutoComplemento"("empresaId", "produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "NotaRecebida_empresaId_chave_key" ON "NotaRecebida"("empresaId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "NotaRecebida_empresaId_id_key" ON "NotaRecebida"("empresaId", "id");

-- CreateIndex
CREATE INDEX "NotaEmitida_empresaId_createdAt_idx" ON "NotaEmitida"("empresaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotaEmitida_empresaId_id_key" ON "NotaEmitida"("empresaId", "id");

-- CreateIndex
CREATE INDEX "IntegracaoJob_status_proximaEm_idx" ON "IntegracaoJob"("status", "proximaEm");

-- CreateIndex
CREATE UNIQUE INDEX "IntegracaoJob_empresaId_tipo_referencia_key" ON "IntegracaoJob"("empresaId", "tipo", "referencia");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvento_origem_chaveExterna_key" ON "WebhookEvento"("origem", "chaveExterna");

-- CreateIndex
CREATE UNIQUE INDEX "ContaCliente_empresaId_email_key" ON "ContaCliente"("empresaId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ContaCliente_empresaId_clienteId_key" ON "ContaCliente"("empresaId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "ContaCliente_empresaId_id_key" ON "ContaCliente"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SessaoCliente_tokenHash_key" ON "SessaoCliente"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoOnline_numero_key" ON "PedidoOnline"("numero");

-- CreateIndex

-- CreateIndex
CREATE UNIQUE INDEX "PedidoOnline_pagamentoId_key" ON "PedidoOnline"("pagamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoOnline_vendaId_key" ON "PedidoOnline"("vendaId");

-- CreateIndex
CREATE INDEX "PedidoOnline_empresaId_clienteId_idx" ON "PedidoOnline"("empresaId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoOnline_empresaId_chaveOperacao_key" ON "PedidoOnline"("empresaId", "chaveOperacao");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoOnline_empresaId_id_key" ON "PedidoOnline"("empresaId", "id");

-- CreateIndex
CREATE INDEX "ReservaEstoque_empresaId_produtoId_expiresAt_idx" ON "ReservaEstoque"("empresaId", "produtoId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReservaEstoque_empresaId_pedidoId_produtoId_key" ON "ReservaEstoque"("empresaId", "pedidoId", "produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaFinanceira_empresaId_id_key" ON "CategoriaFinanceira"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaFinanceira_empresaId_tipo_nomeChave_key" ON "CategoriaFinanceira"("empresaId", "tipo", "nomeChave");

-- CreateIndex
CREATE UNIQUE INDEX "FechamentoCaixa_empresaId_contaId_data_key" ON "FechamentoCaixa"("empresaId", "contaId", "data");

-- AddForeignKey
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_empresaId_categoriaId_fkey" FOREIGN KEY ("empresaId", "categoriaId") REFERENCES "CategoriaFinanceira"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_empresaId_fornecedorId_fkey" FOREIGN KEY ("empresaId", "fornecedorId") REFERENCES "Fornecedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_empresaId_compraId_fkey" FOREIGN KEY ("empresaId", "compraId") REFERENCES "Compra"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicoInsumo" ADD CONSTRAINT "ServicoInsumo_empresaId_servicoId_fkey" FOREIGN KEY ("empresaId", "servicoId") REFERENCES "Servico"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicoInsumo" ADD CONSTRAINT "ServicoInsumo_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_empresaId_servicoId_fkey" FOREIGN KEY ("empresaId", "servicoId") REFERENCES "Servico"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracaoEmpresa" ADD CONSTRAINT "ConfiguracaoEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecuperacaoSenha" ADD CONSTRAINT "RecuperacaoSenha_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoComplemento" ADD CONSTRAINT "ProdutoComplemento_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaRecebida" ADD CONSTRAINT "NotaRecebida_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaEmitida" ADD CONSTRAINT "NotaEmitida_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessaoCliente" ADD CONSTRAINT "SessaoCliente_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "ContaCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoOnline" ADD CONSTRAINT "PedidoOnline_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaEstoque" ADD CONSTRAINT "ReservaEstoque_empresaId_pedidoId_fkey" FOREIGN KEY ("empresaId", "pedidoId") REFERENCES "PedidoOnline"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaEstoque" ADD CONSTRAINT "ReservaEstoque_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaFinanceira" ADD CONSTRAINT "CategoriaFinanceira_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FechamentoCaixa" ADD CONSTRAINT "FechamentoCaixa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Compra" ADD CONSTRAINT "Compra_total_check" CHECK (total > 0);
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_valores_check" CHECK (quantidade > 0 AND "fatorConversao" > 0 AND "custoUnitario" >= 0 AND total >= 0);
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_valores_check" CHECK (preco > 0 AND "duracaoMin" BETWEEN 1 AND 1440 AND "validadeDias" BETWEEN 1 AND 3650);
ALTER TABLE "ServicoInsumo" ADD CONSTRAINT "ServicoInsumo_quantidade_check" CHECK (quantidade > 0);
ALTER TABLE "ReservaEstoque" ADD CONSTRAINT "ReservaEstoque_quantidade_check" CHECK (quantidade > 0);
ALTER TABLE "PedidoOnline" ADD CONSTRAINT "PedidoOnline_total_check" CHECK (subtotal > 0 AND frete >= 0 AND total = subtotal + frete);
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_parcelas_check" CHECK (parcela > 0 AND "totalParcelas" >= parcela);
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_empresaId_clienteId_fkey" FOREIGN KEY ("empresaId","clienteId") REFERENCES "Cliente"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "ContaCliente" ADD CONSTRAINT "ContaCliente_empresaId_clienteId_fkey" FOREIGN KEY ("empresaId","clienteId") REFERENCES "Cliente"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "PedidoOnline" ADD CONSTRAINT "PedidoOnline_empresaId_clienteId_fkey" FOREIGN KEY ("empresaId","clienteId") REFERENCES "Cliente"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "PedidoOnline" ADD CONSTRAINT "PedidoOnline_empresaId_vendaId_fkey" FOREIGN KEY ("empresaId","vendaId") REFERENCES "Venda"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "VinculoFornecedorProduto" ADD CONSTRAINT "VinculoFornecedorProduto_fornecedor_fkey" FOREIGN KEY ("empresaId","fornecedorId") REFERENCES "Fornecedor"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "VinculoFornecedorProduto" ADD CONSTRAINT "VinculoFornecedorProduto_produto_fkey" FOREIGN KEY ("empresaId","produtoId") REFERENCES "Produto"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_lote_fkey" FOREIGN KEY ("empresaId","produtoId","loteId") REFERENCES "Lote"("empresaId","produtoId",id) ON DELETE RESTRICT;
ALTER TABLE "NotaRecebida" ADD CONSTRAINT "NotaRecebida_compra_fkey" FOREIGN KEY ("empresaId","compraId") REFERENCES "Compra"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "NotaEmitida" ADD CONSTRAINT "NotaEmitida_venda_fkey" FOREIGN KEY ("empresaId","vendaId") REFERENCES "Venda"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "NotaEmitida" ADD CONSTRAINT "NotaEmitida_voucher_fkey" FOREIGN KEY ("empresaId","voucherId") REFERENCES "Voucher"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "FechamentoCaixa" ADD CONSTRAINT "FechamentoCaixa_conta_fkey" FOREIGN KEY ("empresaId","contaId") REFERENCES "ContaFinanceira"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "FechamentoCaixa" ADD CONSTRAINT "FechamentoCaixa_usuario_fkey" FOREIGN KEY ("empresaId","usuarioId") REFERENCES "Usuario"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "ConfiguracaoEmpresa" ADD CONSTRAINT "ConfiguracaoEmpresa_conta_fkey" FOREIGN KEY ("empresaId","contaOnlineId") REFERENCES "ContaFinanceira"("empresaId",id) ON DELETE RESTRICT;
ALTER TABLE "IntegracaoJob" ADD CONSTRAINT "IntegracaoJob_empresa_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"(id) ON DELETE RESTRICT;
CREATE TRIGGER compra_item_imutavel BEFORE UPDATE OR DELETE ON "CompraItem" FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_comercial();
CREATE TRIGGER fechamento_caixa_imutavel BEFORE UPDATE OR DELETE ON "FechamentoCaixa" FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_comercial();
CREATE FUNCTION proteger_lancamento_financeiro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (to_jsonb(OLD)-'conciliadoEm'-'referenciaExterna')=(to_jsonb(NEW)-'conciliadoEm'-'referenciaExterna') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Registro comercial imutável; registre um estorno.';
END;
$$;
DROP TRIGGER lancamento_financeiro_imutavel ON "LancamentoFinanceiro";
CREATE TRIGGER lancamento_financeiro_imutavel BEFORE UPDATE OR DELETE ON "LancamentoFinanceiro" FOR EACH ROW EXECUTE FUNCTION proteger_lancamento_financeiro();