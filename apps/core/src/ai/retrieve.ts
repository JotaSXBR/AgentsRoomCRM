import type { AiKnowledgeChunkRecord } from "../stores/store.js";

export interface RetrievedChunk {
  chunk: AiKnowledgeChunkRecord;
  score: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function termsOf(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9@._-]+/)
    .filter((t) => t.length > 2);
}

/**
 * Score léxico simples (sem dependência externa): soma das frequências
 * relativas dos termos da pergunta no chunk, normalizado pela raiz do
 * tamanho do chunk. Determinístico — testes não dependem de embeddings.
 */
export function retrieveTopChunks(
  question: string,
  chunks: AiKnowledgeChunkRecord[],
  topK: number,
): RetrievedChunk[] {
  const queryTerms = termsOf(question);
  if (queryTerms.length === 0) return [];
  const scored = chunks.map((chunk) => {
    const chunkTerms = termsOf(chunk.content);
    if (chunkTerms.length === 0) return { chunk, score: 0 };
    const freq = new Map<string, number>();
    for (const t of chunkTerms) freq.set(t, (freq.get(t) ?? 0) + 1);
    let hit = 0;
    for (const t of queryTerms) hit += freq.get(t) ?? 0;
    const score = hit / Math.sqrt(chunkTerms.length) / queryTerms.length;
    return { chunk, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

