import { ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@sistema/db";
import type { Identity } from "../auth/auth.service";
import { DatabaseService } from "../database.service";
export const Dinheiro = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
export function ratearValor(valor: Prisma.Decimal, pesos: Prisma.Decimal[]) {
  const total = new Dinheiro(valor.toString()), base = pesos.reduce((sum, peso) => sum.plus(peso), new Dinheiro(0));
  const parcelas = pesos.map(peso => total.times(peso).div(base).toDecimalPlaces(2, Dinheiro.ROUND_DOWN));
  let resto = total.minus(parcelas.reduce((sum, parcela) => sum.plus(parcela), new Dinheiro(0)));
  for (let index = 0; resto.greaterThan(0); index++) { parcelas[index] = parcelas[index].plus("0.01"); resto = resto.minus("0.01"); }
  return parcelas;
}
@Injectable()
export class ComercialService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async auditar(tx: Prisma.TransactionClient, user: Identity, entidade: string, id: string, acao: string, dados: Prisma.InputJsonObject) {
    await tx.auditLog.create({ data: { empresaId: user.empresaId, usuarioId: user.id || null, entidade, entidadeId: id, acao, dados } });
  }
  async executar<T>(user: Identity, acao: string, input: { chaveOperacao: string }, criar: (tx: Prisma.TransactionClient) => Promise<string>, ler: (tx: Prisma.TransactionClient, id: string) => Promise<T>): Promise<T> {
    const hash = createHash("sha256").update(acao + "\n" + JSON.stringify(input)).digest("hex");
    try { return await this.db.client.$transaction(async tx => {
      // Serializa apenas operações comerciais da empresa; estoque manual continua com suas travas por produto.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'comercial:' + user.empresaId}, 0))`;
      const anterior = await tx.operacaoComercial.findUnique({ where: { empresaId_chave: { empresaId: user.empresaId, chave: input.chaveOperacao } } });
      if (anterior) {
        if (anterior.acao !== acao || anterior.hash !== hash) throw new ConflictException("Chave de operação já utilizada com outros dados.");
        return ler(tx, anterior.resultadoId);
      }
      const id = await criar(tx);
      await tx.operacaoComercial.create({ data: { empresaId: user.empresaId, chave: input.chaveOperacao, hash, acao, resultadoId: id } });
      return ler(tx, id);
    }, { timeout: 30000, maxWait: 10000 }); } catch (error) {
      if ((error as { code?: string })?.code === "P2002") throw new ConflictException("Já existe um cadastro com esses dados ou a chave de operação já foi utilizada.");
      if ((error as { code?: string })?.code === "P2028") throw new ServiceUnavailableException("A operação demorou mais que o esperado. Confira o resultado e tente novamente com os mesmos dados.");
      throw error;
    }
  }
}
