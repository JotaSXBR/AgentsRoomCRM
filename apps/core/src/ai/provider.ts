import type { AiProviderKind } from "../stores/store.js";

export interface AiChatInput {
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}

export interface AiChatResult {
  answer: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type AiChatCaller = (input: AiChatInput) => Promise<AiChatResult>;

const DEFAULT_TIMEOUT_MS = 20_000;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`IA ${response.status}: ${text.slice(0, 200)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function requireAnswer(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("ia_resposta_vazia");
  }
  return value.trim();
}

function chatMessages(input: AiChatInput): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.userPrompt },
  ];
}

async function chatOpenAiCompatible(input: AiChatInput): Promise<AiChatResult> {
  const headers: Record<string, string> = {};
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
  const data = (await postJson(
    joinUrl(input.baseUrl, "/chat/completions"),
    headers,
    { model: input.model, temperature: 0.2, messages: chatMessages(input) },
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )) as any;
  return {
    answer: requireAnswer(data?.choices?.[0]?.message?.content),
    inputTokens: numberOrNull(data?.usage?.prompt_tokens),
    outputTokens: numberOrNull(data?.usage?.completion_tokens),
  };
}

async function chatOllama(input: AiChatInput): Promise<AiChatResult> {
  const data = (await postJson(
    joinUrl(input.baseUrl, "/api/chat"),
    {},
    { model: input.model, stream: false, messages: chatMessages(input) },
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )) as any;
  return {
    answer: requireAnswer(data?.message?.content),
    inputTokens: numberOrNull(data?.prompt_eval_count),
    outputTokens: numberOrNull(data?.eval_count),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Caller padrão: OpenAI-compatível ou Ollama local, via fetch. */
export const defaultAiChatCaller: AiChatCaller = async (input) => {
  if (input.kind === "ollama") return chatOllama(input);
  return chatOpenAiCompatible(input);
};
