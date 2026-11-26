import { Server } from "lucide-react";
import { STORAGE_SERVICES, type StorageService } from "@bubble-ai/core";
import { AppTile, Tile } from "../../components/MarketParts.tsx";

/** A service's real logo, or a plain server for "Other server". */
export function StorageLogo({ service, size = 40 }: { service: StorageService; size?: number }) {
  const s = STORAGE_SERVICES[service];
  return s.logo ? <AppTile name={s.name} size={size} /> : <Tile size={size}><Server size={Math.round(size * 0.5)} strokeWidth={1.7} /></Tile>;
}
