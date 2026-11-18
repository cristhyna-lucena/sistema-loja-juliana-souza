-- CreateTable
CREATE TABLE "Sessao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sessao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sessao_tokenHash_key" ON "Sessao"("tokenHash");

-- CreateIndex
CREATE INDEX "Sessao_empresaId_usuarioId_idx" ON "Sessao"("empresaId", "usuarioId");

-- CreateIndex
CREATE INDEX "Sessao_expiresAt_idx" ON "Sessao"("expiresAt");

-- AddForeignKey
ALTER TABLE "Sessao" ADD CONSTRAINT "Sessao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessao" ADD CONSTRAINT "Sessao_empresaId_usuarioId_fkey" FOREIGN KEY ("empresaId", "usuarioId") REFERENCES "Usuario"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
