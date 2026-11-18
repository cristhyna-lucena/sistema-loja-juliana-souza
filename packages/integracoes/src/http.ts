export class IntegrationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super("Falha na integração " + provider + " (" + status + ").");
  }
}
export async function requestJson<T>(
  provider: string,
  url: string | URL,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new IntegrationError(provider, 503, true);
  }
  if (!response.ok)
    throw new IntegrationError(
      provider,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new IntegrationError(provider, 502, true);
  }
}
export function secret(name: string) {
  const value = process.env[name];
  if (!value) throw new IntegrationError(name, 503, false);
  return value;
}
export function basic(token: string) {
  return "Basic " + Buffer.from(token + ":").toString("base64");
}
