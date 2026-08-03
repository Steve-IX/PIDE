import type * as Monaco from "monaco-editor";
import { buildFimContext } from "./astParser";
import { buildQwenFimPrompt, llamaCppFimCompletion } from "./llamaCpp";
import type { AppSettings, InferenceBackend } from "../types";

export interface GhostTextContext {
  settings: AppSettings;
  /** Active buffer absolute path (cache key). */
  activePath: string | null;
}

type GetContext = () => GhostTextContext;

const EMPTY: Monaco.languages.InlineCompletions = { items: [] };

function monacoTokenToAbort(token: Monaco.CancellationToken): AbortController {
  const ac = new AbortController();
  if (token.isCancellationRequested) {
    ac.abort();
  } else {
    token.onCancellationRequested(() => ac.abort());
  }
  return ac;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(() => resolve(), ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function offsetAt(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): number {
  return model.getOffsetAt(position);
}

/**
 * Register Monaco inline (ghost text) completions for all languages.
 * Returns a disposable; call once from EditorPane onMount.
 */
export function registerGhostTextProvider(
  monaco: typeof Monaco,
  getContext: GetContext,
): Monaco.IDisposable {
  return monaco.languages.registerInlineCompletionsProvider("*", {
      disposeInlineCompletions() {
        /* no-op */
      },
      async provideInlineCompletions(model, position, _context, token) {
        const { settings, activePath } = getContext();
        if (!settings.ghostTextEnabled) return EMPTY;
        if ((settings.inferenceBackend as InferenceBackend) !== "llamaCpp") return EMPTY;

        const ac = monacoTokenToAbort(token);
        const debounce = Math.max(0, settings.ghostTextDebounceMs ?? 150);
        const nPredict = Math.max(8, Math.min(128, settings.ghostTextMaxPredict ?? 64));

        try {
          if (debounce > 0) {
            await sleep(debounce, ac.signal);
          }
          if (token.isCancellationRequested) return EMPTY;

          const text = model.getValue();
          const cursorOffset = offsetAt(model, position);
          const languageId = model.getLanguageId();
          const bufferKey = activePath || model.uri.toString();

          const fim = await buildFimContext({
            bufferKey,
            languageId,
            text,
            cursorOffset,
          });
          if (token.isCancellationRequested) return EMPTY;

          const prompt = buildQwenFimPrompt(fim.prefix, fim.suffix);
          const insertText = await llamaCppFimCompletion({
            baseUrl: settings.llamaCppBaseUrl,
            prompt,
            signal: ac.signal,
            nPredict,
            temperature: 0.15,
          });

          if (!insertText || token.isCancellationRequested) return EMPTY;

          return {
            items: [
              {
                insertText,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                ),
              },
            ],
          };
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return EMPTY;
          if (ac.signal.aborted || token.isCancellationRequested) return EMPTY;
          return EMPTY;
        }
      },
  });
}
