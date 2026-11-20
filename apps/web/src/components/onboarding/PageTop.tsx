import { ChevronLeft } from "lucide-react";
import { useEscBack } from "../SetupShell.tsx";
import { OnboardingDots } from "./GoalsStep.tsx";

/** A first-run page's top bar: Back (Esc does it too) and "Wisp" on the left, the five dots on the right. */
export function PageTop({ step, onBack }: { step: number; onBack?: (() => void) | null }) {
  useEscBack(onBack);
  return (
    <div className="h-14 px-6 flex items-center justify-between shrink-0 safe-top">
      <span className="flex items-center gap-3">
        {onBack && (
          <button type="button" className="ob-back" aria-label="Back" onClick={onBack}>
            <ChevronLeft size={17} />
          </button>
        )}
        <span className="text-[15px] font-[650] tracking-[-0.01em]">Wisp</span>
      </span>
      <OnboardingDots step={step} />
    </div>
  );
}
