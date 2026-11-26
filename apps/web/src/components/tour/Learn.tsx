import { FinishSetupList } from "../../views/HereView.tsx";

/**
 * Settings › Learn Bubble AI: what setup left to do (phone, apps, away from home, getting to know
 * you). Show me around starts from two places only, the account menu and Help.
 */
export function LearnPage() {
  return (
    <div className="space-y-6">
      <FinishSetupList />
    </div>
  );
}
