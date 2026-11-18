import { Worker, UnrecoverableError } from "bullmq";
import type { PrismaClient, Prisma } from "@sistema/db";
import { PHOTO_RETENTION_MS, PHOTO_UPLOAD_TIMEOUT_MS } from "@sistema/shared";
import { MediaStorage, PhotoValidationError, attemptPrefix, photoRoot } from "./storage";
import { processImage } from "./processor";
import { PHOTO_QUEUE, createPhotoQueue, enqueuePhoto, queuePrefix, redisConnection } from "./queue";
export async function lockProduct(tx: Prisma.TransactionClient, empresaId: string, produtoId: string) {
  return tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Produto" WHERE id = ${produtoId} AND "empresaId" = ${empresaId} FOR UPDATE`;
}
export function startPhotoWorker(db: PrismaClient, storage: MediaStorage, options: { timers?: boolean; process?: boolean } = {}) {
  const queue = createPhotoQueue();
  async function retain(tx: Prisma.TransactionClient, image: { id: string; empresaId: string }, prefixo: string, delay = PHOTO_RETENTION_MS) {
    await tx.imagemLimpeza.upsert({ where: { prefixo }, create: { empresaId: image.empresaId, imagemId: image.id, prefixo, excluirApos: new Date(Date.now() + delay) }, update: {} });
  }
  async function fail(imagemId: string, tentativaId: string, message: string) {
    const old = await db.produtoImagem.findUnique({ where: { id: imagemId } }); if (!old) return;
    await db.$transaction(async tx => {
      await lockProduct(tx, old.empresaId, old.produtoId);
      const row = await tx.produtoImagem.findUnique({ where: { id: imagemId } });
      if (!row || row.removidaEm || row.tentativaId !== tentativaId || row.status !== "PROCESSANDO") return;
      await tx.produtoImagem.update({ where: { id: imagemId }, data: { status: "ERRO", mensagem: message, altPendente: null } });
      const prefix = attemptPrefix(row.empresaId,row.produtoId,row.id,tentativaId);
      if (prefix !== row.prefixoAtual) await retain(tx,row,prefix,3600000);
      await tx.produto.update({ where: { id: row.produtoId }, data: { galeriaVersao: { increment: 1 } } });
      await tx.auditLog.create({ data: { empresaId: row.empresaId, entidade: "ProdutoImagem", entidadeId: row.id, acao: "PROCESSAR_IMAGEM_ERRO", dados: { mensagem: message } } });
    });
  }
  const worker = new Worker(PHOTO_QUEUE, async job => {
    const { imagemId, tentativaId } = job.data as { imagemId: string; tentativaId: string };
    const row = await db.produtoImagem.findUnique({ where: { id: imagemId } });
    if (!row || row.removidaEm || row.tentativaId !== tentativaId || row.status !== "PROCESSANDO") return;
    const prefix = attemptPrefix(row.empresaId,row.produtoId,row.id,tentativaId);
    try {
      const source = await storage.read(row.uploadKey,row.etagUpload);
      if (source.length !== row.tamanhoEsperado) throw new PhotoValidationError("O tamanho do arquivo não corresponde ao envio.");
      const result = await processImage(source);
      const formats: Record<string, { key: string; width: number; mime: string }> = {};
      await storage.put(prefix + "original-" + result.hash, source, row.tipoInformado);
      for (const file of result.files) {
        const extension = file.variant.split(".").pop();
        const key = prefix + result.hash + "-" + file.width + "." + extension;
        await storage.put(key,file.buffer,file.mime);
        formats[file.variant] = { key, width: file.width, mime: file.mime };
      }
      await db.$transaction(async tx => {
        await lockProduct(tx,row.empresaId,row.produtoId);
        const current = await tx.produtoImagem.findUnique({ where: { id: imagemId } });
        if (!current || current.removidaEm || current.tentativaId !== tentativaId || current.status !== "PROCESSANDO") { if (current && current.prefixoAtual !== prefix) await retain(tx,current,prefix,3600000); return; }
        if (current.prefixoAtual && current.prefixoAtual !== prefix) await retain(tx,current,current.prefixoAtual);
        await tx.produtoImagem.update({ where: { id: imagemId }, data: { status: "PRONTA", hash: result.hash, larguraOrig: result.width, alturaOrig: result.height, blurDataUrl: result.blurDataUrl, alt: current.altPendente ?? current.alt, altPendente: null, prefixoAtual: prefix, formatos: formats, mensagem: null } });
        await tx.produto.update({ where: { id: row.produtoId }, data: { galeriaVersao: { increment: 1 } } });
        await tx.auditLog.create({ data: { empresaId: row.empresaId, entidade: "ProdutoImagem", entidadeId: row.id, acao: "PROCESSAR_IMAGEM", dados: { hash: result.hash, largura: result.width, altura: result.height } } });
      });
    } catch (error) {
      if (error instanceof PhotoValidationError) { await fail(imagemId,tentativaId,error.message); throw new UnrecoverableError(error.message); }
      throw error;
    }
  }, { connection: redisConnection(true), prefix: queuePrefix(), concurrency: 1, lockDuration: 120000, autorun: options.process !== false });
  worker.on("error", () => { console.error("Falha de conexão no worker de imagens; haverá nova tentativa."); });
  worker.on("failed", (job, error) => {
    if (job && (job.attemptsMade >= (job.opts.attempts ?? 1) || error instanceof UnrecoverableError)) void fail(job.data.imagemId,job.data.tentativaId,"Não foi possível processar a foto. Tente enviar novamente.").catch(() => {});
  });
  let reconciling = false; let cleaning = false; let closing = false;
  async function reconcile() {
    if (reconciling || closing) return; reconciling = true;
    try {
      const rows = await db.produtoImagem.findMany({ where: { status: "PROCESSANDO", removidaEm: null }, orderBy: { updatedAt: "asc" }, take: 50 });
      for (const row of rows) {
        const job = await queue.getJob("foto-" + row.id + "-" + row.tentativaId);
        const state = await job?.getState();
        if (state === "failed") { await fail(row.id,row.tentativaId,"Não foi possível processar a foto. Tente enviar novamente."); continue; }
        if (state === "completed") await job?.remove();
        await enqueuePhoto(queue,row.id,row.tentativaId);
      }
    } finally { reconciling = false; }
  }
  async function cleanup() {
    if (cleaning || closing) return; cleaning = true;
    try {
      const expired = await db.produtoImagem.findMany({ where: { status: "AGUARDANDO_UPLOAD", removidaEm: null, tentativaEm: { lte: new Date(Date.now() - PHOTO_UPLOAD_TIMEOUT_MS) } }, take: 30 });
      for (const image of expired) await db.$transaction(async tx => {
        await lockProduct(tx,image.empresaId,image.produtoId);
        const changed = await tx.produtoImagem.updateMany({ where: { id: image.id, status: "AGUARDANDO_UPLOAD", tentativaId: image.tentativaId, removidaEm: null }, data: { status: "ERRO", mensagem: "O envio expirou. Envie a foto novamente.", altPendente: null } });
        if (changed.count) {
          await retain(tx,image,attemptPrefix(image.empresaId,image.produtoId,image.id,image.tentativaId),3600000);
          await tx.produto.update({ where: { id: image.produtoId }, data: { galeriaVersao: { increment: 1 } } });
        }
      });
      const uploads = await db.produtoImagem.findMany({ where: { uploadLimpoEm: null, status: { in: ["PRONTA","ERRO"] }, tentativaEm: { lte: new Date(Date.now() - PHOTO_UPLOAD_TIMEOUT_MS) } }, take: 50 });
      for (const image of uploads) {
        await storage.removeUpload(image.uploadKey);
        await db.produtoImagem.updateMany({ where: { id: image.id, tentativaId: image.tentativaId }, data: { uploadLimpoEm: new Date() } });
      }
      const obsolete = await db.imagemLimpeza.findMany({ where: { concluidaEm: null, excluirApos: { lte: new Date() } }, take: 30 });
      for (const item of obsolete) {
        const image = await db.produtoImagem.findUniqueOrThrow({ where: { id: item.imagemId } });
        const root = photoRoot(image.empresaId,image.produtoId,image.id);
        const pending = ["AGUARDANDO_UPLOAD","PROCESSANDO"].includes(image.status) ? attemptPrefix(image.empresaId,image.produtoId,image.id,image.tentativaId) : null;
        if (!item.prefixo.startsWith(root + "tentativas/") || item.prefixo === image.prefixoAtual || item.prefixo === pending) continue;
        await storage.removePrefix(item.prefixo);
        await db.imagemLimpeza.update({ where: { id: item.id }, data: { concluidaEm: new Date() } });
      }
      const removed = await db.produtoImagem.findMany({ where: { removidaEm: { lte: new Date(Date.now() - PHOTO_RETENTION_MS) }, arquivosRemovidosEm: null }, take: 30 });
      for (const image of removed) {
        const claimed = await db.$transaction(async tx => {
          await lockProduct(tx,image.empresaId,image.produtoId);
          return tx.produtoImagem.updateMany({ where: { id: image.id, removidaEm: { lte: new Date(Date.now() - PHOTO_RETENTION_MS) }, arquivosRemovidosEm: null }, data: { limpezaIniciadaEm: new Date() } });
        });
        if (!claimed.count) continue;
        await storage.removePrefix(photoRoot(image.empresaId,image.produtoId,image.id));
        await db.produtoImagem.update({ where: { id: image.id }, data: { arquivosRemovidosEm: new Date() } });
      }
    } finally { cleaning = false; }
  }
  const intervals: ReturnType<typeof setInterval>[] = [];
  if (options.timers !== false) {
    intervals.push(setInterval(() => void reconcile().catch(() => console.error("Reconciliação de imagens será repetida.")),15000));
    intervals.push(setInterval(() => void cleanup().catch(() => console.error("Limpeza de imagens será repetida.")),60000));
    void reconcile().catch(() => {});
    void cleanup().catch(() => {});
  }
  return { worker, queue, reconcile, cleanup, async close() { closing = true; for (const interval of intervals) clearInterval(interval); await worker.close(); while (reconciling || cleaning) await new Promise(resolve => setTimeout(resolve,50)); await queue.close(); } };
}
