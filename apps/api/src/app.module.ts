import { Inject, Controller, Get, Module, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { AuthService } from "./auth/auth.service";
import { AuthGuard } from "./auth/auth.guard";
import { AccessController, AuthController } from "./auth/auth.controller";
import { CategoriasController, ProdutosController, CatalogoOriginGuard } from "./catalogo/catalogo.controller";
import { CatalogoService } from "./catalogo/catalogo.service";
import { FotosService } from "./fotos/fotos.service";
import { FotosController } from "./fotos/fotos.controller";
import { CadastrosService } from "./gestao/cadastros.service";
import { EstoqueService } from "./gestao/estoque.service";
import { ClientesController, FornecedoresController, EstoqueController, AlertasEstoqueController } from "./gestao/gestao.controller";
import { AlertasEstoqueService } from "./gestao/alertas-estoque.service";
import { ComercialService } from "./comercial/comercial.service";
import { VendasService } from "./comercial/vendas.service";
import { FinanceiroService } from "./comercial/financeiro.service";
import { VendasController, FinanceiroController } from "./comercial/comercial.controller";
import { FinanceiroExtraService } from "./operacoes/financeiro-extra.service";
import { AdministracaoService } from "./operacoes/administracao.service";
import { FiscalService } from "./operacoes/fiscal.service";
import { LojaService } from "./loja/loja.service";
import { LojaController, LojaOriginGuard, PagamentoWebhookController, FocusWebhookController } from "./loja/loja.controller";
import { RelatoriosService } from "./operacoes/relatorios.service";
import { PedidosService } from "./operacoes/pedidos.service";
import { ComprasService } from "./operacoes/compras.service";
import { ServicosService } from "./operacoes/servicos.service";
import { ComprasController, ServicosController, VouchersController, FinanceiroExtraController, AdministracaoController, FiscalController, RelatoriosController, PedidosController } from "./operacoes/operacoes.controller";
@Controller()
class HealthController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  @Get("health")
  health() { return { status: "ok", service: "api" }; }
  @Get("health/ready")
  async ready() {
    try { await this.db.client.$queryRaw`SELECT 1`; return { status: "ok", database: "ok" }; }
    catch { throw new ServiceUnavailableException("Banco temporariamente indisponível."); }
  }
}
@Module({ controllers: [HealthController, AuthController, AccessController, CategoriasController, ProdutosController, FotosController, ClientesController, FornecedoresController, EstoqueController, AlertasEstoqueController, VendasController, FinanceiroController, ComprasController, ServicosController, VouchersController, FinanceiroExtraController, AdministracaoController, FiscalController, RelatoriosController, PedidosController, LojaController, PagamentoWebhookController, FocusWebhookController], providers: [DatabaseService, AuthService, AuthGuard, CatalogoService, CatalogoOriginGuard, FotosService, CadastrosService, EstoqueService, AlertasEstoqueService, ComercialService, VendasService, FinanceiroService, ComprasService, ServicosService, FinanceiroExtraService, AdministracaoService, FiscalService, RelatoriosService, PedidosService, LojaService, LojaOriginGuard] })
export class AppModule {}
