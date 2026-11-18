-- CreateEnum
CREATE TYPE "TipoMovimentoEstoque" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'ESTORNO');

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fornecedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "validade" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentoEstoque" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "loteId" TEXT,
    "tipo" "TipoMovimentoEstoque" NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "motivo" TEXT NOT NULL,
    "chaveOperacao" TEXT NOT NULL,
    "estornoDeId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cliente_empresaId_ativo_nome_idx" ON "Cliente"("empresaId", "ativo", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_empresaId_id_key" ON "Cliente"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_empresaId_cpfCnpj_key" ON "Cliente"("empresaId", "cpfCnpj");

-- CreateIndex
CREATE INDEX "Fornecedor_empresaId_ativo_nome_idx" ON "Fornecedor"("empresaId", "ativo", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_empresaId_id_key" ON "Fornecedor"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_empresaId_cpfCnpj_key" ON "Fornecedor"("empresaId", "cpfCnpj");

-- CreateIndex
CREATE INDEX "Lote_empresaId_validade_idx" ON "Lote"("empresaId", "validade");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_empresaId_produtoId_id_key" ON "Lote"("empresaId", "produtoId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_empresaId_produtoId_numero_key" ON "Lote"("empresaId", "produtoId", "numero");

-- CreateIndex
CREATE INDEX "MovimentoEstoque_empresaId_produtoId_loteId_createdAt_idx" ON "MovimentoEstoque"("empresaId", "produtoId", "loteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MovimentoEstoque_empresaId_produtoId_id_key" ON "MovimentoEstoque"("empresaId", "produtoId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MovimentoEstoque_empresaId_chaveOperacao_key" ON "MovimentoEstoque"("empresaId", "chaveOperacao");

-- CreateIndex
CREATE UNIQUE INDEX "MovimentoEstoque_empresaId_estornoDeId_key" ON "MovimentoEstoque"("empresaId", "estornoDeId");

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_empresaId_produtoId_loteId_fkey" FOREIGN KEY ("empresaId", "produtoId", "loteId") REFERENCES "Lote"("empresaId", "produtoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_empresaId_produtoId_estornoDeId_fkey" FOREIGN KEY ("empresaId", "produtoId", "estornoDeId") REFERENCES "MovimentoEstoque"("empresaId", "produtoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_quantidade_check"
CHECK (quantidade <> 0 AND
  ((tipo = 'ENTRADA' AND quantidade > 0) OR
   (tipo = 'SAIDA' AND quantidade < 0) OR tipo IN ('AJUSTE', 'ESTORNO')));
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_estorno_check"
CHECK ((tipo = 'ESTORNO') = ("estornoDeId" IS NOT NULL));
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_motivo_check"
CHECK (length(trim(motivo)) BETWEEN 3 AND 500);

CREATE FUNCTION impedir_alteracao_movimento_estoque() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Movimentações de estoque são imutáveis; registre um estorno.';
END;
$$;
CREATE TRIGGER movimento_estoque_imutavel BEFORE UPDATE OR DELETE ON "MovimentoEstoque"
FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_movimento_estoque();
