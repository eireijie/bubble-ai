import { useEffect, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { SRow } from "./rows.tsx";

/** Only in the desktop app, and only for who the app says may: everything else happens in its own window. */
export function RemoveWispRow() {
  const removal = typeof window !== "undefined" ? window.wispDesktop?.removal : undefined;
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    removal?.available().then(
      (yes) => live && setAvailable(yes),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [removal]);
  if (!available) return null;
  return (
    <SRow id="remove" danger>
      <Button variant="danger" onClick={() => void removal?.open()}>
        Remove Bubble AI…
      </Button>
    </SRow>
  );
}
