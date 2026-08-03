import { Zap } from "lucide-react";

export default function TokSpeedPill({
  tokensPerSec,
  ttftMs,
}: {
  tokensPerSec: number;
  ttftMs?: number;
}) {
  if (!tokensPerSec || tokensPerSec <= 0) return null;
  const band =
    tokensPerSec >= 40 && tokensPerSec <= 70
      ? "target"
      : tokensPerSec > 70
        ? "fast"
        : "slow";

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
          border transition-colors duration-150 ${
            band === "target"
              ? "border-pide-git-add/50 text-pide-git-add bg-pide-git-add/10"
              : band === "fast"
                ? "border-pide-link/40 text-pide-link bg-pide-link/10"
                : "border-pide-widget-border text-pide-muted bg-pide-list-hover/40"
          }`}
        title={
          ttftMs != null
            ? `Generation speed · TTFT ${ttftMs.toFixed(0)} ms`
            : "Generation speed (eval_count / eval_duration)"
        }
      >
        <Zap size={11} strokeWidth={2.25} />
        {tokensPerSec.toFixed(1)} tok/s
      </span>
      {ttftMs != null && ttftMs > 0 ? (
        <span className="text-[10px] text-pide-muted">{ttftMs.toFixed(0)} ms TTFT</span>
      ) : null}
    </div>
  );
}
