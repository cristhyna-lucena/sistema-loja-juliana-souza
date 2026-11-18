ALTER TABLE "Venda" ADD COLUMN "frete" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Compra" ADD COLUMN "despesas" DECIMAL(12,2) NOT NULL DEFAULT 0, ADD COLUMN "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PedidoOnline" ADD COLUMN "envio" JSONB;
ALTER TABLE "Servico" ADD COLUMN "codigoListaServico" TEXT, ADD COLUMN "aliquotaIss" DECIMAL(7,4), ADD COLUMN "publicadoLoja" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ContaCliente" ADD COLUMN "recuperacaoHash" TEXT, ADD COLUMN "recuperacaoAte" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "ContaCliente_recuperacaoHash_key" ON "ContaCliente"("recuperacaoHash");
ALTER TABLE "ProdutoComplemento" ADD COLUMN "cstIbsCbs" TEXT, ADD COLUMN "classificacaoIbsCbs" TEXT, ADD COLUMN "aliquotaIbsMunicipal" DECIMAL(7,4), ADD COLUMN "cfopInterestadual" TEXT, ADD COLUMN "cstPis" TEXT, ADD COLUMN "cstCofins" TEXT, ADD COLUMN "aliquotaPis" DECIMAL(7,4), ADD COLUMN "aliquotaCofins" DECIMAL(7,4);
ALTER TABLE "Venda" DROP CONSTRAINT "Venda_valores_check";
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_valores_check" CHECK (subtotal > 0 AND desconto >= 0 AND frete >= 0 AND total > 0 AND total = subtotal - desconto + frete);

ALTER TABLE "WebhookEvento" ADD COLUMN "tentativas" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "proximaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "erro" TEXT;
