export function adminOrigin() {
  const origin = process.env.ADMIN_ORIGIN ?? "http://127.0.0.1:3001";
  const parsed = new URL(origin);
  if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) throw new Error("ADMIN_ORIGIN inválida");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") throw new Error("ADMIN_ORIGIN exige HTTPS em produção");
  return origin;
}
export function cookieName() { return process.env.NODE_ENV === "production" ? "__Host-loja_session" : "loja_session"; }
export const SESSION_SECONDS = 8 * 60 * 60;
export const PASSWORD_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 1 };
