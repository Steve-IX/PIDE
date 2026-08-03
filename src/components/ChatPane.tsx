import { useEffect, useMemo, useRef, useState } from "react";
import { useIdeStore } from "../stores/ideStore";
import { SYSTEM_PROMPT } from "../services/ollama";
import { unifiedChatStream, warmInferenceModel } from "../services/llmChat";
import {
  buildChatMessages,
  formatActiveFileContext,
  formatMentionedFileContext,
} from "../services/chatContext";
import { resolvePerfConfig } from "../services/perfProfiles";
import {
  enabledModelList,
  planMultitask,
  resolveChatModel,
  resolveRoleModel,
  systemPromptForMode,
  withSystem,
} from "../services/agentRouter";
import type { ChatMessage, ChatMode } from "../types";
import MarkdownMessage from "./MarkdownMessage";
import MultiApplyPanel from "./MultiApplyPanel";
import ChatComposer from "./chat/ChatComposer";
import TokSpeedPill from "./chat/TokSpeedPill";
import { lastCodeBlock } from "../utils/extractCode";
import { suggestFileName } from "../utils/extFromLang";
import { flattenFiles, fuzzyScore } from "../utils/tree";
import { fileName, readFile } from "../services/fs";
import { parseFileProposals } from "../utils/proposals";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function ChatPane() {
  const models = useIdeStore((s) => s.models);
  const selectedModel = useIdeStore((s) => s.selectedModel);
  const setSelectedModel = useIdeStore((s) => s.setSelectedModel);
  const ollamaOnline = useIdeStore((s) => s.ollamaOnline);
  const messages = useIdeStore((s) => s.messages);
  const setMessages = useIdeStore((s) => s.setMessages);
  const chatStreaming = useIdeStore((s) => s.chatStreaming);
  const setChatStreaming = useIdeStore((s) => s.setChatStreaming);
  const setLastTokensPerSec = useIdeStore((s) => s.setLastTokensPerSec);
  const refreshOllama = useIdeStore((s) => s.refreshOllama);
  const activePath = useIdeStore((s) => s.activePath);
  const tabs = useIdeStore((s) => s.tabs);
  const applyToActiveFile = useIdeStore((s) => s.applyToActiveFile);
  const toggleChat = useIdeStore((s) => s.toggleChat);
  const settings = useIdeStore((s) => s.settings);
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const setCreateFileDialog = useIdeStore((s) => s.setCreateFileDialog);
  const pushToast = useIdeStore((s) => s.pushToast);
  const tree = useIdeStore((s) => s.tree);
  const setFileProposals = useIdeStore((s) => s.setFileProposals);
  const chatSessions = useIdeStore((s) => s.chatSessions);
  const activeSessionId = useIdeStore((s) => s.activeSessionId);
  const newChatSession = useIdeStore((s) => s.newChatSession);
  const switchChatSession = useIdeStore((s) => s.switchChatSession);
  const updateSettings = useIdeStore((s) => s.updateSettings);
  const deleteChatSession = useIdeStore((s) => s.deleteChatSession);

  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [routeLabel, setRouteLabel] = useState<string | null>(null);
  const [agentProgress, setAgentProgress] = useState<string | null>(null);
  const [activeReplyModel, setActiveReplyModel] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const streamBufRef = useRef("");
  const streamFlushTimer = useRef<number | null>(null);
  const monacoEditor = useIdeStore((s) => s.monacoEditor);

  const active = tabs.find((t) => t.path === activePath);
  const files = useMemo(() => flattenFiles(tree), [tree]);
  const pickerModels = useMemo(
    () => enabledModelList(models, settings.enabledModels),
    [models, settings.enabledModels],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        updateSettings({ chatMode: "agent" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [updateSettings]);

  const mentionResults = useMemo(() => {
    if (mentionQuery === null) return [];
    return files
      .map((f) => ({
        path: f.path,
        name: fileName(f.path),
        score: fuzzyScore(mentionQuery, `${fileName(f.path)} ${f.path}`),
      }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [files, mentionQuery]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatStreaming]);

  function updateMentionState(value: string) {
    const at = value.lastIndexOf("@");
    if (at === -1) {
      setMentionQuery(null);
      return;
    }
    const after = value.slice(at + 1);
    if (/\s/.test(after)) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(after);
    setMentionIndex(0);
  }

  function insertMention(path: string) {
    const at = input.lastIndexOf("@");
    const name = fileName(path);
    const next = `${input.slice(0, at)}@${name} `;
    setInput(next);
    setMentionQuery(null);
  }

  async function collectMentionContexts(
    text: string,
    maxAttachChars: number,
  ): Promise<string> {
    if (!workspacePath) return "";
    const names = [...text.matchAll(/@([A-Za-z0-9_.\-]+)/g)].map((m) => m[1]);
    if (!names.length) return "";
    const perFile = Math.max(2000, Math.floor(maxAttachChars / Math.min(names.length, 3)));
    const chunks: string[] = [];
    for (const name of names.slice(0, 3)) {
      const match =
        files.find((f) => fileName(f.path).toLowerCase() === name.toLowerCase()) ||
        files.find((f) => f.path.toLowerCase().endsWith(name.toLowerCase()));
      if (!match) continue;
      try {
        const content = await readFile(workspacePath, match.path);
        chunks.push(formatMentionedFileContext(match.path, content, perFile));
      } catch {
        /* skip unreadable */
      }
    }
    return chunks.join("\n\n");
  }

  function flushStreamBuffer(assistantId: string) {
    if (streamFlushTimer.current != null) {
      window.clearTimeout(streamFlushTimer.current);
      streamFlushTimer.current = null;
    }
    const chunk = streamBufRef.current;
    if (!chunk) return;
    streamBufRef.current = "";
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, content: m.content + chunk } : m,
      ),
    );
  }

  function queueStreamToken(assistantId: string, token: string) {
    streamBufRef.current += token;
    if (streamFlushTimer.current != null) return;
    streamFlushTimer.current = window.setTimeout(() => {
      streamFlushTimer.current = null;
      flushStreamBuffer(assistantId);
    }, 32);
  }

  async function send() {
    const text = input.trim();
    if (!text || chatStreaming) return;
    if (!models.length) {
      setError("No Ollama models installed.");
      return;
    }

    setError("");
    setInput("");
    setMentionQuery(null);
    setAgentProgress(null);

    const userMsg: ChatMessage = { id: uid(), role: "user", content: text };
    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    const priorMessages = messages;
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setChatStreaming(true);
    setFileProposals([]);
    streamBufRef.current = "";

    const perf = resolvePerfConfig(settings.perfProfile, {
      maxHistoryMessages: settings.maxHistoryMessages,
      maxAttachChars: settings.maxAttachChars,
      keepAlive: settings.ollamaKeepAlive,
      numGpu: settings.ollamaNumGpu,
      hyperSpeed: settings.hyperSpeed,
    });

    const backend = settings.inferenceBackend ?? "ollama";
    const streamBase = {
      backend,
      ollamaBaseUrl: settings.ollamaBaseUrl,
      llamaCppBaseUrl: settings.llamaCppBaseUrl,
    };

    const mentionCtx = await collectMentionContexts(text, perf.maxAttachChars);
    let contextPrefix = "";
    let userContent = text;
    if (mentionCtx) {
      contextPrefix = mentionCtx;
      userContent = `${mentionCtx}\n\nUser request:\n${text}`;
    }
    if (settings.attachActiveFile && active) {
      let cursorOffset: number | null = null;
      try {
        const ed = monacoEditor as
          | {
              getModel?: () => {
                getOffsetAt: (p: { lineNumber: number; column: number }) => number;
              } | null;
              getPosition?: () => { lineNumber: number; column: number } | null;
            }
          | null
          | undefined;
        const pos = ed?.getPosition?.();
        const model = ed?.getModel?.();
        if (pos && model) cursorOffset = model.getOffsetAt(pos);
      } catch {
        cursorOffset = null;
      }
      const activeCtx = formatActiveFileContext(
        active.path,
        active.language,
        active.content,
        perf.maxAttachChars,
        cursorOffset,
      );
      contextPrefix = mentionCtx ? `${activeCtx}\n\n${mentionCtx}` : activeCtx;
      userContent =
        `${activeCtx}\n\n` +
        (mentionCtx ? `${mentionCtx}\n\n` : "") +
        `User request:\n${text}`;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const routed = await resolveChatModel({
        baseUrl: settings.ollamaBaseUrl,
        userText: text,
        chatMode: settings.chatMode,
        autoModel: settings.autoModel,
        selectedModel,
        installed: models,
        enabledModels: settings.enabledModels,
        agentModels: settings.agentModels,
        keepAlive: perf.keepAlive,
        signal: controller.signal,
        hyperSpeed: settings.hyperSpeed,
      });
      setRouteLabel(routed.label);
      setActiveReplyModel(routed.model);

      // Multitask: plan then sequential workers
      if (settings.chatMode === "multitask") {
        const planner = resolveRoleModel("planner", settings.agentModels, models);
        const worker = resolveRoleModel("worker", settings.agentModels, models);
        setAgentProgress("Planning subtasks…");
        setActiveReplyModel(planner);
        const tasks = await planMultitask({
          baseUrl: settings.ollamaBaseUrl,
          planner,
          userText: text,
          contextPrefix,
          keepAlive: perf.keepAlive,
          options: perf.options,
          signal: controller.signal,
        });

        let combined = `## Multitask plan (${tasks.length} steps)\n\n`;
        tasks.forEach((t, i) => {
          combined += `${i + 1}. **${t.title}**\n`;
        });
        combined += "\n---\n";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: combined } : m,
          ),
        );

        let lastMetrics: ChatMessage["metrics"] | undefined;
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];
          setAgentProgress(`Worker ${i + 1}/${tasks.length}: ${task.title}`);
          setActiveReplyModel(worker);
          await warmInferenceModel({
            backend,
            ollamaBaseUrl: settings.ollamaBaseUrl,
            model: worker,
            keepAlive: perf.keepAlive,
          });
          streamBufRef.current = "";
          const header = `\n\n### ${i + 1}. ${task.title}\n\n`;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + header } : m,
            ),
          );

          const taskMessages = withSystem(
            buildChatMessages({
              priorMessages: [],
              userContent: contextPrefix
                ? `${contextPrefix}\n\nSubtask:\n${task.prompt}`
                : task.prompt,
              maxHistoryMessages: 2,
            }),
            systemPromptForMode(SYSTEM_PROMPT, "agent", "code"),
          );

          const part = await unifiedChatStream({
            ...streamBase,
            model: worker,
            messages: taskMessages,
            signal: controller.signal,
            keepAlive: perf.keepAlive,
            options: { ...perf.options, num_predict: Math.min(perf.options.num_predict, 1536) },
            onToken: (token) => queueStreamToken(assistantId, token),
          });
          flushStreamBuffer(assistantId);
          combined += header + part.text;
          if (part.metrics) lastMetrics = part.metrics;
        }

        if (lastMetrics) {
          setLastTokensPerSec(lastMetrics.tokensPerSec);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, metrics: lastMetrics } : m,
            ),
          );
        }

        setAgentProgress(null);
        const proposals = parseFileProposals(combined);
        if (proposals.length) setFileProposals(proposals);
        return;
      }

      await warmInferenceModel({
        backend,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        model: routed.model,
        keepAlive: perf.keepAlive,
      });
      const history = withSystem(
        buildChatMessages({
          priorMessages,
          userContent,
          maxHistoryMessages: perf.maxHistoryMessages,
        }),
        systemPromptForMode(SYSTEM_PROMPT, settings.chatMode, routed.intent),
      );

      const result = await unifiedChatStream({
        ...streamBase,
        model: routed.model,
        messages: history,
        signal: controller.signal,
        keepAlive: perf.keepAlive,
        options: perf.options,
        onToken: (token) => queueStreamToken(assistantId, token),
      });
      flushStreamBuffer(assistantId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content:
                  m.content.length < result.text.length ? result.text : m.content,
                metrics: result.metrics,
              }
            : m,
        ),
      );
      if (result.metrics) setLastTokensPerSec(result.metrics.tokensPerSec);
      const proposals = parseFileProposals(result.text);
      if (proposals.length) setFileProposals(proposals);
    } catch (err) {
      flushStreamBuffer(assistantId);
      setAgentProgress(null);
      if ((err as Error).name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.content
              ? { ...m, content: "_(generation stopped)_" }
              : m,
          ),
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pushToast("error", msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || `Error: ${msg}` }
              : m,
          ),
        );
      }
    } finally {
      abortRef.current = null;
      setChatStreaming(false);
      setAgentProgress(null);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clearChat() {
    if (chatStreaming) stop();
    setMessages([]);
    setFileProposals([]);
    setError("");
  }

  function applyLastCode() {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) {
      setError("No assistant reply yet.");
      return;
    }
    const proposals = parseFileProposals(lastAssistant.content);
    if (proposals.length) {
      setFileProposals(proposals);
      return;
    }
    const block = lastCodeBlock(lastAssistant.content);
    if (!block) {
      setError("No fenced code block found in the last assistant reply.");
      pushToast("error", "No code block to apply");
      return;
    }
    if (!activePath) {
      setCreateFileDialog({
        parentDir: workspacePath,
        initialName: suggestFileName(block.language, "untitled"),
        content: block.code,
      });
      return;
    }
    applyToActiveFile(block.code);
  }

  return (
    <aside className="h-full flex flex-col bg-pide-sidebar border-l border-pide-sidebar-border min-w-0">
      <div className="h-9 px-2 flex items-center gap-1 border-b border-pide-sidebar-border bg-pide-sidebar shrink-0">
        <span className="text-[11px] tracking-wider uppercase text-[var(--pide-sideBarTitle-foreground)] font-semibold px-1">
          Local AI
        </span>
        <select
          value={activeSessionId}
          onChange={(e) => switchChatSession(e.target.value)}
          className="max-w-[110px] bg-pide-input border border-pide-input-border rounded px-1 py-0.5 text-[11px] text-pide-input-fg transition-colors duration-150"
          title="Chat session"
        >
          {chatSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="text-[11px] px-1.5 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-sidebar-fg transition-colors duration-150"
          onClick={newChatSession}
          title="New session"
        >
          +
        </button>
        <button
          type="button"
          className="text-[11px] px-1.5 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-sidebar-fg transition-colors duration-150"
          onClick={() => activeSessionId && deleteChatSession(activeSessionId)}
          title="Delete session"
        >
          ⌫
        </button>
        <button
          type="button"
          className="ml-auto text-[11px] px-2 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-sidebar-fg transition-colors duration-150"
          onClick={clearChat}
        >
          Clear
        </button>
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-sidebar-fg transition-colors duration-150"
          onClick={applyLastCode}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={toggleChat}
          className="text-pide-muted hover:text-pide-fg px-1 transition-colors duration-150"
          title="Close chat (Ctrl+L)"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {!ollamaOnline && (
          <div className="rounded-md border border-pide-git-mod/40 bg-pide-git-mod/10 p-3 text-xs text-pide-git-mod leading-relaxed">
            {settings.inferenceBackend === "llamaCpp"
              ? "llama-server is offline. Start it from Models (or your terminal), then refresh."
              : "Ollama is offline. Start Ollama on this machine, then refresh."}
            <button
              type="button"
              onClick={() => void refreshOllama()}
              className="mt-2 block px-2 py-1 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-fg transition-colors duration-150"
            >
              Retry connection
            </button>
          </div>
        )}

        {!messages.length && ollamaOnline && (
          <div className="text-sm text-pide-muted leading-relaxed">
            Type <span className="text-pide-sidebar-fg">@filename</span> to attach files. For multi-file
            edits, the model can emit path-labeled code blocks you can apply together.
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg px-3 py-2 ${
              m.role === "user"
                ? "bg-pide-list-active/60 border border-pide-focus/40"
                : "bg-pide-editor/60 border border-pide-sidebar-border"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wide text-pide-muted mb-1">
              {m.role === "user" ? "You" : activeReplyModel || selectedModel || "Assistant"}
            </div>
            {m.role === "assistant" ? (
              m.content ? (
                <>
                  <MarkdownMessage content={m.content} />
                  {!chatStreaming && m.metrics ? (
                    <TokSpeedPill
                      tokensPerSec={m.metrics.tokensPerSec}
                      ttftMs={m.metrics.ttftMs}
                    />
                  ) : null}
                </>
              ) : (
                <span className="text-pide-muted text-sm animate-pulse">Thinking…</span>
              )
            ) : (
              <p className="text-sm text-pide-fg whitespace-pre-wrap">{m.content}</p>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <MultiApplyPanel />

      <div className="border-t border-pide-sidebar-border p-2 shrink-0 relative">
        {mentionQuery !== null && mentionResults.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 mb-1 rounded-xl border border-pide-widget-border bg-pide-widget shadow-xl max-h-40 overflow-auto z-10">
            {mentionResults.map((r, i) => (
              <button
                key={r.path}
                type="button"
                className={`w-full text-left px-2 py-1.5 text-xs truncate transition-colors duration-150 ${
                  i === mentionIndex
                    ? "bg-pide-list-active text-pide-fg"
                    : "text-pide-sidebar-fg hover:bg-pide-list-hover"
                }`}
                onMouseEnter={() => setMentionIndex(i)}
                onClick={() => insertMention(r.path)}
              >
                @{r.name}
                <span className="text-pide-muted ml-2">
                  {workspacePath
                    ? r.path.replace(workspacePath, "").replace(/^[\\/]/, "")
                    : r.path}
                </span>
              </button>
            ))}
          </div>
        )}
        {error && (
          <div className="px-1 pb-1 text-xs text-pide-error" title={error}>
            {error}
          </div>
        )}
        <ChatComposer
          value={input}
          onChange={(v) => {
            setInput(v);
            updateMentionState(v);
          }}
          onSend={() => void send()}
          onStop={stop}
          streaming={chatStreaming}
          disabled={!ollamaOnline || !models.length}
          placeholder={
            ollamaOnline
              ? "Ask anything… @file to attach · Enter to send"
              : "Ollama offline"
          }
          chatMode={settings.chatMode}
          onChatMode={(m: ChatMode) => updateSettings({ chatMode: m })}
          autoModel={settings.autoModel}
          onAutoModel={(v) => updateSettings({ autoModel: v })}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          models={pickerModels}
          routeLabel={routeLabel ?? undefined}
          progress={agentProgress}
          onKeyDown={(e) => {
            if (mentionQuery !== null && mentionResults.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => Math.min(mentionResults.length - 1, i + 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => Math.max(0, i - 1));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insertMention(mentionResults[mentionIndex].path);
                return;
              }
              if (e.key === "Escape") {
                setMentionQuery(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
      </div>
    </aside>
  );
}
