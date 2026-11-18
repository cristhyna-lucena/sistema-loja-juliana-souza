-- CreateEnum
CREATE TYPE "StatusVenda" AS ENUM ('CONFIRMADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoTituloFinanceiro" AS ENUM ('PAGAR', 'RECEBER');

-- CreateEnum
CREATE TYPE "FormaFinanceira" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'TRANSFERENCIA', 'BOLETO');

-- AlterTable
ALTER TABLE "MovimentoEstoque" ADD COLUMN     "vendaId" TEXT;

-- CreateTable
CREATE TABLE "Venda" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT,
    "clienteNome" TEXT,
    "status" "StatusVenda" NOT NULL DEFAULT 'CONFIRMADA',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "observacao" TEXT,
    "canceladaEm" TIMESTAMPTZ(3),
    "motivoCancelamento" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaItem" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "precoUnitario" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "VendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaFinanceira" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeChave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TituloFinanceiro" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "TipoTituloFinanceiro" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "clienteId" TEXT,
    "fornecedorId" TEXT,
    "vendaId" TEXT,
    "canceladoEm" TIMESTAMPTZ(3),
    "motivoCancelamento" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TituloFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LancamentoFinanceiro" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tituloId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "forma" "FormaFinanceira" NOT NULL,
    "data" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "estornoDeId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LancamentoFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperacaoComercial" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "resultadoId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperacaoComercial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Venda_numero_key" ON "Venda"("numero");

-- CreateIndex
CREATE INDEX "Venda_empresaId_createdAt_idx" ON "Venda"("empresaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Venda_empresaId_id_key" ON "Venda"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "VendaItem_empresaId_vendaId_produtoId_key" ON "VendaItem"("empresaId", "vendaId", "produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "ContaFinanceira_empresaId_id_key" ON "ContaFinanceira"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContaFinanceira_empresaId_nomeChave_key" ON "ContaFinanceira"("empresaId", "nomeChave");

-- CreateIndex
CREATE INDEX "TituloFinanceiro_empresaId_vencimento_idx" ON "TituloFinanceiro"("empresaId", "vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "TituloFinanceiro_empresaId_id_key" ON "TituloFinanceiro"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TituloFinanceiro_empresaId_vendaId_key" ON "TituloFinanceiro"("empresaId", "vendaId");

-- CreateIndex
CREATE INDEX "LancamentoFinanceiro_empresaId_tituloId_idx" ON "LancamentoFinanceiro"("empresaId", "tituloId");

-- CreateIndex
CREATE INDEX "LancamentoFinanceiro_empresaId_contaId_data_idx" ON "LancamentoFinanceiro"("empresaId", "contaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "LancamentoFinanceiro_empresaId_id_key" ON "LancamentoFinanceiro"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LancamentoFinanceiro_empresaId_estornoDeId_key" ON "LancamentoFinanceiro"("empresaId", "estornoDeId");

-- CreateIndex
CREATE UNIQUE INDEX "OperacaoComercial_empresaId_chave_key" ON "OperacaoComercial"("empresaId", "chave");

-- CreateIndex
CREATE INDEX "MovimentoEstoque_empresaId_vendaId_idx" ON "MovimentoEstoque"("empresaId", "vendaId");

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_empresaId_vendaId_fkey" FOREIGN KEY ("empresaId", "vendaId") REFERENCES "Venda"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_empresaId_clienteId_fkey" FOREIGN KEY ("empresaId", "clienteId") REFERENCES "Cliente"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_empresaId_vendaId_fkey" FOREIGN KEY ("empresaId", "vendaId") REFERENCES "Venda"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaFinanceira" ADD CONSTRAINT "ContaFinanceira_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_empresaId_clienteId_fkey" FOREIGN KEY ("empresaId", "clienteId") REFERENCES "Cliente"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_empresaId_fornecedorId_fkey" FOREIGN KEY ("empresaId", "fornecedorId") REFERENCES "Fornecedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_empresaId_vendaId_fkey" FOREIGN KEY ("empresaId", "vendaId") REFERENCES "Venda"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoFinanceiro" ADD CONSTRAINT "LancamentoFinanceiro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoFinanceiro" ADD CONSTRAINT "LancamentoFinanceiro_empresaId_tituloId_fkey" FOREIGN KEY ("empresaId", "tituloId") REFERENCES "TituloFinanceiro"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoFinanceiro" ADD CONSTRAINT "LancamentoFinanceiro_empresaId_contaId_fkey" FOREIGN KEY ("empresaId", "contaId") REFERENCES "ContaFinanceira"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoFinanceiro" ADD CONSTRAINT "LancamentoFinanceiro_empresaId_estornoDeId_fkey" FOREIGN KEY ("empresaId", "estornoDeId") REFERENCES "LancamentoFinanceiro"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperacaoComercial" ADD CONSTRAINT "OperacaoComercial_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Venda" ADD CONSTRAINT "Venda_valores_check" CHECK (subtotal > 0 AND desconto >= 0 AND total > 0 AND total = subtotal - desconto);
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_cancelamento_check" CHECK ((status = 'CANCELADA') = ("canceladaEm" IS NOT NULL AND "motivoCancelamento" IS NOT NULL));
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_valores_check" CHECK (quantidade > 0 AND "precoUnitario" >= 0 AND total = round(quantidade * "precoUnitario",2));
ALTER TABLE "ContaFinanceira" ADD CONSTRAINT "ContaFinanceira_tipo_check" CHECK (tipo IN ('CAIXA','BANCO') AND versao > 0);
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_valores_check" CHECK (valor > 0 AND (tipo='PAGAR' OR "fornecedorId" IS NULL) AND (tipo='RECEBER' OR "clienteId" IS NULL));
ALTER TABLE "LancamentoFinanceiro" ADD CONSTRAINT "LancamentoFinanceiro_valor_check" CHECK (valor <> 0 AND length(trim(motivo)) BETWEEN 3 AND 500);
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_venda_check" CHECK ("vendaId" IS NULL OR tipo IN ('SAIDA','ESTORNO'));

CREATE FUNCTION impedir_alteracao_comercial() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Registro comercial imutável; registre um estorno ou cancelamento.'; END;
$$;
CREATE TRIGGER lancamento_financeiro_imutavel BEFORE UPDATE OR DELETE ON "LancamentoFinanceiro" FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_comercial();
CREATE TRIGGER venda_item_imutavel BEFORE UPDATE OR DELETE ON "VendaItem" FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_comercial();
CREATE TRIGGER operacao_comercial_imutavel BEFORE UPDATE OR DELETE ON "OperacaoComercial" FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_comercial();

CREATE FUNCTION validar_lancamento_financeiro() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "LancamentoFinanceiro"; tipo_titulo "TipoTituloFinanceiro";
BEGIN
  IF NEW."estornoDeId" IS NOT NULL THEN
    SELECT * INTO original FROM "LancamentoFinanceiro" WHERE "empresaId"=NEW."empresaId" AND id=NEW."estornoDeId";
    IF NOT FOUND OR original."estornoDeId" IS NOT NULL OR original."tituloId"<>NEW."tituloId" OR original."contaId"<>NEW."contaId" OR original.forma<>NEW.forma OR original.valor<>-NEW.valor THEN
      RAISE EXCEPTION 'Estorno incompatível com o lançamento original.';
    END IF;
  ELSE
    SELECT tipo INTO tipo_titulo FROM "TituloFinanceiro" WHERE "empresaId"=NEW."empresaId" AND id=NEW."tituloId";
    IF (tipo_titulo='RECEBER' AND NEW.valor<0) OR (tipo_titulo='PAGAR' AND NEW.valor>0) THEN RAISE EXCEPTION 'Sinal incompatível com o título financeiro.'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lancamento_financeiro_validar BEFORE INSERT ON "LancamentoFinanceiro" FOR EACH ROW EXECUTE FUNCTION validar_lancamento_financeiro();

-- Conta inicial sem saldo inventado. Empresas criadas posteriormente podem cadastrar suas contas pelo painel.
INSERT INTO "ContaFinanceira" (id,"empresaId",nome,"nomeChave",tipo,"updatedAt")
SELECT 'caixa-'||id,id,'Caixa da loja','caixa da loja','CAIXA',NOW() FROM "Empresa";
