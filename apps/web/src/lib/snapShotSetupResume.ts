const STORAGE_KEY = "t3code:snap-shot-setup-resume:v1";
let startupChecked = false;

type ResumeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readSnapShotSetupResume(storage?: ResumeStorage): { wasEnabled: boolean } | null {
  try {
    const value = (storage ?? window.localStorage).getItem(STORAGE_KEY);
    if (value === "enabled" || value === "disabled") return { wasEnabled: value === "enabled" };
  } catch {
    // Permission setup still works when local storage is unavailable.
  }
  return null;
}

export function saveSnapShotSetupResume(wasEnabled: boolean, storage?: ResumeStorage): void {
  try {
    (storage ?? window.localStorage).setItem(STORAGE_KEY, wasEnabled ? "enabled" : "disabled");
  } catch {
    // Permission setup still works when local storage is unavailable.
  }
}

export function clearSnapShotSetupResume(storage?: ResumeStorage): void {
  try {
    (storage ?? window.localStorage).removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable.
  }
}

// Check once per renderer startup so opening System Settings does not redirect
// subsequent navigation in the current session.
export function shouldResumeSnapShotSetupOnStartup(storage?: ResumeStorage): boolean {
  if (startupChecked) return false;
  startupChecked = true;
  return readSnapShotSetupResume(storage) !== null;
}
