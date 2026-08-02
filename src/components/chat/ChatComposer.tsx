import { ArrowUp, Paperclip, Square } from "lucide-react";
import type { ChatMode } from "../../types";
import ModePill from "./ModePill";
import ModelPicker from "./ModelPicker";

export default function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  chatMode,
  onChatMode,
  autoModel,
  onAutoModel,
  selectedModel,
  onSelectModel,
  models,
  routeLabel,
  progress,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  placeholder: string;
  chatMode: ChatMode;
  onChatMode: (m: ChatMode) => void;
  autoModel: boolean;
  onAutoModel: (v: boolean) => void;
  selectedModel: string;
  onSelectModel: (m: string) => void;
  models: string[];
  routeLabel?: string;
  progress?: string | null;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="space-y-1.5">
      {progress ? (
        <div className="text-[11px] text-pide-muted px-1 truncate" title={progress}>
          {progress}
        </div>
      ) : routeLabel && autoModel ? (
        <div className="text-[11px] text-pide-muted px-1 truncate" title={routeLabel}>
          {routeLabel}
        </div>
      ) : null}

      <div
        className="rounded-2xl border border-pide-input-border bg-pide-input shadow-lg
          focus-within:border-pide-focus transition-colors duration-150 overflow-hidden"
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-transparent px-3 pt-3 pb-1 text-sm text-pide-input-fg resize-none outline-none
            placeholder:text-[var(--pide-input-placeholderForeground)] disabled:opacity-50"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <ModePill value={chatMode} onChange={onChatMode} />
          <ModelPicker
            autoModel={autoModel}
            onAutoChange={onAutoModel}
            selectedModel={selectedModel}
            onSelectModel={onSelectModel}
            models={models}
            routeLabel={routeLabel}
          />
          <div className="flex-1" />
          <button
            type="button"
            className="p-1.5 rounded-full text-pide-muted hover:text-pide-fg hover:bg-pide-list-hover transition-colors duration-150"
            title="Attach via @mentions in the message"
            tabIndex={-1}
          >
            <Paperclip size={15} />
          </button>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="w-8 h-8 rounded-full flex items-center justify-center
                bg-[var(--pide-button-secondaryBackground)] text-pide-fg hover:bg-pide-list-hover transition-colors duration-150"
              title="Stop"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={disabled || !value.trim()}
              className="w-8 h-8 rounded-full flex items-center justify-center
                bg-pide-button text-pide-button-fg hover:bg-pide-button-hover
                disabled:opacity-40 transition-colors duration-150"
              title="Send"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
