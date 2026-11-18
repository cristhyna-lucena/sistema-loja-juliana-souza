import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes,randomUUID,createHash } from "node:crypto";
import { spawn,execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@sistema/db";
import { dataLoja,somarDias } from "../dist/gestao/data-loja.js";
import { ComercialService } from "../dist/comercial/comercial.service.js";
import { FinanceiroService } from "../dist/comercial/financeiro.service.js";
import { VendasService } from "../dist/comercial/vendas.service.js";
import { EstoqueService } from "../dist/gestao/estoque.service.js";
import { vendaSchema } from "@sistema/shared";
loadEnvFile(new URL("../../../.env",import.meta.url));
const local=new URL(process.env.DATABASE_URL);assert.ok(["127.0.0.1","localhost"].includes(local.hostname)&&local.pathname==="/sistema_loja");
const name="sistema_loja_test_comercial_"+randomBytes(8).toString("hex"),url=new URL(local);url.pathname="/"+name;
const root=createDatabase(local.toString()),db=createDatabase(url.toString());
const base="http://127.0.0.1:43177",origin="http://127.0.0.1:43179",cookies={},users={};
let serverLogs="";
const request=(path,{method="GET",body,cookie=cookies.ADMIN,originHeader=origin}={})=>fetch(base+path,{method,headers:{cookie:cookie??"",origin:originHeader,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function json(path,options={},status=201){const r=await request(path,options);const result=await r.json();if(r.status>=500)console.error(serverLogs.slice(-10000));assert.equal(r.status,status,JSON.stringify(result));return result;}
const post=(path,body,status=201,extra={})=>json(path,{method:"POST",body,...extra},status);
const chave=()=>({chaveOperacao:randomUUID()});
const hoje=dataLoja();
async function stop(child){if(child&&child.exitCode===null){const done=once(child,"exit");child.kill();await done;}}
async function ready(child,url,logs){const end=Date.now()+45000;while(Date.now()<end){if(child.exitCode!==null)assert.fail(logs());try{if((await fetch(url,{signal:AbortSignal.timeout(1500)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}assert.fail(logs());}
test("Vendas e financeiro: transações reais, concorrência e navegador isolado",{timeout:360000},async t=>{
  let created=false,server;
  try{
    await root.$executeRawUnsafe('CREATE DATABASE "'+name+'"');created=true;
    const requireDb=createRequire(new URL("../../../packages/db/package.json",import.meta.url));
    execFileSync(process.execPath,[requireDb.resolve("prisma/build/index.js"),"migrate","deploy"],{cwd:new URL("../../../packages/db/",import.meta.url),env:{...process.env,DATABASE_URL:url.toString()},stdio:"pipe",timeout:60000});
    const empresa=await db.empresa.create({data:{nome:"Comercial QA"}}),externa=await db.empresa.create({data:{nome:"Outra empresa QA"}});
    for(const perfil of ["ADMIN","OPERADOR","CONTADORA"]){users[perfil]=await db.usuario.create({data:{empresaId:empresa.id,nome:"Teste "+perfil,email:perfil+"@example.invalid",senhaHash:"nao-utilizada",perfil}});const token=randomBytes(32).toString("base64url");await db.sessao.create({data:{empresaId:empresa.id,usuarioId:users[perfil].id,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+3600000)}});cookies[perfil]="loja_session="+token;}
    server=spawn(process.execPath,["dist/main.js"],{env:{...process.env,DATABASE_URL:url.toString(),API_PORT:"43177",EMPRESA_ID:empresa.id,ADMIN_ORIGIN:origin,AUTH_REDIS_PREFIX:"test-comercial:"+randomUUID(),NODE_ENV:"test"},stdio:["ignore","pipe","pipe"]});server.stdout.on("data",v=>serverLogs+=v);server.stderr.on("data",v=>serverLogs+=v);await ready(server,base+"/health/ready",()=>serverLogs);
    const conta=await post("/financeiro/contas",{nome:"Caixa QA",tipo:"CAIXA",...chave()});
    const banco=await post("/financeiro/contas",{nome:"Banco QA",tipo:"BANCO",...chave()});
    const cliente=await db.cliente.create({data:{empresaId:empresa.id,nome:"Cliente Comercial QA"}}),fornecedor=await db.fornecedor.create({data:{empresaId:empresa.id,nome:"Fornecedor QA",cpfCnpj:"11222333000181"}});
    const contaExterna=await db.contaFinanceira.create({data:{empresaId:externa.id,nome:"Externa",nomeChave:"externa",tipo:"CAIXA"}}),clienteExterno=await db.cliente.create({data:{empresaId:externa.id,nome:"Externo"}});
    const produto=async(sku,extra={})=>db.produto.create({data:{empresaId:empresa.id,nome:sku,sku,unidade:"UN",precoVenda:"10.00",custoCompra:"4",...extra}});
    const entrada=async(p,quantidade,loteId=null,custoUnitario="4")=>post("/estoque/produtos/"+p.id+"/movimentos",{tipo:"ENTRADA",quantidade,loteId,custoUnitario,motivo:"Entrada para teste comercial",...chave()});
    const vendaBody=(p,quantidade="1",extra={})=>({itens:[{produtoId:p.id,quantidade,precoUnitario:p.precoVenda.toFixed(2)}],recebimento:{contaId:conta.id,forma:"PIX",valor:(Number(quantidade)*Number(p.precoVenda)).toFixed(2)},...chave(),...extra});
    await t.test("Permissões, origem, isolamento e opções sem saldos para operador",async()=>{
      for(const path of ["/vendas","/financeiro/contas","/financeiro/titulos","/financeiro/caixa"])assert.equal((await request(path,{cookie:""})).status,401);
      assert.equal((await request("/vendas",{cookie:cookies.CONTADORA})).status,403);
      for(const path of ["/financeiro/contas","/financeiro/titulos","/financeiro/caixa","/financeiro/contatos?tipo=PAGAR"])assert.equal((await request(path,{cookie:cookies.OPERADOR})).status,403);
      const opcoes=await json("/financeiro/contas/opcoes",{cookie:cookies.OPERADOR},200);assert.ok(opcoes.length===2&&opcoes.every(c=>!("saldo"in c)));
      await post("/financeiro/contas",{nome:"Negada",tipo:"CAIXA",...chave()},403,{cookie:cookies.CONTADORA});
      await post("/financeiro/contas",{nome:"Negada",tipo:"CAIXA",...chave()},403,{originHeader:"https://externo.invalid"});
      await post("/financeiro/contas",{nome:" caixa   qa ",tipo:"CAIXA",...chave()},409);
      assert.equal((await request("/financeiro/caixa?contaId="+contaExterna.id)).status,404);
      assert.equal((await request("/vendas?empresaId="+externa.id)).status,400);
      const contatos=await json("/financeiro/contatos?tipo=PAGAR",{cookie:cookies.CONTADORA},200);assert.deepEqual(contatos,[{id:fornecedor.id,nome:fornecedor.nome}]);
    });
    let vendaCompleta;
    await t.test("Venda parcial, FEFO sem vencidos, recebimentos concorrentes, caixa e cancelamento",async()=>{
      const p=await produto("PRODUTO-FEFO",{precoVenda:"19.90"});
      const lote=async(numero,validade)=>post("/estoque/produtos/"+p.id+"/lotes",{numero,validade});
      const vencido=await lote("VENCIDO",somarDias(hoje,-1)),primeiro=await lote("PRIMEIRO",hoje),ultimo=await lote("ULTIMO",somarDias(hoje,30));
      await entrada(p,"50",vencido.id,"9");await entrada(p,"2",primeiro.id,"10");await entrada(p,"4",ultimo.id,"20");await entrada(p,"3",null,"10");
      const antes=await db.produto.findUniqueOrThrow({where:{id:p.id}});
      const body=vendaBody(p,"3",{clienteId:cliente.id,desconto:"4.70",vencimento:somarDias(hoje,7),recebimento:{contaId:conta.id,forma:"PIX",valor:"20"}});
      const v=await post("/vendas",body,201,{cookie:cookies.OPERADOR});vendaCompleta=v;
      assert.equal(v.total,"55.00");assert.equal(v.titulo.saldo,"35.00");assert.equal(v.titulo.status,"PARCIAL");
      const baixas=await db.movimentoEstoque.findMany({where:{vendaId:v.id,tipo:"SAIDA"}});assert.equal(baixas.length,2);assert.equal(baixas.find(m=>m.loteId===primeiro.id).quantidade.toFixed(3),"-2.000");assert.equal(baixas.find(m=>m.loteId===ultimo.id).quantidade.toFixed(3),"-1.000");
      assert.equal((await post("/vendas",body)).id,v.id);await post("/vendas",{...body,desconto:"4.71"},409);
      const concorrentes=await Promise.all([1,2].map(()=>request("/vendas/"+v.id+"/recebimentos",{method:"POST",body:{contaId:conta.id,forma:"DINHEIRO",valor:"30",...chave()},cookie:cookies.OPERADOR})));assert.deepEqual(concorrentes.map(r=>r.status).sort(),[201,409]);
      const ultimoPagamento={contaId:conta.id,forma:"PIX",valor:"5",...chave()};const pago=await post("/vendas/"+v.id+"/recebimentos",ultimoPagamento);assert.equal(pago.titulo.status,"PAGO");assert.equal(pago.titulo.saldo,"0.00");
      await post("/vendas/"+v.id+"/recebimentos",ultimoPagamento);assert.equal((await json("/financeiro/caixa?contaId="+conta.id,{},200)).resumo.saldoAtual,"55.00");
      await post("/financeiro/titulos/"+v.titulo.id+"/cancelar",{motivo:"Não pode por aqui",...chave()},409);
      await post("/estoque/produtos/"+p.id+"/movimentos/"+baixas[0].id+"/estornar",{motivo:"Não pode por aqui",...chave()},409);
      await db.produto.update({where:{id:p.id},data:{ativo:false}});
      const cancelamento={motivo:"Correção da venda "+"a".repeat(475),...chave()};const cancelada=await post("/vendas/"+v.id+"/cancelar",cancelamento);assert.equal(cancelada.status,"CANCELADA");assert.equal(cancelada.titulo.saldo,"0.00");assert.equal(cancelada.titulo.valorPago,"0.00");
      assert.equal((await post("/vendas/"+v.id+"/cancelar",cancelamento)).id,v.id);await post("/vendas/"+v.id+"/cancelar",{motivo:"Outra tentativa",...chave()},409);
      const depois=await db.produto.findUniqueOrThrow({where:{id:p.id}});assert.equal(depois.valorEstoque.toFixed(7),antes.valorEstoque.toFixed(7));assert.equal(depois.custoMedio.toFixed(4),antes.custoMedio.toFixed(4));
      assert.equal((await json("/estoque/produtos/"+p.id+"/saldo",{},200)).saldo,"59.000");assert.equal((await json("/financeiro/caixa?contaId="+conta.id,{},200)).resumo.saldoAtual,"0.00");assert.equal((await post("/vendas",body)).status,"CANCELADA");
      await assert.rejects(db.vendaItem.update({where:{id:v.itens[0].id},data:{quantidade:"99"}}));
    });
    await t.test("Falhas de validação e falta de estoque desfazem venda, custo, caixa e operação",async()=>{
      const a=await produto("ATOMICO-A",{id:"a-atomico"}),z=await produto("ATOMICO-Z",{id:"z-atomico"});await entrada(a,"1");
      const body=vendaBody(a,"1",{itens:[{produtoId:a.id,quantidade:"1",precoUnitario:"10.00"},{produtoId:z.id,quantidade:"1",precoUnitario:"10.00"}],recebimento:{contaId:conta.id,forma:"PIX",valor:"20"}});
      const counts=async()=>({vendas:await db.venda.count(),titulos:await db.tituloFinanceiro.count(),lancamentos:await db.lancamentoFinanceiro.count(),movimentos:await db.movimentoEstoque.count(),operacoes:await db.operacaoComercial.count(),auditoria:await db.auditLog.count()});
      const antes=await counts(),custo=(await db.produto.findUniqueOrThrow({where:{id:a.id}})).valorEstoque.toFixed(7);
      await post("/vendas",body,409);assert.deepEqual(await counts(),antes);assert.equal((await db.produto.findUniqueOrThrow({where:{id:a.id}})).valorEstoque.toFixed(7),custo);
      const invalidos=[{...vendaBody(a),empresaId:externa.id},{...vendaBody(a),clienteId:clienteExterno.id},{...vendaBody(a),recebimento:null},{...vendaBody(a),itens:[{produtoId:a.id,quantidade:"1",precoUnitario:"9.99"}]},{...vendaBody(a),recebimento:{contaId:contaExterna.id,forma:"PIX",valor:"10"}},{...vendaBody(a),recebimento:{contaId:conta.id,forma:"PIX",valor:"10",data:somarDias(hoje,1)}}];
      for(const [i,b] of invalidos.entries())await post("/vendas",b,i===3?409:400);
      assert.deepEqual(await counts(),antes);
      const expirado=await produto("SO-VENCIDO"),l=await post("/estoque/produtos/"+expirado.id+"/lotes",{numero:"V",validade:somarDias(hoje,-1)});await entrada(expirado,"5",l.id);await post("/vendas",vendaBody(expirado),409);
      const fakeDb={client:db},comercial=new ComercialService(fakeDb),estoque=new EstoqueService(fakeDb),financeiro=new FinanceiroService(fakeDb,comercial),vendas=new VendasService(fakeDb,comercial,estoque,financeiro);
      const falhaAntes=await counts();await assert.rejects(vendas.criar({...users.ADMIN,id:randomUUID()},vendaSchema.parse(vendaBody(a))));assert.deepEqual(await counts(),falhaAntes);
      await entrada(z,"1");const retentativa=await post("/vendas",body);assert.equal(retentativa.total,"20.00");
      assert.equal((await request("/vendas/"+retentativa.id,{cookie:cookies.CONTADORA})).status,403);
      const foreign=await db.venda.create({data:{empresaId:externa.id,subtotal:"1",desconto:"0",total:"1"}});assert.equal((await request("/vendas/"+foreign.id)).status,404);
    });
    await t.test("Duas vendas concorrentes não consomem o mesmo estoque",async()=>{
      const p=await produto("CONCORRENCIA-VENDA");await entrada(p,"5");
      const responses=await Promise.all([1,2].map(()=>request("/vendas",{method:"POST",body:vendaBody(p,"4")})));assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
      assert.equal((await json("/estoque/produtos/"+p.id+"/saldo",{},200)).saldo,"1.000");
      const q=await produto("IDEMPOTENCIA-VENDA");await entrada(q,"5");const body=vendaBody(q,"1");const repetidas=await Promise.all([1,2].map(()=>post("/vendas",body)));assert.equal(repetidas[0].id,repetidas[1].id);assert.equal((await json("/estoque/produtos/"+q.id+"/saldo",{},200)).saldo,"4.000");
    });
    await t.test("Falha no final do cancelamento desfaz devolução, estornos e status",async()=>{
      const p=await produto("ROLLBACK-CANCELAMENTO");await entrada(p,"2");const venda=await post("/vendas",vendaBody(p));
      const fakeDb={client:db},comercial=new ComercialService(fakeDb),originalAudit=comercial.auditar.bind(comercial);
      comercial.auditar=async(...args)=>{if(args[2]==="Venda"&&args[4]==="CANCELAR")throw new Error("Falha final simulada");return originalAudit(...args);};
      const financeiro=new FinanceiroService(fakeDb,comercial),service=new VendasService(fakeDb,comercial,new EstoqueService(fakeDb),financeiro);
      const saldoAntes=(await json("/financeiro/caixa?contaId="+conta.id,{},200)).resumo.saldoAtual,estoqueAntes=await json("/estoque/produtos/"+p.id+"/saldo",{},200),countAntes=await db.lancamentoFinanceiro.count();
      await assert.rejects(service.cancelar(users.ADMIN,venda.id,{motivo:"Teste de atomicidade",...chave()}),/Falha final simulada/);
      const depois=await json("/vendas/"+venda.id,{},200);assert.equal(depois.status,"CONFIRMADA");assert.equal(depois.titulo.status,"PAGO");assert.equal(await db.lancamentoFinanceiro.count(),countAntes);assert.equal((await json("/financeiro/caixa?contaId="+conta.id,{},200)).resumo.saldoAtual,saldoAntes);assert.equal((await json("/estoque/produtos/"+p.id+"/saldo",{},200)).saldo,estoqueAntes.saldo);
    });
    await t.test("Contas manuais, pagamento parcial, projeção, datas e estornos imutáveis",async()=>{
      const despesa=await post("/financeiro/titulos",{tipo:"PAGAR",descricao:"Compra Fornecedor QA",valor:"100",vencimento:somarDias(hoje,1),fornecedorId:fornecedor.id,...chave()},201,{cookie:cookies.CONTADORA});
      const entradaManual=await post("/financeiro/titulos",{tipo:"RECEBER",descricao:"Recebimento anterior",valor:"20",vencimento:hoje,clienteId:cliente.id,...chave()});
      const pagamento={contaId:banco.id,forma:"TRANSFERENCIA",valor:"40",data:hoje,...chave()};const l=await post("/financeiro/titulos/"+despesa.id+"/baixas",pagamento);assert.equal(l.valor,"-40.00");
      assert.equal((await post("/financeiro/titulos/"+despesa.id+"/baixas",pagamento)).id,l.id);
      const original=await json("/financeiro/titulos/"+despesa.id,{},200);assert.equal(original.status,"PARCIAL");assert.equal(original.saldo,"60.00");
      await post("/financeiro/titulos/"+entradaManual.id+"/baixas",{contaId:banco.id,forma:"PIX",valor:"20",data:somarDias(hoje,-1),...chave()});
      const caixa=await json("/financeiro/caixa?"+new URLSearchParams({contaId:banco.id,de:hoje,ate:somarDias(hoje,1)}),{},200);
      assert.equal(caixa.resumo.saldoAtual,"-20.00");assert.equal(caixa.resumo.entradas,"0.00");assert.equal(caixa.resumo.saidas,"40.00");assert.equal(caixa.resumo.aPagar,"60.00");
      await post("/financeiro/titulos/"+despesa.id+"/cancelar",{motivo:"Precisa estornar antes",...chave()},409);
      await post("/financeiro/titulos/"+despesa.id+"/baixas",{contaId:banco.id,forma:"PIX",valor:"60.01",...chave()},409);
      await json("/financeiro/contas/"+banco.id,{method:"PATCH",body:{versao:1,ativa:false,...chave()}},200);
      await post("/financeiro/titulos/"+despesa.id+"/baixas",{contaId:banco.id,forma:"PIX",valor:"1",...chave()},400);
      const estorno={motivo:"Pagamento lançado por engano",...chave()},reversao=await post("/financeiro/lancamentos/"+l.id+"/estornar",estorno);assert.equal(reversao.valor,"40.00");assert.equal(reversao.contaId,banco.id);assert.equal(reversao.data,hoje);
      assert.equal((await post("/financeiro/lancamentos/"+l.id+"/estornar",estorno)).id,reversao.id);await post("/financeiro/lancamentos/"+l.id+"/estornar",{motivo:"Duplicado",...chave()},409);
      const cancelada=await post("/financeiro/titulos/"+despesa.id+"/cancelar",{motivo:"Compra não realizada",...chave()});assert.equal(cancelada.status,"CANCELADO");assert.equal(cancelada.saldo,"0.00");
      await assert.rejects(db.lancamentoFinanceiro.update({where:{id:l.id},data:{valor:"-1"}}));await assert.rejects(db.lancamentoFinanceiro.delete({where:{id:l.id}}));
      const op=await db.operacaoComercial.findFirstOrThrow();await assert.rejects(db.operacaoComercial.update({where:{id:op.id},data:{resultadoId:"outro"}}));
      await json("/financeiro/contas/"+banco.id,{method:"PATCH",body:{versao:1,ativa:true,...chave()}},409);
      await json("/financeiro/contas/"+banco.id,{method:"PATCH",body:{versao:2,ativa:true,...chave()}},200);
      const paginacao=await json("/financeiro/titulos?pageSize=1&page=2",{},200);assert.equal(paginacao.itens.length,1);assert.ok(paginacao.pages>1);
      const atraso=await post("/financeiro/titulos",{tipo:"RECEBER",descricao:"Atrasada QA",valor:"5",vencimento:somarDias(hoje,-1),...chave()});const atrasadas=await json("/financeiro/titulos?status=ATRASADO&q=Atrasada",{},200);assert.equal(atrasadas.itens[0].id,atraso.id);
    });
    if(process.env.COMERCIAL_BROWSER==="1")await browserFlow({t,empresa,conta,banco,cliente,produto,entrada,users,cookies,vendaCompleta});
  }finally{await stop(server);await db.$disconnect();if(created)await root.$executeRawUnsafe('DROP DATABASE "'+name+'" WITH (FORCE)');await root.$disconnect();}
});
async function browserFlow({t,conta,banco,cliente,produto,entrada,cookies}){
  await t.test("Painel: venda parcial, reenvio, recebimento, cancelamento, despesa e celular",{timeout:180000},async()=>{
    const {chromium,expect}=await import("@playwright/test"),{mkdir}=await import("node:fs/promises"),{fileURLToPath}=await import("node:url");
    const requireAdmin=createRequire(new URL("../../admin/package.json",import.meta.url));let frontLogs="",browser;
    const front=spawn(process.execPath,[requireAdmin.resolve("next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","43179"],{cwd:new URL("../../admin/",import.meta.url),env:{...process.env,API_INTERNAL_URL:base,ADMIN_ORIGIN:origin,NODE_ENV:"production"},stdio:["ignore","pipe","pipe"]});front.stdout.on("data",v=>frontLogs+=v);front.stderr.on("data",v=>frontLogs+=v);
    try{
      await ready(front,origin+"/login",()=>frontLogs);browser=await chromium.launch({headless:true});
      const folder=new URL("../../../artifacts/comercial/",import.meta.url);await mkdir(folder,{recursive:true});
      const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:"loja_session",value:cookies.OPERADOR.split("=")[1],url:origin}]);const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
      const p=await produto("VENDA-UI",{nome:"Creme venda navegador"});await entrada(p,"5");
      await page.goto(origin+"/vendas/nova");await page.getByLabel("Buscar produto para venda",{exact:true}).fill("VENDA-UI");await page.getByRole("button",{name:"Buscar produtos",exact:true}).click();await page.getByRole("button",{name:"Adicionar Creme venda navegador",exact:true}).click();
      await page.getByLabel("Quantidade de Creme venda navegador",{exact:true}).fill("2");await page.getByLabel("Cliente da venda",{exact:true}).selectOption(cliente.id);await page.getByLabel("Desconto da venda (R$)",{exact:true}).fill("1");await page.getByLabel("Condição de pagamento",{exact:true}).selectOption("parcial");await page.getByLabel("Valor recebido agora (R$)",{exact:true}).fill("5");await page.getByLabel("Conta financeira",{exact:true}).selectOption(conta.id);await page.getByLabel("Observação (opcional)",{exact:true}).fill("Venda feita no navegador");await page.getByLabel("Confirmei o recebimento do valor informado.",{exact:true}).check();
      await expect(page.getByTestId("total-venda")).toContainText("19,00");await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:fileURLToPath(new URL("nova-venda-desktop.png",folder)),fullPage:true});
      let perdida=false;await page.route("**/api/gestao/vendas",async route=>{if(route.request().method()==="POST"&&!perdida){perdida=true;const r=await route.fetch();assert.equal(r.status(),201);await route.abort("failed");}else await route.continue();});
      await page.getByRole("button",{name:"Confirmar venda",exact:true}).click();await expect(page.getByRole("main").getByRole("alert")).toContainText("não foi possível",{ignoreCase:true});await expect(page.getByLabel("Desconto da venda (R$)",{exact:true})).toBeDisabled();
      await page.getByRole("button",{name:"Reenviar confirmação",exact:true}).click();await expect(page).toHaveURL(/\/vendas\/[A-Za-z0-9_-]+$/);await expect(page.getByTestId("saldo-venda")).toContainText("14,00");
      const vendasUI=await db.venda.findMany({where:{observacao:"Venda feita no navegador"}});assert.equal(vendasUI.length,1);const venda=vendasUI[0];assert.equal((await json("/estoque/produtos/"+p.id+"/saldo",{},200)).saldo,"3.000");
      await page.getByLabel("Conta financeira",{exact:true}).selectOption(conta.id);await page.getByLabel("Confirmei que este valor foi recebido.",{exact:true}).check();await page.getByRole("button",{name:"Registrar recebimento",exact:true}).click();await expect(page.getByTestId("saldo-venda")).toContainText("0,00");await page.screenshot({path:fileURLToPath(new URL("venda-paga-desktop.png",folder)),fullPage:true});
      await page.getByRole("button",{name:"Cancelar venda",exact:true}).click();await page.getByLabel("Motivo do cancelamento",{exact:true}).fill("Cliente cancelou no balcão");await page.getByLabel(/Confirmei a devolução ao cliente/).check();await page.getByRole("button",{name:"Confirmar cancelamento da venda",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Venda cancelada"})).toBeVisible();assert.equal((await json("/estoque/produtos/"+p.id+"/saldo",{},200)).saldo,"5.000");assert.equal((await db.venda.findUniqueOrThrow({where:{id:venda.id}})).status,"CANCELADA");
      await page.goto(origin+"/financeiro");await expect(page.getByRole("heading",{name:"Acesso restrito",exact:true})).toBeVisible();
      const adm=await browser.newContext({viewport:{width:1440,height:1000}});await adm.addCookies([{name:"loja_session",value:cookies.ADMIN.split("=")[1],url:origin}]);const finance=await adm.newPage();finance.on("pageerror",e=>errors.push(e.message));await finance.goto(origin+"/financeiro");await finance.getByRole("link",{name:"Nova conta a pagar ou receber",exact:true}).click();
      await finance.getByLabel("Valor da conta (R$)",{exact:true}).fill("12,34");await finance.getByLabel("Descrição da conta",{exact:true}).fill("Despesa do navegador");await finance.getByLabel("Fornecedor (opcional)",{exact:true}).selectOption({label:"Fornecedor QA"});await finance.getByRole("button",{name:"Salvar conta a pagar ou receber",exact:true}).click();await expect(finance.getByRole("heading",{name:"Despesa do navegador",exact:true})).toBeVisible();
      await expect(finance.getByText("Fornecedor: Fornecedor QA",{exact:true})).toBeVisible();
      await finance.getByLabel("Conta financeira",{exact:true}).selectOption(banco.id);await finance.getByLabel("Confirmei que este pagamento foi realizado.",{exact:true}).check();await finance.getByRole("button",{name:"Registrar baixa",exact:true}).click();await expect(finance.getByTestId("saldo-titulo")).toContainText("0,00");
      await finance.getByRole("button",{name:"Estornar lançamento",exact:false}).click();await finance.getByLabel("Motivo da correção",{exact:true}).fill("Pagamento lançado por engano");await finance.getByRole("button",{name:"Confirmar estorno financeiro",exact:true}).click();await expect(finance.getByTestId("saldo-titulo")).toContainText("12,34");
      await finance.getByRole("button",{name:"Cancelar conta",exact:true}).click();await finance.getByLabel("Motivo da correção",{exact:true}).fill("Despesa não realizada");await finance.getByRole("button",{name:"Confirmar cancelamento da conta",exact:true}).click();await expect(finance.getByTestId("saldo-titulo")).toContainText("0,00");
      await finance.goto(origin+"/financeiro");await expect(finance.getByRole("region",{name:"Resumo financeiro",exact:true})).toBeVisible();await finance.screenshot({path:fileURLToPath(new URL("financeiro-desktop.png",folder)),fullPage:true});
      const mobile=await browser.newContext({viewport:{width:360,height:800}});await mobile.addCookies([{name:"loja_session",value:cookies.OPERADOR.split("=")[1],url:origin}]);const m=await mobile.newPage();await m.goto(origin+"/vendas/nova");await m.getByLabel("Buscar produto para venda",{exact:true}).fill("VENDA-UI");await m.getByRole("button",{name:"Buscar produtos",exact:true}).click();await m.getByRole("button",{name:"Adicionar Creme venda navegador",exact:true}).click();assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await m.screenshot({path:fileURLToPath(new URL("nova-venda-mobile.png",folder)),fullPage:true});
      const contador=await browser.newContext({viewport:{width:390,height:844}});await contador.addCookies([{name:"loja_session",value:cookies.CONTADORA.split("=")[1],url:origin}]);const c=await contador.newPage();await c.goto(origin+"/financeiro");await expect(c.getByRole("region",{name:"Resumo financeiro",exact:true})).toBeVisible();assert.ok(await c.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await c.screenshot({path:fileURLToPath(new URL("financeiro-mobile.png",folder)),fullPage:true});await c.getByRole("button",{name:"Contas financeiras",exact:true}).click();await expect(c.getByRole("button",{name:"Salvar conta financeira",exact:true})).toHaveCount(0);await c.goto(origin+"/vendas/nova");await expect(c.getByRole("heading",{name:"Acesso restrito",exact:true})).toBeVisible();
      assert.equal((await finance.request.post(origin+"/api/gestao/financeiro/titulos",{headers:{origin:"https://externo.invalid"},data:{}})).status(),403);assert.equal((await finance.request.post(origin+"/api/gestao/financeiro/contas/opcoes",{headers:{origin},data:{}})).status(),405);assert.equal((await finance.request.get(origin+"/api/gestao/financeiro/auth")).status(),404);assert.deepEqual(errors,[]);
    }finally{if(browser)await browser.close();await stop(front);}
  });
}
