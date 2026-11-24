-- Busca gratuita das notas recebidas direto na SEFAZ: guarda o último NSU lido por empresa.
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "ultimoNsuDfe" BIGINT NOT NULL DEFAULT 0;
