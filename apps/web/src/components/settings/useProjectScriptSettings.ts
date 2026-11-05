import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { NewProjectScriptInput } from "../projectScriptEditor.logic";
import { toastManager } from "../ui/toast";
import {
  collectProjectScriptIds,
  PROJECT_ACTIONS_BUSY_MESSAGE,
  PROJECT_ACTIONS_NOT_SAVED_TITLE,
  PROJECT_ACTIONS_SAVE_FAILED_TITLE,
  resolveProjectScriptKeybindingSteps,
  resolveProjectScriptsPersistStep,
  resolveProjectScriptSubmit,
  type ProjectScriptSettingsTarget,
  type ProjectScriptsChange,
} from "./ProjectActionsSettings.logic";

function reportScriptFailure(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: PROJECT_ACTIONS_SAVE_FAILED_TITLE,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
  return mapAtomCommandResult(result, () => undefined);
}

/**
 * Edits the action list on every target: the environment default when there is
 * no project, else that project's override entry. Shortcuts follow on desktop.
 */
export function useProjectScriptSettings(targets: readonly ProjectScriptSettingsTarget[]) {
  const projects = useProjects();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "project actions update");
  const upsertKeybinding = useAtomCommand(
    serverEnvironment.upsertKeybinding,
    "action shortcut update",
  );
  const removeKeybinding = useAtomCommand(
    serverEnvironment.removeKeybinding,
    "action shortcut removal",
  );

  async function persist(change: ProjectScriptsChange): Promise<AtomCommandResult<void, unknown>> {
    if (savingRef.current || targets.length === 0) {
      toastManager.add({
        type: "error",
        title: PROJECT_ACTIONS_NOT_SAVED_TITLE,
        description: PROJECT_ACTIONS_BUSY_MESSAGE,
      });
      return AsyncResult.failure(Cause.fail(new Error(PROJECT_ACTIONS_BUSY_MESSAGE)));
    }
    savingRef.current = true;
    setSaving(true);
    try {
      for (const target of targets) {
        const step = resolveProjectScriptsPersistStep(target, change.transform);
        const result = await updateSettings({
          environmentId: target.environmentId,
          input: { patch: step.patch },
        });
        if (result._tag === "Failure") return reportScriptFailure(result);
        if (!isElectron) continue;
        for (const binding of resolveProjectScriptKeybindingSteps({
          target,
          step,
          change,
          projects,
        })) {
          const bindingResult =
            binding.kind === "upsert"
              ? await upsertKeybinding({ environmentId: target.environmentId, input: binding.rule })
              : await removeKeybinding({
                  environmentId: target.environmentId,
                  input: binding.rule,
                });
          if (bindingResult._tag === "Failure") return reportScriptFailure(bindingResult);
        }
      }
      return AsyncResult.success(undefined);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function submit(scriptId: string | null, input: NewProjectScriptInput) {
    return persist(
      resolveProjectScriptSubmit({
        scriptId,
        script: input,
        existingIds: collectProjectScriptIds({ projects, targets }),
      }),
    );
  }

  return { saving, persist, submit };
}
