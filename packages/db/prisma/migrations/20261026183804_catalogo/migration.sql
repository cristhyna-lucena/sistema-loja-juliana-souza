BEGIN;

-- CreateEnum
CREATE TYPE "TipoProduto" AS ENUM ('REVENDA', 'INSUMO', 'AMBOS');

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeChave" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "sku" TEXT NOT NULL,
    "tipo" "TipoProduto" NOT NULL DEFAULT 'REVENDA',
    "unidade" TEXT NOT NULL,
    "precoVenda" DECIMAL(12,2) NOT NULL,
    "categoriaId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_empresaId_id_key" ON "Categoria"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_empresaId_nomeChave_key" ON "Categoria"("empresaId", "nomeChave");

-- CreateIndex
CREATE INDEX "Produto_empresaId_ativo_nome_idx" ON "Produto"("empresaId", "ativo", "nome");

-- CreateIndex
CREATE INDEX "Produto_empresaId_categoriaId_idx" ON "Produto"("empresaId", "categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_empresaId_sku_key" ON "Produto"("empresaId", "sku");

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_empresaId_categoriaId_fkey" FOREIGN KEY ("empresaId", "categoriaId") REFERENCES "Categoria"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Produto" ADD CONSTRAINT "Produto_precoVenda_nao_negativo" CHECK ("precoVenda" >= 0);

COMMIT;
