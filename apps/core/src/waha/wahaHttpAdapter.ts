import type {
  WhatsAppAdapter,
  WahaQrInfo,
  WahaSessionInfo,
} from "./adapter.js";

/**
 * Adapter HTTP do WAHA (engine GOWS). Isolado: o resto do core só conhece
 * `WhatsAppAdapter`. Trocar para Cloud API oficial = novo arquivo aqui.
 */
export function createWahaHttpAdapter(options: {
  apiUrl: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): WhatsAppAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.apiUrl.replace(/\/$/, "");

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { "X-Api-Key": options.apiKey } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`waha_http_${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  }

  function toInfo(data: unknown, fallbackName: string): WahaSessionInfo {
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      name: typeof d.name === "string" ? d.name : fallbackName,
      status: typeof d.status === "string" ? d.status : "desconhecido",
      phone: typeof d.phone === "string" ? d.phone : null,
    };
  }

  return {
    kind: "waha-gows",

    async createSession(name: string): Promise<WahaSessionInfo> {
      const data = await call("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      return toInfo(data, name);
    },

    async getStatus(name: string): Promise<WahaSessionInfo> {
      const data = await call(`/api/sessions/${encodeURIComponent(name)}`);
      return toInfo(data, name);
    },

    async getQr(name: string): Promise<WahaQrInfo> {
      const data = (await call(
        `/api/${encodeURIComponent(name)}/auth/qr?format=image`,
      )) as Record<string, unknown> | null;
      return {
        qr:
          typeof data?.qr === "string"
            ? data.qr
            : typeof data?.data === "string"
              ? data.data
              : null,
        status: typeof data?.status === "string" ? data.status : "qr",
      };
    },

    async reconnect(name: string): Promise<WahaSessionInfo> {
      const data = await call(
        `/api/sessions/${encodeURIComponent(name)}/restart`,
        { method: "POST" },
      );
      return toInfo(data, name);
    },

    async logout(name: string): Promise<void> {
      await call(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
    },
  };
}
