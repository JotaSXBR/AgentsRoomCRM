/**
 * Chunking determinístico de documentos/FAQ: quebra por parágrafos e
 * consolida até ~600 chars por chunk, preservando frases inteiras.
 */
function splitLongParagraph(paragraph: string, maxLen: number): string[] {
  const parts: string[] = [];
  let part = "";
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    if (`${part} ${sentence}`.trim().length > maxLen && part) {
      parts.push(part.trim());
      part = sentence;
    } else {
      part = `${part} ${sentence}`.trim();
    }
  }
  if (part) parts.push(part);
  return parts;
}

export function chunkText(text: string, maxLen = 600): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}|\n(?=[-*•]|\d+[.)])/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer) {
      chunks.push(buffer);
      buffer = "";
    }
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLen) {
      flush();
      chunks.push(...splitLongParagraph(paragraph, maxLen));
      continue;
    }
    if (`${buffer}\n${paragraph}`.length > maxLen && buffer) {
      flush();
      buffer = paragraph;
    } else {
      buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
    }
  }
  flush();
  return chunks;
}
