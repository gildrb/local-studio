import { stackedThreadToast, toastManager } from "../components/ui/toast";
import type { ThreadActionToast } from "./threadActions.logic";

export function addThreadActionToast(toast: ThreadActionToast): void {
  const { type, title, description } = toast;
  if (toast.layout === "stacked") {
    toastManager.add(
      stackedThreadToast(
        description === undefined ? { type, title } : { type, title, description },
      ),
    );
    return;
  }
  toastManager.add(description === undefined ? { type, title } : { type, title, description });
}
