import { addThreadActionToast } from "./threadActionToast";
import { createThreadUndoNotices } from "./showThreadUndoNotice.logic";

// Shared across sidebar, header and menu actions.
const notices = createThreadUndoNotices(addThreadActionToast);

export const useThreadUndoNotice = notices.store;

export const undoLatestThreadAction = notices.undoLatest;

export const showThreadUndoNotice = notices.show;
