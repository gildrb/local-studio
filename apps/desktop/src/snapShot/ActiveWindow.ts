import { macActiveWindow, type ActiveWindow } from "@t3tools/shared/snapShot/ActiveWindow";

import { loadWindowsForegroundApi } from "../electron/WindowsForeground.ts";

async function windowsActiveWindow(): Promise<ActiveWindow | undefined> {
  const api = await loadWindowsForegroundApi();
  const handle = api.getForegroundWindow();
  if (handle === 0n) return undefined;
  const bounds = api.getWindowRect(handle);
  if (!bounds) return undefined;
  const { processId } = api.getWindowThreadAndProcessId(handle);
  const path = processId === 0 ? "" : api.getProcessImagePath(processId);
  const name = path.split(/[\\/]/).pop() ?? "";
  return {
    platform: "windows",
    id: Number(handle),
    title: api.getWindowText(handle),
    bounds,
    owner: { name, processId, path },
  };
}

/** Resolve the OS foreground window, or `undefined` when there is none. */
export function activeWindow(platform: NodeJS.Platform): Promise<ActiveWindow | undefined> {
  if (platform === "darwin") return macActiveWindow();
  if (platform === "win32") return windowsActiveWindow();
  return Promise.resolve(undefined);
}
