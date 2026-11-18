import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { chromium, expect } from "@playwright/test";
import { createDatabase } from "@sistema/db";
import { MediaStorage, createPhotoQueue, startPhotoWorker, attemptPrefix } from "@sistema/media";
import { MAX_PHOTO_BYTES, PHOTO_VARIANTS, PHOTO_RETENTION_MS } from "@sistema/shared";
import { hash, argon2id } from "argon2";
import { createClient } from "redis";
loadEnvFile(new URL("../../../.env",import.meta.url));
const requireMedia=createRequire(new URL("../../../packages/media/package.json",import.meta.url));
const sharp=requireMedia("sharp").default??requireMedia("sharp");
const {ListObjectsV2Command,DeleteObjectsCommand,DeleteBucketCommand}=requireMedia("@aws-sdk/client-s3");
const local=new URL(process.env.DATABASE_URL);
assert.ok(["127.0.0.1","localhost"].includes(local.hostname)&&local.pathname==="/sistema_loja","Os testes exigem o banco local sistema_loja.");
const suffix=randomBytes(8).toString("hex");
const database="sistema_loja_test_fotos_"+suffix;
const bucket="sistema-loja-fotos-test-"+suffix;
assert.match(database,/^sistema_loja_test_fotos_[a-f0-9]{16}$/);
assert.match(bucket,/^sistema-loja-fotos-test-[a-f0-9]{16}$/);
const dbUrl=new URL(local);dbUrl.pathname="/"+database;
const prefix="sistema-loja-test-fotos-"+suffix;
const authPrefix=prefix+"-auth";
process.env.S3_MEDIA_BUCKET=bucket;process.env.MEDIA_QUEUE_PREFIX=prefix;
const rootDb=createDatabase(local.toString());
const db=createDatabase(dbUrl.toString());
const storage=new MediaStorage();
const queue=createPhotoQueue();
const origin="http://127.0.0.1:43159";
const base="http://127.0.0.1:43157";
const password=randomBytes(24).toString("hex");
const companies=[randomUUID(),randomUUID()];
const users={},cookies={};
let apiServer,workerServer,maintenance;
let databaseCreated=false,bucketCreated=false;
const paths={};
async function stop(child){if(child&&child.exitCode===null){const closed=once(child,"exit");child.kill();await closed;}}
async function waitFor(fn,timeout=90000){const start=Date.now();while(Date.now()-start<timeout){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,250));}assert.fail("Tempo limite aguardando a operação.");}
const environment=()=>({...process.env,DATABASE_URL:dbUrl.toString(),S3_MEDIA_BUCKET:bucket,MEDIA_QUEUE_PREFIX:prefix,ADMIN_ORIGIN:origin,EMPRESA_ID:companies[0],AUTH_REDIS_PREFIX:authPrefix,NODE_ENV:"test"});
async function startWorker(){
  let logs="";
  workerServer=spawn(process.execPath,["dist/main.js"],{cwd:new URL("../../worker/",import.meta.url),env:environment(),stdio:["ignore","pipe","pipe"]});
  workerServer.stdout.on("data",data=>logs+=data);workerServer.stderr.on("data",data=>logs+=data);
  await waitFor(async()=>{if(workerServer.exitCode!==null)assert.fail("Worker encerrou: "+logs);return logs.includes("Worker de imagens pronto.");},30000);
}
async function call(path,{method="GET",body,cookie=cookies.ADMIN,originHeader=origin}={}){
  return fetch(base+path,{method,headers:{"Content-Type":"application/json",...(cookie?{cookie}:{}),...(method!=="GET"?{origin:originHeader}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
const photoPath=(product)=>"/produtos/"+product.id+"/imagens";
async function gallery(product){const response=await call(photoPath(product));assert.equal(response.status,200);return response.json();}
async function begin(product,buffer,type="image/png",replace){
  const response=await call(photoPath(product)+"/iniciar",{method:"POST",body:{alt:"Foto do produto",tamanho:buffer.length,mimeTipo:type,...(replace?{substituirId:replace}:{})}});
  assert.equal(response.status,201,await response.clone().text());
  const result=await response.json();
  assert.ok(new URL(result.url).searchParams.get("X-Amz-SignedHeaders").includes("content-length"));
  return result;
}
async function put(reservation,buffer,type){const response=await fetch(reservation.url,{method:"PUT",headers:{"Content-Type":type},body:buffer});assert.equal(response.status,200,await response.text());}
async function confirm(product,id){const response=await call(photoPath(product)+"/"+id+"/confirmar",{method:"POST",body:{}});assert.equal(response.status,202,await response.clone().text());return response.json();}
async function ready(product,id,state="PRONTA"){return waitFor(async()=>{const image=(await gallery(product)).imagens.find(image=>image.id===id);if(image?.status==="ERRO"&&state!=="ERRO")assert.fail(image.mensagem??"Falha no processamento.");return image?.status===state?image:false;});}
async function upload(product,buffer,type="image/png",replace){const reservation=await begin(product,buffer,type,replace);await put(reservation,buffer,type);await confirm(product,reservation.id);await ready(product,reservation.id);return reservation;}
async function action(product,id,name){const state=await gallery(product);const response=await call(photoPath(product)+"/"+id+"/"+name,{method:"POST",body:{versao:state.versao}});return response;}
async function binary(product,id,variant="thumb.webp",cookie=cookies.ADMIN){return call(photoPath(product)+"/"+id+"/arquivo/"+variant,{cookie});}
async function bufferOf(response){assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());}
async function fixture(){
  const target=new URL("../../../artifacts/heic-fixture.heic",import.meta.url);
  let buffer;try{buffer=await readFile(target);}catch{
    const response=await fetch("https://raw.githubusercontent.com/strukturag/libheif/12a259a5882dd99d45ec5fc77e296a3b620d1e2e/examples/example.heic");
    assert.equal(response.status,200);buffer=Buffer.from(await response.arrayBuffer());await mkdir(new URL("../../../artifacts/",import.meta.url),{recursive:true});await writeFile(target,buffer);
  }
  assert.equal(createHash("sha256").update(buffer).digest("hex"),"7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2");
  return buffer;
}
test("Fotos: armazenamento e banco isolados, fila e navegador reais",{timeout:600000},async t=>{
  try{
    await rootDb.$executeRawUnsafe('CREATE DATABASE "'+database+'"');databaseCreated=true;
    const requireDb=createRequire(new URL("../../../packages/db/package.json",import.meta.url));
    execFileSync(process.execPath,[requireDb.resolve("prisma/build/index.js"),"migrate","deploy"],{cwd:new URL("../../../packages/db/",import.meta.url),env:{...process.env,DATABASE_URL:dbUrl.toString()},stdio:"pipe",timeout:90000});
    await storage.ensureBucket();bucketCreated=true;
    const senhaHash=await hash(password,{type:argon2id,memoryCost:65536,timeCost:3,parallelism:1});
    for(const id of companies)await db.empresa.create({data:{id,nome:"Empresa de teste de fotos"}});
    for(const perfil of ["ADMIN","OPERADOR","CONTADORA"])users[perfil]=await db.usuario.create({data:{empresaId:companies[0],nome:"Teste "+perfil,email:randomUUID()+"@example.invalid",senhaHash,perfil}});
    for(const name of ["main","invalid","capacity","recovery","ui","foreign"])paths[name]=await db.produto.create({data:{empresaId:name==="foreign"?companies[1]:companies[0],nome:name==="ui"?"Sérum de teste visual":"Produto de teste "+name,sku:name.toUpperCase(),tipo:"REVENDA",unidade:"UN",precoVenda:"49.90"}});
    let logs="";
    apiServer=spawn(process.execPath,["dist/main.js"],{env:{...environment(),API_PORT:"43157"},stdio:["ignore","pipe","pipe"]});
    apiServer.stdout.on("data",data=>logs+=data);apiServer.stderr.on("data",data=>logs+=data);
    await waitFor(async()=>{if(apiServer.exitCode!==null)assert.fail("API encerrou: "+logs);try{return(await fetch(base+"/health/ready")).ok;}catch{return false;}},30000);
    for(const perfil of ["ADMIN","OPERADOR","CONTADORA"]){const response=await call("/auth/login",{method:"POST",cookie:"",body:{email:users[perfil].email,senha:password}});assert.equal(response.status,200);cookies[perfil]=response.headers.get("set-cookie").split(";")[0];}
    await startWorker();
    maintenance=startPhotoWorker(db,storage,{timers:false,process:false});
    const png=await sharp({create:{width:300,height:420,channels:3,background:"#97b5a7"}}).png().toBuffer();
    const blue=await sharp({create:{width:360,height:260,channels:3,background:"#50778f"}}).png().toBuffer();
    const webp=await sharp({create:{width:200,height:300,channels:3,background:"#c9aa83"}}).webp().toBuffer();
    const jpeg=await sharp({create:{width:120,height:80,channels:3,background:"#b45b70"}}).withMetadata({orientation:6}).jpeg().toBuffer();
    let first,second;
    await t.test("Permissões, origem, tamanho e metadados inválidos",async()=>{
      assert.equal((await call(photoPath(paths.main),{cookie:""})).status,401);
      assert.equal((await call(photoPath(paths.main),{cookie:cookies.CONTADORA})).status,403);
      assert.equal((await call(photoPath(paths.foreign))).status,404);
      for(const body of [{alt:"",tamanho:1,mimeTipo:"image/png"},{alt:"Teste",tamanho:MAX_PHOTO_BYTES+1,mimeTipo:"image/png"},{alt:"Teste",tamanho:1,mimeTipo:"image/svg+xml"},{alt:"Teste",tamanho:1,mimeTipo:"image/png",empresaId:companies[1]}])assert.equal((await call(photoPath(paths.main)+"/iniciar",{method:"POST",body})).status,400);
      assert.equal((await call(photoPath(paths.main)+"/iniciar",{method:"POST",originHeader:"https://externo.invalid",body:{alt:"Teste",tamanho:png.length,mimeTipo:"image/png"}})).status,403);
    });
    await t.test("URL assinada limita tamanho; processamento gera nove versões sem EXIF",async()=>{
      first=await begin(paths.main,jpeg,"image/jpeg");
      const oversized=await fetch(first.url,{method:"PUT",headers:{"Content-Type":"image/jpeg"},body:Buffer.concat([jpeg,Buffer.from([0])])});
      assert.ok(!oversized.ok,"A assinatura precisa impedir alteração do tamanho declarado.");
      await put(first,jpeg,"image/jpeg");await confirm(paths.main,first.id);await confirm(paths.main,first.id);
      const photo=await ready(paths.main,first.id);
      assert.equal(photo.larguraOrig,80);assert.equal(photo.alturaOrig,120);assert.ok(photo.blurDataUrl.startsWith("data:image/jpeg;base64,"));
      for(const variant of PHOTO_VARIANTS){
        const response=await binary(paths.main,first.id,variant);
        assert.match(response.headers.get("cache-control"),/no-store/);
        const bytes=await bufferOf(response);const meta=await sharp(bytes).metadata();
        const size=variant.startsWith("thumb")?160:variant.startsWith("card")?480:variant.startsWith("zoom")?2048:1024;
        assert.equal(meta.width,size);assert.equal(meta.height,size);assert.equal(meta.exif,undefined);assert.equal(meta.orientation,undefined);
      }
      const pixels=await sharp(await bufferOf(await binary(paths.main,first.id))).removeAlpha().raw().toBuffer();
      assert.ok(pixels[0]>=245&&pixels[1]>=245&&pixels[2]>=245,"O enquadramento deve ter fundo branco.");
      assert.equal(await db.auditLog.count({where:{entidade:"ProdutoImagem",entidadeId:first.id,acao:"PROCESSAR_IMAGEM"}}),1);
      const row=await db.produtoImagem.findUniqueOrThrow({where:{id:first.id}});
      const anonymous=await fetch((process.env.S3_ENDPOINT??"http://127.0.0.1:19000")+"/"+bucket+"/"+row.uploadKey);assert.equal(anonymous.status,403);
      assert.equal((await binary(paths.main,first.id,"thumb.webp","")).status,401);
      assert.equal((await binary(paths.main,first.id,"thumb.webp",cookies.CONTADORA)).status,403);
      assert.equal((await binary(paths.foreign,first.id)).status,404);
      assert.equal((await binary(paths.main,first.id,"original")).status,404);
    });
    await t.test("Conteúdo disfarçado e imagem acima de 40 MP são recusados",async()=>{
      const fake=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const reservation=await begin(paths.invalid,fake,"image/png");await put(reservation,fake,"image/png");await confirm(paths.invalid,reservation.id);
      const failed=await ready(paths.invalid,reservation.id,"ERRO");assert.equal(failed.temFoto,false);assert.equal((await binary(paths.invalid,reservation.id)).status,404);
      const huge=await sharp({create:{width:10000,height:5000,channels:3,background:"#ffffff"}}).png({compressionLevel:9}).toBuffer();
      const big=await begin(paths.invalid,huge,"image/png");await put(big,huge,"image/png");await confirm(paths.invalid,big.id);
      assert.match((await ready(paths.invalid,big.id,"ERRO")).mensagem,/40 megapixels/);
    });
    await t.test("HEIC real, PNG e WebP são processados",async()=>{
      second=await upload(paths.main,await fixture(),"image/heic");
      assert.ok((await ready(paths.main,second.id)).larguraOrig>0);
      await upload(paths.main,png,"image/png");
      await upload(paths.main,webp,"image/webp");
      assert.equal((await gallery(paths.main)).imagens.length,4);
    });
    await t.test("Ordenação, foto principal, descrição e controle de versão",async()=>{
      const before=await gallery(paths.main);const ids=before.imagens.map(image=>image.id).reverse();
      let response=await call(photoPath(paths.main)+"/ordenar",{method:"POST",body:{ids,versao:before.versao}});assert.equal(response.status,200);
      let after=await response.json();assert.deepEqual(after.imagens.map(image=>image.id),ids);
      response=await call(photoPath(paths.main)+"/ordenar",{method:"POST",body:{ids,versao:before.versao}});assert.equal(response.status,409);
      response=await call(photoPath(paths.main)+"/ordenar",{method:"POST",body:{ids:ids.slice(1),versao:after.versao}});assert.equal(response.status,400);
      response=await call(photoPath(paths.main)+"/"+first.id,{method:"PATCH",body:{alt:"Frasco com rótulo na frente",versao:after.versao}});assert.equal(response.status,200);after=await response.json();
      assert.equal(after.imagens.find(image=>image.id===first.id).alt,"Frasco com rótulo na frente");
      const list=await(await call("/produtos")).json();assert.equal(list.itens.find(item=>item.id===paths.main.id).imagemPrincipal.id,ids[0]);
      assert.equal((await call("/produtos/"+paths.main.id,{method:"PATCH",body:{descricao:"Metadados independentes da galeria.",versao:paths.main.versao}})).status,200);
    });
    await t.test("Troca mantém foto anterior, inclusive se o novo arquivo falhar",async()=>{
      console.info("[fotos] Iniciando teste de troca",new Date().toISOString());
      const old=await db.produtoImagem.findUniqueOrThrow({where:{id:first.id}});const oldThumb=await bufferOf(await binary(paths.main,first.id));
      const bad=Buffer.from("arquivo sem imagem");
      const reservation=await begin(paths.main,bad,"image/png",first.id);
      assert.deepEqual(await bufferOf(await binary(paths.main,first.id)),oldThumb);
      await put(reservation,bad,"image/png");await confirm(paths.main,first.id);
      console.info("[fotos] Aguardando recusa do arquivo inválido");
      const failed=await ready(paths.main,first.id,"ERRO");assert.equal(failed.hash,old.hash);assert.equal(failed.temFoto,true);
      assert.deepEqual(await bufferOf(await binary(paths.main,first.id)),oldThumb);
      console.info("[fotos] Enviando substituição válida");
      await upload(paths.main,blue,"image/png",first.id);
      console.info("[fotos] Substituição válida pronta");
      const current=await db.produtoImagem.findUniqueOrThrow({where:{id:first.id}});
      assert.notEqual(current.hash,old.hash);assert.equal((await gallery(paths.main)).imagens.length,4);
      await storage.head(old.formatos["thumb.webp"].key);
      const retained=await db.imagemLimpeza.findUniqueOrThrow({where:{prefixo:old.prefixoAtual}});
      assert.ok(retained.excluirApos.getTime()>Date.now()+PHOTO_RETENTION_MS-60000);
      await db.imagemLimpeza.update({where:{id:retained.id},data:{excluirApos:new Date(Date.now()-1000)}});
      console.info("[fotos] Verificando limpeza do arquivo antigo");
      await maintenance.cleanup();
      console.info("[fotos] Limpeza do arquivo antigo concluída");
      await assert.rejects(storage.head(old.formatos["thumb.webp"].key));
      await storage.head(current.formatos["thumb.webp"].key);
    });
    await t.test("Limite de oito fotos é transacional e permite troca sem nona vaga",async()=>{
      const responses=await Promise.all(Array.from({length:9},()=>call(photoPath(paths.capacity)+"/iniciar",{method:"POST",body:{alt:"Foto reservada",tamanho:png.length,mimeTipo:"image/png"}})));
      assert.equal(responses.filter(response=>response.status===201).length,8);assert.equal(responses.filter(response=>response.status===409).length,1);
      let state=await gallery(paths.capacity);assert.equal(state.imagens.length,8);
      const chosen=state.imagens[0].id;assert.equal((await action(paths.capacity,chosen,"cancelar")).status,200);
      await upload(paths.capacity,png,"image/png",chosen);assert.equal((await gallery(paths.capacity)).imagens.length,8);
      assert.equal((await action(paths.capacity,chosen,"remover")).status,200);
      const extra=await begin(paths.capacity,png,"image/png");
      assert.equal((await action(paths.capacity,chosen,"restaurar")).status,409);
      assert.equal((await action(paths.capacity,extra.id,"remover")).status,200);
      assert.equal((await action(paths.capacity,chosen,"restaurar")).status,200);
    });
    await t.test("Cancelamento preserva a foto atual e reservas expiradas podem ser refeitas",async()=>{
      const old=await db.produtoImagem.findUniqueOrThrow({where:{id:first.id}});
      await begin(paths.main,png,"image/png",first.id);
      assert.equal((await action(paths.main,first.id,"cancelar")).status,200);
      const restored=(await gallery(paths.main)).imagens.find(image=>image.id===first.id);
      assert.equal(restored.hash,old.hash);assert.equal(restored.status,"PRONTA");
      const pending=await begin(paths.invalid,png,"image/png");
      await db.produtoImagem.update({where:{id:pending.id},data:{tentativaEm:new Date(Date.now()-16*60*1000)}});
      await maintenance.cleanup();
      assert.equal((await db.produtoImagem.findUniqueOrThrow({where:{id:pending.id}})).status,"ERRO");
      await upload(paths.invalid,png,"image/png",pending.id);
      const staged=await begin(paths.invalid,png,"image/png");await put(staged,png,"image/png");
      const stagedRow=await db.produtoImagem.findUniqueOrThrow({where:{id:staged.id}});
      assert.equal((await action(paths.invalid,staged.id,"remover")).status,200);
      assert.equal((await action(paths.invalid,staged.id,"restaurar")).status,200);
      await begin(paths.invalid,blue,"image/png",staged.id);
      assert.ok(await db.imagemLimpeza.findUnique({where:{prefixo:attemptPrefix(stagedRow.empresaId,stagedRow.produtoId,stagedRow.id,stagedRow.tentativaId)}}));
    });
    await t.test("Pendência é retomada após perda do job e reinício do worker",async()=>{
      await stop(workerServer);workerServer=undefined;
      const reservation=await begin(paths.recovery,png,"image/png");await put(reservation,png,"image/png");await confirm(paths.recovery,reservation.id);
      await queue.drain(true);
      await db.produtoImagem.update({where:{id:reservation.id},data:{tentativaEm:new Date(Date.now()-20*60*1000)}});
      await maintenance.cleanup();
      const row=await db.produtoImagem.findUniqueOrThrow({where:{id:reservation.id}});await storage.head(row.uploadKey);
      await startWorker();await ready(paths.recovery,reservation.id);
      assert.equal(await db.auditLog.count({where:{entidadeId:reservation.id,acao:"PROCESSAR_IMAGEM"}}),1);
    });
    await t.test("Remoção é imediata; restauração e exclusão após sete dias funcionam",async()=>{
      const row=await db.produtoImagem.findUniqueOrThrow({where:{id:second.id}});
      assert.equal((await action(paths.main,second.id,"remover")).status,200);
      assert.equal((await binary(paths.main,second.id)).status,404);await storage.head(row.formatos["thumb.webp"].key);
      assert.ok((await gallery(paths.main)).removidas.some(image=>image.id===second.id));
      assert.equal((await action(paths.main,second.id,"restaurar")).status,200);
      assert.equal((await binary(paths.main,second.id)).status,200);
      assert.equal((await action(paths.main,second.id,"remover")).status,200);
      await db.produtoImagem.update({where:{id:second.id},data:{removidaEm:new Date(Date.now()-8*24*60*60*1000)}});
      await maintenance.cleanup();
      assert.ok((await db.produtoImagem.findUniqueOrThrow({where:{id:second.id}})).arquivosRemovidosEm);
      await assert.rejects(storage.head(row.formatos["thumb.webp"].key));
      assert.equal((await action(paths.main,second.id,"restaurar")).status,400);
      assert.equal((await binary(paths.main,first.id)).status,200);
    });
    await t.test("Limpeza temporária preserva o original validado e as versões atuais",async()=>{
      const row=await db.produtoImagem.findUniqueOrThrow({where:{id:first.id}});
      await db.produtoImagem.update({where:{id:first.id},data:{tentativaEm:new Date(Date.now()-16*60*1000)}});
      await maintenance.cleanup();
      assert.ok((await db.produtoImagem.findUniqueOrThrow({where:{id:first.id}})).uploadLimpoEm);
      await assert.rejects(storage.head(row.uploadKey));await storage.head(row.prefixoAtual+"original-"+row.hash);
      assert.equal((await binary(paths.main,first.id)).status,200);
    });
    await t.test("Navegador: envio direto, progresso, arrastar, capa, troca, remoção e restauração",async()=>{
      const requireAdmin=createRequire(new URL("../../admin/package.json",import.meta.url));
      const front=spawn(process.execPath,[requireAdmin.resolve("next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","43159"],{cwd:new URL("../../admin/",import.meta.url),env:{...environment(),API_INTERNAL_URL:base,NODE_ENV:"production"},stdio:["ignore","pipe","pipe"]});
      let logs="";front.stdout.on("data",data=>logs+=data);front.stderr.on("data",data=>logs+=data);let browser;
      try{
        await waitFor(async()=>{if(front.exitCode!==null)assert.fail(logs);try{return(await fetch(origin+"/login")).ok;}catch{return false;}},30000);
        browser=await chromium.launch({headless:true});
        const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on("pageerror",error=>errors.push(error.message));
        const signIn=async(page,role)=>{await page.goto(origin+"/login");await page.getByLabel("E-mail").fill(users[role].email);await page.getByLabel("Senha",{exact:true}).fill(password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await expect(page.getByRole("heading",{name:"Bem-vindo, Teste!",exact:true})).toBeVisible();};
        await signIn(page,"ADMIN");await page.goto(origin+"/produtos/"+paths.ui.id+"#fotos-produto");
        const section=page.getByRole("region",{name:"Fotos do produto"});
        await expect(section.getByRole("button",{name:"Adicionar fotos",exact:true})).toBeEnabled();
        const requests=[];page.on("request",request=>{if(request.method()==="PUT")requests.push(request.url());});
        await section.getByLabel("Selecionar fotos do produto",{exact:true}).setInputFiles([{name:"foto-a.png",mimeType:"image/png",buffer:png},{name:"foto-b.jpg",mimeType:"image/jpeg",buffer:jpeg}]);
        await expect(section.getByText("Foto pronta",{exact:true})).toHaveCount(2,{timeout:90000});
        assert.ok(requests.length>=2&&requests.every(url=>new URL(url).origin===new URL(process.env.S3_ENDPOINT).origin));
        const cards=section.locator("[data-photo-id]");
        await cards.nth(0).getByLabel("Descrição da foto 1",{exact:true}).fill("Frasco visto de frente");
        await cards.nth(0).getByRole("button",{name:"Salvar descrição",exact:true}).click();
        await expect(cards.nth(0).getByRole("img",{name:"Frasco visto de frente",exact:true})).toBeVisible();
        await cards.nth(1).getByRole("button",{name:"Tornar principal",exact:true}).click();
        await expect(cards.nth(0).getByText("Principal",{exact:true})).toBeVisible();
        const orderBefore=await cards.evaluateAll(elements=>elements.map(element=>element.getAttribute("data-photo-id")));
        await cards.nth(0).dragTo(cards.nth(1));
        await expect.poll(async()=>cards.nth(0).getAttribute("data-photo-id")).toBe(orderBefore[1]);
        await section.getByRole("button",{name:"Mover foto 2 para cima",exact:true}).click();
        await expect.poll(async()=>cards.nth(0).getAttribute("data-photo-id")).toBe(orderBefore[0]);
        await cards.nth(0).getByRole("button",{name:"Ampliar foto 1",exact:true}).click();
        const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();await expect(dialog.getByRole("img")).toBeVisible();
        await dialog.getByLabel("Tamanho da prévia").selectOption("card.webp");await dialog.getByRole("button",{name:"Fechar",exact:true}).click();
        const replaceId=await cards.nth(0).getAttribute("data-photo-id");const old=await db.produtoImagem.findUniqueOrThrow({where:{id:replaceId}});
        await cards.nth(0).getByLabel("Trocar arquivo da foto 1",{exact:true}).setInputFiles({name:"troca.png",mimeType:"image/png",buffer:blue});
        await expect.poll(async()=>(await db.produtoImagem.findUniqueOrThrow({where:{id:replaceId}})).hash,{timeout:90000}).not.toBe(old.hash);
        await expect(section.getByText("Foto pronta",{exact:true})).toHaveCount(2,{timeout:90000});
        await cards.nth(1).getByRole("button",{name:"Remover foto",exact:true}).click();await expect(cards).toHaveCount(1);
        await section.getByText("Fotos removidas (1)",{exact:true}).click();await section.getByRole("button",{name:"Restaurar foto",exact:true}).click();await expect(cards).toHaveCount(2);
        await expect(section.getByRole("button",{name:"Adicionar fotos",exact:true})).toBeEnabled();
        const transfer=await page.evaluateHandle(({base64})=>{const data=new DataTransfer();const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));data.items.add(new File([bytes],"foto-arrastada.webp",{type:"image/webp"}));return data;},{base64:webp.toString("base64")});
        await section.locator(".photo-dropzone").dispatchEvent("drop",{dataTransfer:transfer});await transfer.dispose();
        await expect(section.getByText("Foto pronta",{exact:true})).toHaveCount(3,{timeout:90000});
        await expect(section.getByRole("status").filter({hasText:"Fotos prontas."})).toBeVisible();
        const artifacts=new URL("../../../artifacts/",import.meta.url);await mkdir(artifacts,{recursive:true});
        for(const image of await section.getByRole("img").all()){await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);}
        await section.screenshot({path:fileURLToPath(new URL("fotos-galeria-desktop.png",artifacts))});
        await page.getByRole("link",{name:"Produtos",exact:true}).click();
        const row=page.getByRole("row").filter({hasText:paths.ui.nome});await expect(row.getByRole("img")).toBeVisible();await expect.poll(()=>row.getByRole("img").evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
        const mobile=await browser.newPage({viewport:{width:390,height:844}});await signIn(mobile,"OPERADOR");await mobile.goto(origin+"/produtos/"+paths.ui.id+"#fotos-produto");
        const mobileSection=mobile.getByRole("region",{name:"Fotos do produto"});await expect(mobileSection.getByText("Foto pronta",{exact:true})).toHaveCount(3,{timeout:30000});
        assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
        for(const image of await mobileSection.getByRole("img").all()){await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);}
        await mobileSection.screenshot({path:fileURLToPath(new URL("fotos-galeria-mobile.png",artifacts))});
        const accountant=await browser.newPage();await signIn(accountant,"CONTADORA");await accountant.goto(origin+"/produtos/"+paths.ui.id);await expect(accountant.getByRole("heading",{name:"Acesso restrito"})).toBeVisible();
        const protectedFile=(await gallery(paths.ui)).imagens[0].id;
        assert.equal((await accountant.request.get(origin+"/api/fotos/produtos/"+paths.ui.id+"/imagens/"+protectedFile+"/arquivo/thumb.webp")).status(),403);
        assert.deepEqual(errors,[]);
      }finally{if(browser)await browser.close();await stop(front);}
    });
  }finally{
    await stop(apiServer);await stop(workerServer);if(maintenance)await maintenance.close();
    let queueError;try{await queue.obliterate({force:true});}catch(error){queueError=error;}await queue.close().catch(error=>{queueError??=error;});
    await db.$disconnect();
    if(bucketCreated){
      while(true){const response=await storage.client.send(new ListObjectsV2Command({Bucket:bucket,MaxKeys:1000}));const objects=(response.Contents??[]).flatMap(item=>item.Key?[{Key:item.Key}]:[]);if(!objects.length)break;const removed=await storage.client.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:objects,Quiet:true}}));assert.ok(!removed.Errors?.length);}
      await storage.client.send(new DeleteBucketCommand({Bucket:bucket}));
    }
    storage.close();
    if(databaseCreated)await rootDb.$executeRawUnsafe('DROP DATABASE "'+database+'" WITH (FORCE)');await rootDb.$disconnect();
    const redis=createClient({url:process.env.REDIS_URL,socket:{reconnectStrategy:false}});redis.on("error",()=>{});
    try{await redis.connect();for(const match of [prefix+"*",authPrefix+"*"])for await(const keys of redis.scanIterator({MATCH:match,COUNT:100})){if(keys.length)await redis.del(keys);}}finally{if(redis.isOpen)await redis.quit();}
    if(queueError)throw queueError;
  }
});
