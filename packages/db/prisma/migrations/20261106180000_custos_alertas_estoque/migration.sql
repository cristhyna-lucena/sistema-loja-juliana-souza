ALTER TABLE "Produto"
  ADD COLUMN "custoCompra" DECIMAL(12,4),
  ADD COLUMN "estoqueMinimo" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN "custoMedio" DECIMAL(12,4) DEFAULT 0,
  ADD COLUMN "valorEstoque" DECIMAL(28,7) DEFAULT 0;

ALTER TABLE "MovimentoEstoque"
  ADD COLUMN "custoUnitario" DECIMAL(12,4),
  ADD COLUMN "valorMovimento" DECIMAL(28,7);

-- Movimentos antigos são imutáveis. Saldo anterior sem custo não recebe avaliação fictícia.
UPDATE "Produto" p SET "custoMedio" = NULL, "valorEstoque" = NULL
WHERE EXISTS (
  SELECT 1 FROM "MovimentoEstoque" m
  WHERE m."empresaId" = p."empresaId" AND m."produtoId" = p.id
  GROUP BY m."produtoId" HAVING SUM(m.quantidade) <> 0
);

ALTER TABLE "Produto" ADD CONSTRAINT "Produto_custos_check" CHECK (
  ("custoCompra" IS NULL OR "custoCompra" >= 0) AND "estoqueMinimo" >= 0 AND
  ("custoMedio" IS NULL OR "custoMedio" >= 0) AND
  ("valorEstoque" IS NULL OR "valorEstoque" >= 0) AND
  (("custoMedio" IS NULL) = ("valorEstoque" IS NULL))
);
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_custo_check" CHECK (
  ("custoUnitario" IS NULL OR "custoUnitario" >= 0) AND
  ("valorMovimento" IS NULL OR "valorMovimento" = 0 OR
   ("valorMovimento" > 0 AND quantidade > 0) OR ("valorMovimento" < 0 AND quantidade < 0))
);
