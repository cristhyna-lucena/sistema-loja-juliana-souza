import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MAX_PHOTO_BYTES, PHOTO_UPLOAD_EXPIRES_SECONDS } from "@sistema/shared";
export class PhotoValidationError extends Error {}
export function photoRoot(empresaId: string, produtoId: string, imagemId: string) {
  for (const value of [empresaId, produtoId, imagemId]) if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error("Identificador de arquivo inválido.");
  return `empresas/${empresaId}/produtos/${produtoId}/imagens/${imagemId}/`;
}
export function attemptPrefix(empresaId: string, produtoId: string, imagemId: string, tentativa: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tentativa)) throw new Error("Tentativa inválida.");
  return photoRoot(empresaId, produtoId, imagemId) + "tentativas/" + tentativa + "/";
}
export class MediaStorage {
  readonly bucket = process.env.S3_MEDIA_BUCKET ?? "sistema-loja-media";
  readonly client: S3Client;
  private ready?: Promise<void>;
  constructor() {
    if (!process.env.MINIO_ROOT_USER || !process.env.MINIO_ROOT_PASSWORD) throw new Error("Configure o armazenamento de imagens.");
    this.client = new S3Client({ endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:19000", region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.MINIO_ROOT_USER, secretAccessKey: process.env.MINIO_ROOT_PASSWORD }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 } });
  }
  async ensureBucket() {
    if (!this.ready) this.ready = (async () => {
      try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }
      catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
        try { await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })); }
        catch (error) { if ((error as { name?: string }).name !== "BucketAlreadyOwnedByYou") throw error; }
      }
    })().catch(error => { this.ready = undefined; throw error; });
    await this.ready;
  }
  async presign(key: string, size: number, contentType: string) {
    await this.ensureBucket();
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentLength: size, ContentType: contentType }), { expiresIn: PHOTO_UPLOAD_EXPIRES_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) });
  }
  async head(key: string) { return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); }
  async read(key: string, etag?: string | null) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(etag ? { IfMatch: etag } : {}) }));
    if (!response.Body || (response.ContentLength ?? 0) > MAX_PHOTO_BYTES) throw new PhotoValidationError("A imagem excede o limite de 15 MB.");
    const buffers: Buffer[] = []; let size = 0;
    try { for await (const chunk of response.Body as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > MAX_PHOTO_BYTES) throw new PhotoValidationError("A imagem excede o limite de 15 MB."); buffers.push(Buffer.from(chunk)); } }
    catch (error) { (response.Body as { destroy?: () => void }).destroy?.(); throw error; }
    return Buffer.concat(buffers);
  }
  async put(key: string, body: Buffer, contentType: string) { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentLength: body.length, ContentType: contentType, CacheControl: "private, no-store" })); }
  async object(key: string) { return this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); }
  async removeUpload(key: string) {
    if (!key.endsWith("/entrada") || !key.startsWith("empresas/")) throw new Error("Arquivo temporário inválido.");
    const result = await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: [{ Key: key }], Quiet: true } }));
    if (result.Errors?.length) throw new Error("Não foi possível limpar o envio temporário.");
  }
  async removePrefix(prefix: string) {
    if (!/^empresas\/[A-Za-z0-9_-]+\/produtos\/[A-Za-z0-9_-]+\/imagens\/[A-Za-z0-9_-]+\/(?:tentativas\/[A-Za-z0-9_-]+\/)?$/.test(prefix)) throw new Error("Prefixo de limpeza inválido.");
    let token: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const objects = (response.Contents ?? []).flatMap(item => item.Key ? [{ Key: item.Key }] : []);
      if (objects.length) {
        const removed = await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects, Quiet: true } }));
        if (removed.Errors?.length) throw new Error("Não foi possível concluir a limpeza dos arquivos.");
      }
      token = response.NextContinuationToken;
    } while (token);
  }
  close() { this.client.destroy(); }
}
