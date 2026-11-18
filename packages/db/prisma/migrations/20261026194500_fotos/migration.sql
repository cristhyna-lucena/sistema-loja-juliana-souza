BEGIN;

-- CreateEnum
CREATE TYPE "StatusImagem" AS ENUM ('AGUARDANDO_UPLOAD', 'PROCESSANDO', 'PRONTA', 'ERRO');

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "galeriaVersao" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ProdutoImagem" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "status" "StatusImagem" NOT NULL DEFAULT 'AGUARDANDO_UPLOAD',
    "hash" TEXT,
    "larguraOrig" INTEGER,
    "alturaOrig" INTEGER,
    "blurDataUrl" TEXT,
    "mensagem" TEXT,
    "tentativaId" TEXT NOT NULL,
    "uploadKey" TEXT NOT NULL,
    "tamanhoEsperado" INTEGER NOT NULL,
    "tipoInformado" TEXT NOT NULL,
    "altPendente" TEXT,
    "etagUpload" TEXT,
    "uploadLimpoEm" TIMESTAMPTZ(3),
    "prefixoAtual" TEXT,
    "formatos" JSONB,
    "removidaEm" TIMESTAMPTZ(3),
    "limpezaIniciadaEm" TIMESTAMPTZ(3),
    "arquivosRemovidosEm" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "tentativaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProdutoImagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagemLimpeza" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "imagemId" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "excluirApos" TIMESTAMPTZ(3) NOT NULL,
    "concluidaEm" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagemLimpeza_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProdutoImagem_empresaId_produtoId_removidaEm_ordem_idx" ON "ProdutoImagem"("empresaId", "produtoId", "removidaEm", "ordem");

-- CreateIndex
CREATE INDEX "ProdutoImagem_status_updatedAt_idx" ON "ProdutoImagem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ProdutoImagem_removidaEm_arquivosRemovidosEm_idx" ON "ProdutoImagem"("removidaEm", "arquivosRemovidosEm");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoImagem_empresaId_id_key" ON "ProdutoImagem"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ImagemLimpeza_prefixo_key" ON "ImagemLimpeza"("prefixo");

-- CreateIndex
CREATE INDEX "ImagemLimpeza_excluirApos_concluidaEm_idx" ON "ImagemLimpeza"("excluirApos", "concluidaEm");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_empresaId_id_key" ON "Produto"("empresaId", "id");

-- AddForeignKey
ALTER TABLE "ProdutoImagem" ADD CONSTRAINT "ProdutoImagem_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoImagem" ADD CONSTRAINT "ProdutoImagem_empresaId_produtoId_fkey" FOREIGN KEY ("empresaId", "produtoId") REFERENCES "Produto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagemLimpeza" ADD CONSTRAINT "ImagemLimpeza_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagemLimpeza" ADD CONSTRAINT "ImagemLimpeza_empresaId_imagemId_fkey" FOREIGN KEY ("empresaId", "imagemId") REFERENCES "ProdutoImagem"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProdutoImagem" ADD CONSTRAINT "ProdutoImagem_tamanho_valido" CHECK ("tamanhoEsperado" > 0 AND "tamanhoEsperado" <= 15728640);
ALTER TABLE "ProdutoImagem" ADD CONSTRAINT "ProdutoImagem_ordem_valida" CHECK ("ordem" >= 0);
COMMIT;
