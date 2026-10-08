import type { MetaAdapter, MetaPageInfo } from "./adapter.js";

/**
 * Adapter HTTP da Meta oficial (Graph API v21+). Isolado: o resto do core só
 * conhece `MetaAdapter`. `fetchImpl` injetável para testes (sem rede).
 *
 * Endpoints usados (todos versionados):
 * - GET    /{api-version}/dialog/oauth (montado como URL, fluxo no browser)
 * - GET    /{api-version}/oauth/access_token (troca do code)
 * - GET    /{api-version}/me/accounts (Páginas do usuário)
 * - GET    /{api-version}/{page-id}?fields=instagram_business_account
 * - POST   /{api-version}/me/messages (Send API Messenger + Instagram)
 */
export function createMetaHttpAdapter(options: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}): MetaAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const version = (options.apiVersion ?? "v21.0").replace(/^\/?/, "");
  const graph = `https://graph.facebook.com/${version}`;
  const OAUTH_SCOPES = [
    "pages_show_list",
    "pages_messaging",
    "instagram_basic",
    "instagram_manage_messages",
  ].join(",");

  async function callJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetchImpl(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message =
        typeof data?.error === "object" && data?.error !== null
          ? JSON.stringify(data.error).slice(0, 300)
          : `http_${res.status}`;
      throw new Error(`meta_graph_falhou: ${message}`);
    }
    return data ?? {};
  }

  return {
    kind: "meta-graph",

    buildOAuthUrl(input: { workspaceId: string }): string {
      const params = new URLSearchParams({
        client_id: options.appId,
        redirect_uri: options.redirectUri,
        scope: OAUTH_SCOPES,
        response_type: "code",
        state: input.workspaceId,
      });
      return `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`;
    },

    async exchangeCode(input: { code: string; redirectUri: string }) {
      const params = new URLSearchParams({
        client_id: options.appId,
        client_secret: options.appSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
      });
      const data = await callJson(`${graph}/oauth/access_token?${params.toString()}`);
      return {
        accessToken: String(data.access_token ?? ""),
        expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
      };
    },

    async listPages(input: { userAccessToken: string }): Promise<MetaPageInfo[]> {
      const params = new URLSearchParams({
        access_token: input.userAccessToken,
        fields: "id,name,access_token",
        limit: "50",
      });
      const data = await callJson(`${graph}/me/accounts?${params.toString()}`);
      const list = Array.isArray(data.data) ? data.data : [];
      return list
        .filter(
          (p): p is Record<string, unknown> =>
            typeof p === "object" && p !== null && typeof (p as { id?: unknown }).id === "string",
        )
        .map((p) => ({
          pageId: String(p.id),
          pageName: typeof p.name === "string" ? p.name : String(p.id),
          pageAccessToken: typeof p.access_token === "string" ? p.access_token : "",
        }))
        .filter((p) => p.pageAccessToken !== "");
    },

    async getLinkedInstagram(input: {
      pageId: string;
      pageAccessToken: string;
    }): Promise<string | null> {
      const params = new URLSearchParams({
        access_token: input.pageAccessToken,
        fields: "instagram_business_account",
      });
      const data = await callJson(
        `${graph}/${encodeURIComponent(input.pageId)}?${params.toString()}`,
      );
      const linked = data.instagram_business_account as { id?: unknown } | undefined;
      return linked && typeof linked.id === "string" ? linked.id : null;
    },

    async sendText(input: {
      channel: "messenger" | "instagram";
      pageAccessToken: string;
      recipientId: string;
      text: string;
    }): Promise<{ externalId: string }> {
      const params = new URLSearchParams({ access_token: input.pageAccessToken });
      const data = await callJson(`${graph}/me/messages?${params.toString()}`, {
        method: "POST",
        body: JSON.stringify({
          recipient: { id: input.recipientId },
          messaging_type: "RESPONSE",
          message: { text: input.text },
        }),
      });
      const externalId =
        typeof data.message_id === "string"
          ? data.message_id
          : `meta_${Date.now().toString(36)}`;
      return { externalId };
    },
  };
}
