import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@sistema/db";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_RETENTION_MS, PHOTO_UPLOAD_TIMEOUT_MS, PHOTO_UPLOAD_EXPIRES_SECONDS, PHOTO_VARIANTS, type FotoDTO, type GaleriaDTO, type FotoInicio, type PhotoVariant } from "@sistema/shared";
import { MediaStorage, createPhotoQueue, enqueuePhoto, attemptPrefix, lockProduct } from "@sistema/media";
import { DatabaseService } from "../database.service";
import type { Identity } from "../auth/auth.service";
type Image = Prisma.ProdutoImagemGetPayload<{}>;
@Injectable()
export class FotosService implements OnModuleDestroy {
  private storage?: MediaStorage;
  private queue?: ReturnType<typeof createPhotoQueue>;
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  private files() { try { return this.storage ??= new MediaStorage(); } catch { throw new ServiceUnavailableException("Armazenamento de fotos indisponível."); } }
  async onModuleDestroy() { if (this.queue) await this.queue.close(); this.storage?.close(); }
  private async product(empresaId: string, produtoId: string, tx: Prisma.TransactionClient | PrismaClient = this.db.client) {
    const product = await tx.produto.findFirst({ where: { id: produtoId, empresaId } }); if (!product) throw new NotFoundException("Produto não encontrado."); return product;
  }
  private async image(empresaId: string, produtoId: string, id: string, tx: Prisma.TransactionClient | PrismaClient = this.db.client, removed = false) {
    const image = await tx.produtoImagem.findFirst({ where: { id, empresaId, produtoId, ...(removed ? {} : { removidaEm: null }) } });
    if (!image) throw new NotFoundException("Foto não encontrada."); return image;
  }
  private dto(image: Image): FotoDTO {
    return { id: image.id, alt: image.alt, ordem: image.ordem, status: image.status, temFoto: !!image.hash, hash: image.hash, blurDataUrl: image.blurDataUrl, larguraOrig: image.larguraOrig, alturaOrig: image.alturaOrig, mensagem: image.mensagem, removidaEm: image.removidaEm?.toISOString() ?? null, restauravelAte: image.removidaEm && !image.limpezaIniciadaEm && !image.arquivosRemovidosEm && image.removidaEm.getTime() + PHOTO_RETENTION_MS > Date.now() ? new Date(image.removidaEm.getTime() + PHOTO_RETENTION_MS).toISOString() : null };
  }
  private async audit(tx: Prisma.TransactionClient, user: Identity, id: string, acao: string, dados: Prisma.InputJsonObject = {}) {
    await tx.auditLog.create({ data: { empresaId: user.empresaId, usuarioId: user.id, entidade: "ProdutoImagem", entidadeId: id, acao, dados } });
  }
  private version(actual: number, expected: number) { if (actual !== expected) throw new ConflictException({ code: "GALLERY_CONFLICT", message: "As fotos foram alteradas. Atualize a galeria e tente novamente." }); }
  async list(empresaId: string, produtoId: string): Promise<GaleriaDTO> {
    const product = await this.product(empresaId,produtoId);
    const images = await this.db.client.produtoImagem.findMany({ where: { empresaId, produtoId, OR: [{ removidaEm: null }, { removidaEm: { gt: new Date(Date.now() - PHOTO_RETENTION_MS) }, limpezaIniciadaEm: null, arquivosRemovidosEm: null }] }, orderBy: [{ ordem: "asc" }, { id: "asc" }] });
    return { versao: product.galeriaVersao, imagens: images.filter(image => !image.removidaEm).map(image => this.dto(image)), removidas: images.filter(image => !!image.removidaEm).map(image => this.dto(image)) };
  }
  async begin(user: Identity, produtoId: string, input: FotoInicio) {
    await this.product(user.empresaId,produtoId);
    const storage = this.files();
    try { await storage.ensureBucket(); } catch { throw new ServiceUnavailableException("Armazenamento de fotos indisponível."); }
    const id = input.substituirId ?? randomUUID();
    const tentativaId = randomUUID();
    const key = attemptPrefix(user.empresaId,produtoId,id,tentativaId) + "entrada";
    const url = await storage.presign(key,input.tamanho,input.mimeTipo);
    await this.db.client.$transaction(async tx => {
      await lockProduct(tx,user.empresaId,produtoId);
      if (input.substituirId) {
        const current = await this.image(user.empresaId,produtoId,id,tx);
        if (["AGUARDANDO_UPLOAD","PROCESSANDO"].includes(current.status)) throw new ConflictException("Há um envio em andamento para esta foto. Aguarde ou cancele o envio.");
        const previous = attemptPrefix(current.empresaId,current.produtoId,current.id,current.tentativaId);
        if (previous !== current.prefixoAtual) await tx.imagemLimpeza.upsert({ where: { prefixo: previous }, create: { empresaId: current.empresaId, imagemId: id, prefixo: previous, excluirApos: new Date(Date.now()+3600000) }, update: {} });
        await tx.produtoImagem.update({ where: { id }, data: { tentativaId, uploadKey: key, tamanhoEsperado: input.tamanho, tipoInformado: input.mimeTipo, altPendente: input.alt, tentativaEm: new Date(), status: "AGUARDANDO_UPLOAD", mensagem: null, etagUpload: null, uploadLimpoEm: null } });
      } else {
        const active = await tx.produtoImagem.findMany({ where: { empresaId: user.empresaId, produtoId, removidaEm: null }, select: { ordem: true } });
        if (active.length >= MAX_PHOTOS) throw new ConflictException("O produto já tem oito fotos. Remova uma foto ou use Trocar arquivo.");
        await tx.produtoImagem.create({ data: { id, empresaId: user.empresaId, produtoId, alt: input.alt, ordem: Math.max(-1,...active.map(image => image.ordem)) + 1, tentativaId, uploadKey: key, tamanhoEsperado: input.tamanho, tipoInformado: input.mimeTipo } });
      }
      await tx.produto.update({ where: { id: produtoId }, data: { galeriaVersao: { increment: 1 } } });
      await this.audit(tx,user,id,input.substituirId ? "INICIAR_TROCA_FOTO" : "INICIAR_ENVIO_FOTO");
    });
    return { id, url, expiresEm: new Date(Date.now() + PHOTO_UPLOAD_EXPIRES_SECONDS * 1000).toISOString() };
  }
  async confirm(user: Identity, produtoId: string, id: string) {
    const initial = await this.image(user.empresaId,produtoId,id);
    if (initial.status === "PRONTA") return this.dto(initial);
    if (!["AGUARDANDO_UPLOAD","PROCESSANDO"].includes(initial.status)) throw new BadRequestException("Inicie um novo envio para esta foto.");
    if (initial.status === "AGUARDANDO_UPLOAD" && initial.tentativaEm.getTime() + PHOTO_UPLOAD_TIMEOUT_MS < Date.now()) throw new BadRequestException("O envio expirou. Cancele e envie novamente.");
    if (initial.status === "AGUARDANDO_UPLOAD") {
      let head;
      try { head = await this.files().head(initial.uploadKey); } catch { throw new BadRequestException("O arquivo ainda não foi recebido. Tente concluir o envio novamente."); }
      if (!head.ContentLength || head.ContentLength > MAX_PHOTO_BYTES || head.ContentLength !== initial.tamanhoEsperado || !head.ETag) throw new BadRequestException("O tamanho do arquivo não corresponde ao envio.");
      await this.db.client.$transaction(async tx => {
        await lockProduct(tx,user.empresaId,produtoId);
        const row = await this.image(user.empresaId,produtoId,id,tx);
        if (row.tentativaId !== initial.tentativaId) throw new ConflictException("Há um envio mais recente para esta foto.");
        if (row.status === "PROCESSANDO" || row.status === "PRONTA") return;
        if (row.status !== "AGUARDANDO_UPLOAD") throw new ConflictException("Este envio foi cancelado.");
        await tx.produtoImagem.update({ where: { id }, data: { status: "PROCESSANDO", etagUpload: head.ETag } });
        await tx.produto.update({ where: { id: produtoId }, data: { galeriaVersao: { increment: 1 } } });
        await this.audit(tx,user,id,"CONFIRMAR_ENVIO_FOTO");
      });
    }
    // O estado PROCESSANDO é a pendência durável. O worker reconcilia se a fila estiver indisponível.
    try { this.queue ??= createPhotoQueue(); await enqueuePhoto(this.queue,id,initial.tentativaId); } catch {}
    return this.dto(await this.image(user.empresaId,produtoId,id));
  }
  async reorder(user: Identity, produtoId: string, ids: string[], version: number) {
    await this.db.client.$transaction(async tx => {
      await lockProduct(tx,user.empresaId,produtoId);
      const product = await this.product(user.empresaId,produtoId,tx); this.version(product.galeriaVersao,version);
      const rows = await tx.produtoImagem.findMany({ where: { empresaId: user.empresaId, produtoId, removidaEm: null }, select: { id: true } });
      if (rows.length !== ids.length || rows.some(row => !ids.includes(row.id))) throw new BadRequestException("A ordem precisa conter todas as fotos atuais do produto.");
      for (const [ordem,id] of ids.entries()) await tx.produtoImagem.update({ where: { id }, data: { ordem } });
      await tx.produto.update({ where: { id: produtoId }, data: { galeriaVersao: { increment: 1 } } });
      await this.audit(tx,user,produtoId,"ORDENAR_FOTOS",{ ids });
    });
    return this.list(user.empresaId,produtoId);
  }
  async alt(user: Identity, produtoId: string, id: string, alt: string, version: number) {
    await this.db.client.$transaction(async tx => {
      await lockProduct(tx,user.empresaId,produtoId);
      const product = await this.product(user.empresaId,produtoId,tx); this.version(product.galeriaVersao,version);
      const row = await this.image(user.empresaId,produtoId,id,tx);
      await tx.produtoImagem.update({ where: { id }, data: { alt, ...(row.altPendente ? { altPendente: alt } : {}) } });
      await tx.produto.update({ where: { id: produtoId }, data: { galeriaVersao: { increment: 1 } } });
      await this.audit(tx,user,id,"ALTERAR_DESCRICAO_FOTO",{ antes: row.alt, depois: alt });
    });
    return this.list(user.empresaId,produtoId);
  }
  async remove(user: Identity, produtoId: string, id: string, version: number) {
    await this.db.client.$transaction(async tx => {
      await lockProduct(tx,user.empresaId,produtoId);
      const product = await this.product(user.empresaId,produtoId,tx); this.version(product.galeriaVersao,version);
      const row = await this.image(user.empresaId,produtoId,id,tx);
      const pendingPrefix = attemptPrefix(row.empresaId,row.produtoId,row.id,row.tentativaId);
      if (pendingPrefix !== row.prefixoAtual) await tx.imagemLimpeza.upsert({ where: { prefixo: pendingPrefix }, create: { empresaId: row.empresaId, imagemId: id, prefixo: pendingPrefix, excluirApos: new Date(Date.now()+3600000) }, update: {} });
      await tx.produtoImagem.update({ where: { id }, data: { removidaEm: new Date(), status: row.hash ? "PRONTA" : "ERRO", altPendente: null } });
      await tx.produto.update({ where: { id: produtoId }, data: { galeriaVersao: { increment: 1 } } });
      await this.audit(tx,user,id,"REMOVER_FOTO");
    });
    return this.list(user.empresaId,produtoId);
  }
  async restore(user: Identity, produtoId: string, id: string, version: number) {
    await this.db.client.$transaction(async tx => {
      await lockProduct(tx,user.empresaId,produtoId);
      const product = await this.product(user.empresaId,produtoId,tx); this.version(product.galeriaVersao,version);
      const row = await this.image(user.empresaId,produtoId,id,tx,true);
      if (!row.removidaEm || row.removidaEm.getTime() + PHOTO_RETENTION_MS <= Date.now() || row.limpezaIniciadaEm || row.arquivosRemovidosEm) throw new BadRequestException("Esta foto não está disponível para restauração.");
      const active = await tx.produtoImagem.findMany({ where: { empresaId: user.empresaId, produtoId, removidaEm: null }, select: { ordem: true } });
      if (active.length >= MAX_PHOTOS) throw new ConflictException("Remova uma das oito fotos antes de restaurar outra.");
      await tx.produtoImagem.update({ where: { id }, data: { removidaEm: null, ordem: Math.max(-1,...active.map(image => image.ordem)) + 1, status: row.hash ? "PRONTA" : "ERRO", mensagem: row.hash ? null : "Envie o arquivo novamente." } });
      await tx.produto.update({ where: { id: produtoId }, data: { galeriaVersao: { increment: 1 } } });
      await this.audit(tx,user,id,"RESTAURAR_FOTO");
    });
    return this.list(user.empresaId,produtoId);
  }
  async cancel(user: Identity, produtoId: string, id: string, version: number) {
    await this.db.client.$transaction(async tx => {
      await lockProduct(tx,user.empresaId,produtoId);
      const product = await this.product(user.empresaId,produtoId,tx); this.version(product.galeriaVersao,version);
      const row = await this.image(user.empresaId,produtoId,id,tx);
      if (!["AGUARDANDO_UPLOAD","PROCESSANDO"].includes(row.status)) throw new BadRequestException("Não há envio em andamento.");
      const prefixo = attemptPrefix(row.empresaId,row.produtoId,row.id,row.tentativaId);
      if (prefixo !== row.prefixoAtual) await tx.imagemLimpeza.upsert({ where: { prefixo }, create: { empresaId: row.empresaId, imagemId: id, prefixo, excluirApos: new Date(Date.now()+3600000) }, update: {} });
      await tx.produtoImagem.update({ where: { id }, data: { status: row.hash ? "PRONTA" : "ERRO", mensagem: row.hash ? null : "Envio cancelado. Envie o arquivo novamente.", altPendente: null } });
      await tx.produto.update({ where: { id: produtoId }, data: { galeriaVersao: { increment: 1 } } });
      await this.audit(tx,user,id,"CANCELAR_ENVIO_FOTO");
    });
    return this.list(user.empresaId,produtoId);
  }
  async file(empresaId: string, produtoId: string, id: string, variant: string) {
    if (!PHOTO_VARIANTS.includes(variant as PhotoVariant)) throw new NotFoundException("Versão da foto não encontrada.");
    const row = await this.image(empresaId,produtoId,id);
    const files = row.formatos as Record<string,{key:string;mime:string}> | null;
    const item = files?.[variant];
    if (!row.hash || !item || !row.prefixoAtual || !item.key.startsWith(row.prefixoAtual)) throw new NotFoundException("Foto ainda não disponível.");
    try { return { body: (await this.files().object(item.key)).Body, mime: item.mime }; }
    catch { throw new ServiceUnavailableException("Não foi possível carregar a foto."); }
  }
}
