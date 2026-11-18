import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@sistema/db";
import { startIntegrationWorker } from "@sistema/integracoes";
import {
  compraSchema,
  servicoSchema,
  checkoutSchema,
  checkoutServicoSchema,
  vendaSchema,
} from "@sistema/shared";
import { ComercialService } from "../dist/comercial/comercial.service.js";
import { FinanceiroService } from "../dist/comercial/financeiro.service.js";
import { VendasService } from "../dist/comercial/vendas.service.js";
import { EstoqueService } from "../dist/gestao/estoque.service.js";
import { ComprasService } from "../dist/operacoes/compras.service.js";
import { ServicosService } from "../dist/operacoes/servicos.service.js";
import { FinanceiroExtraService } from "../dist/operacoes/financeiro-extra.service.js";
import { AdministracaoService } from "../dist/operacoes/administracao.service.js";
import { LojaService } from "../dist/loja/loja.service.js";
import { dataLoja } from "../dist/gestao/data-loja.js";
import { FiscalService } from "../dist/operacoes/fiscal.service.js";
import { PedidosService } from "../dist/operacoes/pedidos.service.js";
import { RelatoriosService } from "../dist/operacoes/relatorios.service.js";

loadEnvFile(new URL("../../../.env", import.meta.url));
const local = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(local.hostname));
const name = "sistema_loja_test_operacoes_" + randomBytes(8).toString("hex");
const url = new URL(local);
url.pathname = "/" + name;
const root = createDatabase(local.toString()),
  db = createDatabase(url.toString());
const chave = () => ({ chaveOperacao: randomUUID() });
const hoje = dataLoja();

test(
  "Compras, serviços, financeiro e checkout preservam transações e histórico",
  { timeout: 180000 },
  async (t) => {
    let created = false;
    const previousCompany = process.env.EMPRESA_ID,
      previousToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    try {
      await root.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
      created = true;
      const requireDb = createRequire(
        new URL("../../../packages/db/package.json", import.meta.url),
      );
      execFileSync(
        process.execPath,
        [requireDb.resolve("prisma/build/index.js"), "migrate", "deploy"],
        {
          cwd: new URL("../../../packages/db/", import.meta.url),
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: "pipe",
          timeout: 60000,
        },
      );
      const empresa = await db.empresa.create({
        data: { nome: "Operações QA", cnpj: "11222333000181" },
      });
      process.env.EMPRESA_ID = empresa.id;
      process.env.MERCADO_PAGO_ACCESS_TOKEN =
        "credencial-ficticia-sem-chamadas-externas";
      const usuario = await db.usuario.create({
        data: {
          empresaId: empresa.id,
          nome: "Administrador QA",
          email: "qa@example.invalid",
          senhaHash: "inutilizada",
          perfil: "ADMIN",
        },
      });
      const user = {
        id: usuario.id,
        empresaId: empresa.id,
        nome: usuario.nome,
        perfil: "ADMIN",
      };
      const database = { client: db },
        comercial = new ComercialService(database),
        financeiro = new FinanceiroService(database, comercial),
        estoque = new EstoqueService(database);
      const compras = new ComprasService(
          database,
          comercial,
          estoque,
          financeiro,
        ),
        servicos = new ServicosService(
          database,
          comercial,
          estoque,
          financeiro,
        ),
        extra = new FinanceiroExtraService(database, comercial, financeiro);
      const administracao = new AdministracaoService(database, comercial),
        vendas = new VendasService(database, comercial, estoque, financeiro);
      const fiscal = new FiscalService(database, comercial);
      const loja = new LojaService(
        database,
        { limitar: async () => {} },
        estoque,
        comercial,
        vendas,
        servicos,
        financeiro,
        fiscal,
      );
      const pedidos = new PedidosService(database, comercial, vendas, servicos);
      const fornecedor = await db.fornecedor.create({
        data: {
          empresaId: empresa.id,
          nome: "Fornecedor QA",
          cpfCnpj: "11444777000161",
        },
      });
      const cliente = await db.cliente.create({
        data: {
          empresaId: empresa.id,
          nome: "Cliente QA",
          cpfCnpj: "52998224725",
          email: "cliente@example.invalid",
        },
      });
      const produto = await db.produto.create({
        data: {
          empresaId: empresa.id,
          nome: "Creme QA",
          sku: "CREME-QA",
          unidade: "UN",
          tipo: "AMBOS",
          precoVenda: "20.00",
        },
      });
      const caixa = await db.contaFinanceira.create({
        data: {
          empresaId: empresa.id,
          nome: "Caixa QA",
          nomeChave: "caixa qa",
          tipo: "CAIXA",
        },
      });
      const banco = await db.contaFinanceira.create({
        data: {
          empresaId: empresa.id,
          nome: "Banco QA",
          nomeChave: "banco qa",
          tipo: "BANCO",
        },
      });
      await db.configuracaoEmpresa.create({
        data: {
          empresaId: empresa.id,
          contaOnlineId: banco.id,
          freteGratisAtivo: true,
          integracoes: {
            mercadoPago: true,
            asaas: false,
            pagarme: false,
            focus: false,
          },
        },
      });
      await db.produtoComplemento.create({
        data: {
          empresaId: empresa.id,
          produtoId: produto.id,
          slug: "creme-qa",
          publicadoLoja: true,
        },
      });
      let compra;
      const inputCompra = compraSchema.parse({
        ...chave(),
        fornecedorId: fornecedor.id,
        numero: "COMPRA-1",
        emitidaEm: hoje,
        itens: [
          {
            produtoId: produto.id,
            codigoFornecedor: "CX",
            quantidade: "2",
            fatorConversao: "5",
            custoUnitario: "25",
            lote: { numero: "L1", validade: "2030-01-01" },
          },
        ],
        parcelas: [
          { valor: "25", vencimento: hoje },
          { valor: "25", vencimento: "2030-01-01" },
        ],
      });
      await t.test(
        "Compra converte unidades, avalia estoque, gera parcelas e reenvia sem duplicação",
        async () => {
          compra = await compras.criar(user, inputCompra);
          assert.equal(compra.total, "50.00");
          assert.equal(compra.titulos.length, 2);
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "10.000",
          );
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).custoMedio,
            "5.0000",
          );
          assert.equal((await compras.criar(user, inputCompra)).id, compra.id);
          assert.equal(
            await db.movimentoEstoque.count({ where: { origemId: compra.id } }),
            1,
          );
          await assert.rejects(
            compras.criar(user, { ...inputCompra, numero: "outro" }),
            /Chave/,
          );
          const movimento = await db.movimentoEstoque.findFirstOrThrow({
            where: { origemId: compra.id },
          });
          await assert.rejects(
            estoque.estornar(user, produto.id, movimento.id, {
              ...chave(),
              motivo: "Correção indevida",
            }),
            /origem/,
          );
        },
      );
      await t.test(
        "Compra inválida desfaz todos os itens e a auditoria",
        async () => {
          const antes = await db.movimentoEstoque.count();
          await assert.rejects(
            compras.criar(user, {
              ...inputCompra,
              ...chave(),
              numero: "COMPRA-INVALIDA",
              itens: [
                ...inputCompra.itens,
                { ...inputCompra.itens[0], produtoId: "inexistente" },
              ],
              parcelas: [{ valor: "100.00", vencimento: hoje }],
            }),
          );
          assert.equal(await db.movimentoEstoque.count(), antes);
          assert.equal(
            await db.compra.count({ where: { numero: "COMPRA-INVALIDA" } }),
            0,
          );
        },
      );
      await t.test(
        "Atendimento congela a ficha, consome uma vez e cancela com estornos",
        async () => {
          const ficha = servicoSchema.parse({
            ...chave(),
            nome: "Hidratação QA",
            preco: "60",
            duracaoMin: 45,
            insumos: [{ produtoId: produto.id, quantidade: "2" }],
          });
          const servico = await servicos.salvar(user, ficha);
          const voucher = await servicos.vender(user, {
            ...chave(),
            servicoId: servico.id,
            clienteId: cliente.id,
            vencimento: hoje,
          });
          await servicos.salvar(
            user,
            {
              ...ficha,
              ...chave(),
              insumos: [{ produtoId: produto.id, quantidade: "9" }],
            },
            servico.id,
            servico.versao,
          );
          const uso = { ...chave(), motivo: "Atendimento realizado" };
          await servicos.usar(user, voucher.id, uso);
          await servicos.usar(user, voucher.id, uso);
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "8.000",
          );
          await assert.rejects(
            servicos.usar(user, voucher.id, {
              ...chave(),
              motivo: "Repetição de atendimento",
            }),
            /Voucher/,
          );
          await servicos.cancelar(user, voucher.id, {
            ...chave(),
            motivo: "Atendimento registrado por engano",
          });
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "10.000",
          );
        },
      );
      await t.test(
        "Transferências preservam o total e estornam os dois lados",
        async () => {
          const transferencia = {
            ...chave(),
            origemId: caixa.id,
            destinoId: banco.id,
            valor: "15.00",
            data: hoje,
            motivo: "Depósito do caixa",
          };
          const rows = await extra.transferir(user, transferencia);
          await extra.transferir(user, transferencia);
          const saldo = await financeiro.contas(empresa.id);
          assert.equal(
            saldo.find((conta) => conta.id === caixa.id).saldo,
            "-15.00",
          );
          assert.equal(
            saldo.find((conta) => conta.id === banco.id).saldo,
            "15.00",
          );
          await extra.estornarTransferencia(user, rows[0].origemId, {
            ...chave(),
            motivo: "Depósito registrado por engano",
          });
          assert.ok(
            (await financeiro.contas(empresa.id)).every(
              (conta) => conta.saldo === "0.00",
            ),
          );
        },
      );
      await t.test(
        "Taxa de recebimento acompanha a baixa e seu estorno",
        async () => {
          const titulo = await financeiro.criarTitulo(user, {
            ...chave(),
            tipo: "RECEBER",
            descricao: "Receita QA",
            valor: "100.00",
            vencimento: hoje,
            clienteId: cliente.id,
            fornecedorId: null,
          });
          const baixa = await financeiro.baixar(user, titulo.id, {
            ...chave(),
            contaId: banco.id,
            forma: "CARTAO_CREDITO",
            valor: "100.00",
            taxa: "3.00",
            data: hoje,
          });
          assert.equal(
            (await financeiro.contas(empresa.id)).find(
              (conta) => conta.id === banco.id,
            ).saldo,
            "97.00",
          );
          await financeiro.estornar(user, baixa.id, {
            ...chave(),
            motivo: "Recebimento cancelado",
          });
          assert.equal(
            (await financeiro.contas(empresa.id)).find(
              (conta) => conta.id === banco.id,
            ).saldo,
            "0.00",
          );
        },
      );
      await t.test(
        "Conciliação altera apenas metadados e mantém lançamentos imutáveis",
        async () => {
          const titulo = await financeiro.criarTitulo(user, {
            ...chave(),
            tipo: "RECEBER",
            descricao: "Conciliação QA",
            valor: "5.00",
            vencimento: hoje,
            clienteId: cliente.id,
            fornecedorId: null,
          });
          const baixa = await financeiro.baixar(user, titulo.id, {
            ...chave(),
            contaId: banco.id,
            forma: "PIX",
            valor: "5.00",
            data: hoje,
          });
          await extra.conciliar(user, baixa.id, {
            ...chave(),
            referenciaExterna: "EXTRATO-QA-1",
          });
          assert.ok(
            (
              await db.lancamentoFinanceiro.findUniqueOrThrow({
                where: { id: baixa.id },
              })
            ).conciliadoEm,
          );
          await assert.rejects(
            db.lancamentoFinanceiro.update({
              where: { id: baixa.id },
              data: { valor: "6" },
            }),
            /imutável/,
          );
        },
      );
      await t.test("Último administrador ativo é preservado", async () => {
        await assert.rejects(
          administracao.editarUsuario(user, user.id, {
            ...chave(),
            nome: user.nome,
            perfil: "OPERADOR",
            ativo: true,
          }),
          /administrador/,
        );
      });
      const sessao = {
        empresaId: empresa.id,
        clienteId: cliente.id,
        contaId: "teste-direto",
      };
      let pedido;
      await t.test(
        "Provedores podem ser configurados depois sem criar cobranças enquanto desativados",
        async () => {
          const config = await db.configuracaoEmpresa.findUniqueOrThrow({
            where: { empresaId: empresa.id },
          });
          try {
            await db.configuracaoEmpresa.update({
              where: { empresaId: empresa.id },
              data: {
                integracoes: {
                  mercadoPago: false,
                  asaas: false,
                  pagarme: false,
                  focus: false,
                },
              },
            });
            const publica = await loja.configuracao();
            assert.deepEqual(
              publica.gateways.map((provider) => provider.codigo),
              ["MERCADO_PAGO", "ASAAS", "PAGARME"],
            );
            assert.ok(
              publica.gateways.every((provider) => !provider.disponivel),
            );
            const antes = await db.pedidoOnline.count({
              where: { empresaId: empresa.id },
            });
            for (const gateway of publica.gateways.map(
              (provider) => provider.codigo,
            )) {
              await assert.rejects(
                () =>
                  loja.checkout(
                    sessao,
                    checkoutSchema.parse({
                      ...chave(),
                      itens: [{ produtoId: produto.id, quantidade: 1 }],
                      endereco: {
                        cep: "78000000",
                        logradouro: "Rua QA",
                        numero: "1",
                        bairro: "Centro",
                        cidade: "Cuiabá",
                        uf: "MT",
                        codigoIbge: "5103403",
                      },
                      gateway,
                      servicoFrete: "GRATIS",
                      cpfNaNota: false,
                      notaPorEmail: false,
                    }),
                  ),
                /precisa ser configurado/,
              );
            }
            assert.equal(
              await db.pedidoOnline.count({ where: { empresaId: empresa.id } }),
              antes,
            );
          } finally {
            await db.configuracaoEmpresa.update({
              where: { empresaId: empresa.id },
              data: { integracoes: config.integracoes },
            });
          }
        },
      );
      await t.test(
        "Checkout calcula total no servidor e serializa reservas concorrentes",
        async () => {
          const input = checkoutSchema.parse({
            ...chave(),
            itens: [{ produtoId: produto.id, quantidade: 7 }],
            endereco: {
              cep: "78000000",
              logradouro: "Rua QA",
              numero: "1",
              bairro: "Centro",
              cidade: "Cuiabá",
              uf: "MT",
              codigoIbge: "5103403",
            },
            gateway: "MERCADO_PAGO",
            servicoFrete: "GRATIS",
            cpfNaNota: true,
            notaPorEmail: true,
          });
          const results = await Promise.allSettled([
            loja.checkout(sessao, input),
            loja.checkout(sessao, { ...input, ...chave() }),
          ]);
          assert.equal(
            results.filter((result) => result.status === "fulfilled").length,
            1,
          );
          pedido = results.find(
            (result) => result.status === "fulfilled",
          ).value;
          assert.equal((await loja.pedido(sessao, pedido.id)).total, "140.00");
          assert.equal(
            await db.reservaEstoque.count({ where: { pedidoId: pedido.id } }),
            1,
          );
          await assert.rejects(
            estoque.movimentar(user, produto.id, {
              ...chave(),
              tipo: "SAIDA",
              quantidade: "4",
              loteId: (await db.lote.findFirstOrThrow()).id,
              motivo: "Saída com saldo reservado",
            }),
            /reservado/,
          );
        },
      );
      await t.test(
        "Confirmação duplicada gera uma venda e uma baixa de estoque",
        async () => {
          const pagamento = {
            id: "PAY-QA-1",
            referencia: pedido.id,
            pago: true,
            estornado: false,
            valor: "140.00",
            moeda: "BRL",
            forma: "PIX",
          };
          await Promise.all([
            loja.confirmarPagamento("MERCADO_PAGO", pagamento),
            loja.confirmarPagamento("MERCADO_PAGO", pagamento),
          ]);
          const atual = await db.pedidoOnline.findUniqueOrThrow({
            where: { id: pedido.id },
          });
          assert.equal(atual.status, "PAGO");
          assert.ok(atual.vendaId);
          assert.equal(await db.venda.count(), 1);
          assert.equal(
            await db.reservaEstoque.count({ where: { pedidoId: pedido.id } }),
            0,
          );
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "3.000",
          );
          await loja.confirmarPagamento("MERCADO_PAGO", {
            ...pagamento,
            id: "PAY-QA-DUPLICADO",
          });
          assert.equal(
            await db.integracaoJob.count({
              where: { tipo: "PAGAMENTO_REEMBOLSAR" },
            }),
            1,
          );
          assert.equal(await db.venda.count(), 1);
        },
      );
      await t.test(
        "Cancelamento da compra consumida desfaz a tentativa inteira",
        async () => {
          await assert.rejects(
            compras.cancelar(user, compra.id, {
              ...chave(),
              motivo: "Cancelamento com estoque já consumido",
            }),
            /Saldo insuficiente/,
          );
          assert.equal(
            (await db.compra.findUniqueOrThrow({ where: { id: compra.id } }))
              .status,
            "CONFIRMADA",
          );
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "3.000",
          );
        },
      );
      await t.test(
        "Parcelas da venda recebem por vencimento e cancelam todo o grupo",
        async () => {
          const venda = await vendas.criar(
            user,
            vendaSchema.parse({
              ...chave(),
              clienteId: cliente.id,
              itens: [
                { produtoId: produto.id, quantidade: "1", precoUnitario: "20" },
              ],
              vencimento: hoje,
              recebimento: { contaId: banco.id, forma: "PIX", valor: "5" },
            }),
          );
          const parcelada = await vendas.parcelar(user, venda.id, {
            ...chave(),
            parcelas: [
              { valor: "7.50", vencimento: hoje },
              { valor: "7.50", vencimento: "2030-01-01" },
            ],
          });
          assert.equal(parcelada.titulo.saldo, "15.00");
          assert.equal(parcelada.parcelas.length, 2);
          const paga = await vendas.receber(user, venda.id, {
            ...chave(),
            contaId: banco.id,
            forma: "PIX",
            valor: "10.00",
            data: hoje,
          });
          assert.equal(paga.titulo.valorPago, "15.00");
          assert.equal(paga.titulo.saldo, "5.00");
          assert.equal(paga.parcelas[0].saldo, "0.00");
          assert.equal(paga.parcelas[1].saldo, "5.00");
          const cancelada = await vendas.cancelar(user, venda.id, {
            ...chave(),
            motivo: "Cancelamento das parcelas da venda",
          });
          assert.equal(cancelada.status, "CANCELADA");
          assert.ok(
            cancelada.parcelas.every(
              (parcela) => parcela.status === "CANCELADO",
            ),
          );
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "3.000",
          );
        },
      );
      await t.test(
        "Voucher online congela preço e ficha, recebe uma vez e cancela atomicamente",
        async () => {
          const servico = await servicos.salvar(
            user,
            servicoSchema.parse({
              ...chave(),
              nome: "Serviço online QA",
              preco: "30",
              duracaoMin: 30,
              publicadoLoja: true,
              insumos: [{ produtoId: produto.id, quantidade: "1" }],
            }),
          );
          const input = checkoutServicoSchema.parse({
            ...chave(),
            servicoId: servico.id,
            quantidade: 2,
            gateway: "MERCADO_PAGO",
            notaPorEmail: false,
          });
          const pedidoServico = await loja.checkoutServico(
            sessao,
            input,
            "teste",
          );
          await servicos.salvar(
            user,
            servicoSchema.parse({
              ...chave(),
              nome: "Serviço alterado QA",
              preco: "99",
              duracaoMin: 30,
              publicadoLoja: true,
              insumos: [{ produtoId: produto.id, quantidade: "9" }],
            }),
            servico.id,
            servico.versao,
          );
          const pagamento = {
            id: "PAY-SERVICO-1",
            referencia: pedidoServico.id,
            pago: true,
            estornado: false,
            valor: "60.00",
            moeda: "BRL",
            forma: "PIX",
          };
          await loja.confirmarPagamento("MERCADO_PAGO", pagamento);
          await loja.confirmarPagamento("MERCADO_PAGO", pagamento);
          const atual = await db.pedidoOnline.findUniqueOrThrow({
            where: { id: pedidoServico.id },
          });
          assert.equal(atual.status, "PAGO");
          const ids = atual.itens[0].voucherIds;
          assert.equal(ids.length, 2);
          const vouchers = await db.voucher.findMany({
            where: { id: { in: ids } },
          });
          assert.ok(
            vouchers.every(
              (voucher) =>
                voucher.valor.toFixed(2) === "30.00" &&
                voucher.ficha[0].quantidade === "1.000",
            ),
          );
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "3.000",
          );
          await servicos.usar(user, ids[0], {
            ...chave(),
            motivo: "Atendimento do voucher online",
          });
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "2.000",
          );
          await pedidos.cancelar(user, pedidoServico.id, {
            ...chave(),
            motivo: "Registro da compra de serviços por engano",
          });
          assert.equal(
            (await estoque.consultarSaldo(empresa.id, produto.id)).saldo,
            "3.000",
          );
          assert.equal(
            await db.voucher.count({
              where: { id: { in: ids }, status: "CANCELADO" },
            }),
            2,
          );
          const publico = await loja.pedido(sessao, pedidoServico.id);
          assert.ok(publico.itens.every((item) => !("ficha" in item)));
          const reembolsavel = await loja.checkoutServico(
            sessao,
            {
              ...input,
              ...chave(),
              quantidade: 1,
            },
            "teste",
          );
          const segundoPagamento = {
            ...pagamento,
            id: "PAY-SERVICO-2",
            referencia: reembolsavel.id,
            valor: "99.00",
          };
          await loja.confirmarPagamento("MERCADO_PAGO", segundoPagamento);
          const antesReembolso = await db.pedidoOnline.findUniqueOrThrow({
            where: { id: reembolsavel.id },
          });
          const voucherReembolso = antesReembolso.itens[0].voucherIds[0];
          await loja.confirmarPagamento("MERCADO_PAGO", {
            ...segundoPagamento,
            pago: false,
            estornado: true,
          });
          await loja.confirmarPagamento("MERCADO_PAGO", {
            ...segundoPagamento,
            pago: false,
            estornado: true,
          });
          assert.equal(
            (
              await db.voucher.findUniqueOrThrow({
                where: { id: voucherReembolso },
              })
            ).status,
            "CANCELADO",
          );
          await assert.rejects(() =>
            servicos.usar(user, voucherReembolso, {
              ...chave(),
              motivo: "Tentativa após reembolso",
            }),
          );
          const tituloReembolso = await db.tituloFinanceiro.findFirstOrThrow({
            where: { origemTipo: "VOUCHER", origemId: voucherReembolso },
          });
          assert.ok(tituloReembolso.canceladoEm);
          assert.equal(
            (
              await db.lancamentoFinanceiro.aggregate({
                where: { tituloId: tituloReembolso.id },
                _sum: { valor: true },
              })
            )._sum.valor.toFixed(2),
            "0.00",
          );
        },
      );
      await t.test(
        "Relatórios agregam vendas, caixa e estoque com dados reais",
        async () => {
          const relatorios = new RelatoriosService(database);
          const resumo = await relatorios.resumo(empresa.id, {
            de: hoje,
            ate: hoje,
          });
          assert.equal(resumo.totalVendas, "140.00");
          assert.equal(resumo.quantidadeVendas, 1);
          assert.equal(resumo.custoVendido, "35.00");
          assert.equal(resumo.valorEstoque, "15.00");
          assert.equal(resumo.pedidosEnviar, 1);
        },
      );
      await t.test(
        "Fila fiscal guarda XML, fatura todos os vouchers e envia cada nota uma vez",
        async () => {
          const originalFetch = globalThis.fetch;
          const keys = ["FOCUS_TOKEN", "RESEND_API_KEY", "EMAIL_FROM"];
          const previous = Object.fromEntries(
            keys.map((key) => [key, process.env[key]]),
          );
          let worker;
          try {
            for (const key of keys)
              process.env[key] =
                key === "EMAIL_FROM"
                  ? "qa@example.invalid"
                  : "credencial-ficticia";
            await db.integracaoJob.updateMany({
              data: { status: "CONCLUIDO" },
            });
            const servico = await db.servico.findFirstOrThrow({
              where: { empresaId: empresa.id, publicadoLoja: true },
            });
            const pedido = await loja.checkoutServico(
              sessao,
              checkoutServicoSchema.parse({
                ...chave(),
                servicoId: servico.id,
                quantidade: 2,
                gateway: "MERCADO_PAGO",
                notaPorEmail: true,
              }),
              "teste",
            );
            await loja.confirmarPagamento("MERCADO_PAGO", {
              id: "PAY-FISCAL-QA",
              referencia: pedido.id,
              pago: true,
              estornado: false,
              valor: (
                await db.pedidoOnline.findUniqueOrThrow({
                  where: { id: pedido.id },
                })
              ).total.toFixed(2),
              moeda: "BRL",
              forma: "PIX",
            });
            await db.integracaoJob.updateMany({
              data: { status: "CONCLUIDO" },
            });
            const atual = await db.pedidoOnline.findUniqueOrThrow({
              where: { id: pedido.id },
            });
            const notas = [];
            for (const voucherId of atual.itens[0].voucherIds) {
              const nota = await db.notaEmitida.create({
                data: {
                  empresaId: empresa.id,
                  voucherId,
                  modelo: "NFSE",
                  payload: {},
                  status: "PROCESSANDO",
                },
              });
              notas.push(nota);
              await db.integracaoJob.create({
                data: {
                  empresaId: empresa.id,
                  tipo: "FOCUS_CONSULTAR",
                  referencia: nota.id,
                  payload: { notaId: nota.id },
                },
              });
            }
            const emails = [],
              arquivos = [];
            globalThis.fetch = async (url, options = {}) => {
              const endpoint = String(url);
              if (
                endpoint.startsWith(
                  "https://homologacao.focusnfe.com.br/v2/nfse/",
                )
              )
                return new Response(
                  JSON.stringify({
                    status: "autorizado",
                    caminho_xml_nota_fiscal:
                      "/arquivos/" + endpoint.split("/").at(-1) + ".xml",
                  }),
                  { headers: { "Content-Type": "application/json" } },
                );
              if (
                endpoint.startsWith(
                  "https://homologacao.focusnfe.com.br/arquivos/",
                )
              )
                return new Response("<nota>XML de teste</nota>", {
                  headers: { "Content-Type": "application/xml" },
                });
              if (endpoint === "https://api.resend.com/emails") {
                emails.push(JSON.parse(options.body));
                return new Response(JSON.stringify({ id: randomUUID() }), {
                  headers: { "Content-Type": "application/json" },
                });
              }
              throw new Error("Chamada externa inesperada: " + endpoint);
            };
            worker = startIntegrationWorker(db, {
              put: async (key, bytes, mime) =>
                arquivos.push({ key, bytes: bytes.toString(), mime }),
            });
            const deadline = Date.now() + 25000;
            while (Date.now() < deadline && emails.length < 2)
              await new Promise((resolve) => setTimeout(resolve, 200));
            await worker.close();
            worker = null;
            assert.equal(emails.length, 2);
            assert.equal(arquivos.length, 2);
            assert.ok(
              arquivos.every(
                (arquivo) =>
                  arquivo.mime === "application/xml" &&
                  arquivo.bytes.includes("XML de teste"),
              ),
            );
            assert.equal(
              (
                await db.pedidoOnline.findUniqueOrThrow({
                  where: { id: pedido.id },
                })
              ).status,
              "FATURADO",
            );
            assert.equal(
              await db.notaEmitida.count({
                where: {
                  id: { in: notas.map((nota) => nota.id) },
                  status: "AUTORIZADA",
                },
              }),
              2,
            );
            assert.ok(emails.every((email) => email.attachments.length === 1));
            assert.equal(
              await db.integracaoJob.count({
                where: {
                  tipo: "EMAIL",
                  referencia: { in: notas.map((nota) => "nota-" + nota.id) },
                  status: "CONCLUIDO",
                },
              }),
              2,
            );
          } finally {
            if (worker) await worker.close();
            globalThis.fetch = originalFetch;
            for (const key of keys)
              if (previous[key] === undefined) delete process.env[key];
              else process.env[key] = previous[key];
          }
        },
      );
    } finally {
      if (previousCompany === undefined) delete process.env.EMPRESA_ID;
      else process.env.EMPRESA_ID = previousCompany;
      if (previousToken === undefined)
        delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
      else process.env.MERCADO_PAGO_ACCESS_TOKEN = previousToken;
      await db.$disconnect();
      if (created)
        await root.$executeRawUnsafe(
          'DROP DATABASE "' + name + '" WITH (FORCE)',
        );
      await root.$disconnect();
    }
  },
);
