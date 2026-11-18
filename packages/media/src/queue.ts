import { Queue, type ConnectionOptions } from "bullmq";
export const PHOTO_QUEUE = "imagens";
export function queuePrefix() { return process.env.MEDIA_QUEUE_PREFIX ?? "sistema-loja-media"; }
export function redisConnection(worker = false): ConnectionOptions {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL é obrigatória.");
  const url = new URL(process.env.REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username ? decodeURIComponent(url.username) : undefined, password: url.password ? decodeURIComponent(url.password) : undefined, db: Number(url.pathname.slice(1) || 0), ...(url.protocol === "rediss:" ? { tls: {} } : {}), maxRetriesPerRequest: worker ? null : 1, connectTimeout: 5000, ...(worker ? {} : { retryStrategy: () => null }) };
}
export function createPhotoQueue() {
  const queue = new Queue(PHOTO_QUEUE, { connection: redisConnection(), prefix: queuePrefix() });
  queue.on("error", () => {});
  return queue;
}
export async function enqueuePhoto(queue: Queue, imagemId: string, tentativaId: string) {
  await queue.add("processar", { imagemId, tentativaId }, { jobId: "foto-" + imagemId + "-" + tentativaId, attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } });
}
