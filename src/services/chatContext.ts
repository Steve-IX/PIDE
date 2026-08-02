import type { ChatMessage } from "../types";
import type { OllamaChatMessage } from "./ollama";
import { SYSTEM_PROMPT } from "./ollama";

const OLD_ASSISTANT_SOFT_CAP = 2500;

/** Prefer head+tail for large files so both imports and ending stay visible. */
export function clipFileContent(
  content: string,
  maxChars: number,
  cursorOffset?: number | null,
): string {
  if (content.length <= maxChars) return content;

  // Window around cursor when available
  if (cursorOffset != null && cursorOffset >= 0 && cursorOffset <= content.length) {
    const half = Math.floor(maxChars / 2);
    let start = Math.max(0, cursorOffset - half);
    let end = Math.min(content.length, start + maxChars);
    start = Math.max(0, end - maxChars);
    const slice = content.slice(start, end);
    const prefix = start > 0 ? "/* …truncated above… */\n" : "";
    const suffix = end < content.length ? "\n/* …truncated below… */" : "";
    return `${prefix}${slice}${suffix}`;
  }

  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head - 40;
  return (
    `${content.slice(0, head)}\n\n/* …truncated middle (${content.length - maxChars} chars)… */\n\n` +
    content.slice(content.length - Math.max(tail, 0))
  );
}

function truncateOldAssistant(content: string): string {
  if (content.length <= OLD_ASSISTANT_SOFT_CAP) return content;
  return (
    `${content.slice(0, OLD_ASSISTANT_SOFT_CAP)}\n\n` +
    `_(earlier reply truncated for speed — ${content.length - OLD_ASSISTANT_SOFT_CAP} chars omitted)_`
  );
}

/**
 * Build the Ollama message list: system + last N history turns + current user turn.
 * Older assistant messages are truncated so huge code dumps do not dominate prefill.
 */
export function buildChatMessages(args: {
  priorMessages: ChatMessage[];
  userContent: string;
  maxHistoryMessages: number;
}): OllamaChatMessage[] {
  const { priorMessages, userContent, maxHistoryMessages } = args;
  const n = Math.max(2, maxHistoryMessages);
  const windowed = priorMessages.slice(-n);

  const history: OllamaChatMessage[] = windowed.map((m, i) => {
    const isLastAssistant =
      m.role === "assistant" && i === windowed.length - 1;
    const content =
      m.role === "assistant" && !isLastAssistant
        ? truncateOldAssistant(m.content)
        : m.content;
    return { role: m.role as "user" | "assistant", content };
  });

  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userContent },
  ];
}

export function formatActiveFileContext(
  path: string,
  language: string,
  content: string,
  maxChars: number,
  cursorOffset?: number | null,
): string {
  const clipped = clipFileContent(content, maxChars, cursorOffset);
  return `Active file: ${path}\n\n\`\`\`${language}\n${clipped}\n\`\`\``;
}

export function formatMentionedFileContext(
  path: string,
  content: string,
  maxChars: number,
): string {
  const clipped = clipFileContent(content, maxChars);
  return `Mentioned file: ${path}\n\`\`\`\n${clipped}\n\`\`\``;
}
