import type {
  AgentPanelModel,
  AgentPanelWorkflowGroup,
  RuntimeSubagent,
  RuntimeSubagentStatus,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
  formatSubagentModelLabel,
  formatSubagentTokenCount,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import type { SessionPhase } from "../types";

export type AgentStatusTone = "working" | "idle" | "success" | "failed" | "stopped";

export type AgentPhaseState = "pending" | "running" | "done";

export type AgentPhaseTone = "info" | "success" | "muted";

export type AgentElapsedModel = {
  readonly startedAt: string;
  readonly live: boolean;
  readonly text: string;
};

export type AgentRowModel = {
  readonly id: string;
  readonly title: string;
  readonly role: string | null;
  readonly status: RuntimeSubagentStatus;
  readonly statusTone: AgentStatusTone;
  readonly statusLabel: string;
  readonly activityText: string;
  readonly activityTone: "failed" | "muted";
  readonly metadataText: string;
  readonly elapsed: AgentElapsedModel | null;
  readonly showCompletedCheck: boolean;
};

export type AgentMemberDotModel = {
  readonly id: string;
  readonly tone: AgentStatusTone;
};

export type AgentPhaseRailSegmentModel = {
  readonly index: number;
  readonly label: string;
  readonly tone: AgentPhaseTone;
  readonly showSeparator: boolean;
  readonly memberDots: ReadonlyArray<AgentMemberDotModel>;
  readonly emptyMembersText: string | null;
};

export type AgentPhaseSectionModel = {
  readonly index: number;
  readonly title: string;
  readonly state: AgentPhaseState;
  readonly tone: AgentPhaseTone;
  readonly showDoneCheck: boolean;
  readonly summaryText: string;
  readonly defaultOpen: boolean;
  readonly memberDots: ReadonlyArray<AgentMemberDotModel>;
  readonly rows: ReadonlyArray<AgentRowModel>;
};

export type AgentWorkflowExpandedModel = {
  readonly statusTone: AgentStatusTone;
  readonly title: string;
  readonly scriptPath: string | null;
  readonly scriptToggleLabel: string;
  readonly settledText: string;
  readonly collapseAriaLabel: string;
  readonly phaseRail: ReadonlyArray<AgentPhaseRailSegmentModel>;
  readonly phases: ReadonlyArray<AgentPhaseSectionModel>;
  readonly unphasedRows: ReadonlyArray<AgentRowModel>;
  readonly fallbackRow: AgentRowModel | null;
};

export type AgentWorkflowCollapsedModel = {
  readonly statusTone: AgentStatusTone;
  readonly title: string;
  readonly failedText: string | null;
  readonly agentsText: string;
  readonly tokensText: string;
  readonly elapsedText: string | null;
};

export type AgentWorkflowSectionModel = {
  readonly id: string;
  readonly defaultExpanded: boolean;
  readonly expanded: AgentWorkflowExpandedModel;
  readonly collapsed: AgentWorkflowCollapsedModel;
};

export type AgentDirectSectionModel = {
  readonly title: string;
  readonly rows: ReadonlyArray<AgentRowModel>;
};

export type AgentsPanelFooterModel = {
  readonly workingText: string | null;
  readonly idleText: string | null;
  readonly settledText: string | null;
  readonly totalTokensText: string;
};

export type AgentsPanelEmptyModel = {
  readonly icon: "bot";
  readonly title: string;
  readonly description: string;
};

export type AgentsPanelViewModel =
  | { readonly kind: "empty"; readonly empty: AgentsPanelEmptyModel }
  | {
      readonly kind: "agents";
      readonly workflows: ReadonlyArray<AgentWorkflowSectionModel>;
      readonly direct: AgentDirectSectionModel | null;
      readonly footer: AgentsPanelFooterModel;
    };

export type AgentsPanelModelInput = {
  readonly model: AgentPanelModel;
  readonly nowMs: number;
};

export type ThreadAgentPanelInput = {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly sessionPhase: SessionPhase;
};

export type WorkflowScriptResultInput =
  | { readonly status: "success"; readonly contents: string; readonly truncated: boolean }
  | { readonly status: "failure" }
  | { readonly status: "loading" };

export type WorkflowScriptViewModel = {
  readonly fileName: string;
  readonly closeAriaLabel: string;
  readonly body:
    | { readonly kind: "success"; readonly text: string }
    | { readonly kind: "failure"; readonly text: string }
    | { readonly kind: "loading"; readonly text: string };
};

/**
 * In-flight states all present as Working (one steady state, per the
 * monitoring-pill design: detail belongs in the activity sub-line, and a
 * stalled/waiting/queued subagent is still the fleet doing its job, not a
 * user problem). Only settled states differentiate.
 */
const STATUS_VISUALS: Record<
  RuntimeSubagentStatus,
  { readonly tone: AgentStatusTone; readonly label: string }
> = {
  pending: { tone: "working", label: "Working" },
  running: { tone: "working", label: "Working" },
  waiting: { tone: "working", label: "Working" },
  // Idle reads as settled (muted, not sky): a resting Codex child looks done
  // unless resumed — live-test: sky idle dots read as stuck in-progress.
  idle: { tone: "idle", label: "Idle · resumable" },
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "failed", label: "Failed" },
  cancelled: { tone: "stopped", label: "Stopped" },
  interrupted: { tone: "stopped", label: "Stopped" },
};

const AGENTS_PANEL_EMPTY: AgentsPanelEmptyModel = {
  icon: "bot",
  title: "No agents yet",
  description:
    "When this thread spawns subagents or runs a workflow, they show up here with live status, activity, and token usage.",
};

export function deriveThreadAgentPanelModel(input: ThreadAgentPanelInput): AgentPanelModel {
  return deriveAgentPanelModel({
    agents: foldSubagentActivities(input.activities, {
      sessionLive: input.sessionPhase !== "disconnected",
    }),
  });
}

function formatAgentElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) {
    return `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatAgentElapsed(
  startedAt: string,
  endIso: string | null,
  nowMs: number,
): string {
  const start = Date.parse(startedAt);
  const end = endIso ? Date.parse(endIso) : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "";
  }
  return formatAgentElapsedSeconds((end - start) / 1000);
}

export function buildAgentElapsedModel(
  agent: RuntimeSubagent,
  nowMs: number,
): AgentElapsedModel | null {
  if (!agent.startedAt) {
    return null;
  }
  const live = agent.status === "running" || agent.status === "waiting";
  return {
    startedAt: agent.startedAt,
    live,
    text: formatAgentElapsed(agent.startedAt, live ? null : agent.completedAt, nowMs),
  };
}

/**
 * Status-dependent activity line. Live rows lead with what is happening now;
 * settled rows lead with the outcome. Errors are the only inline previews on
 * failed rows because they explain a red row at a glance.
 */
function agentActivityText(agent: RuntimeSubagent): string | null {
  const live =
    agent.status === "running" || agent.status === "pending" || agent.status === "waiting";
  if (live) {
    return (
      agent.progress ??
      (agent.lastToolName ? `▸ ${agent.lastToolName}` : null) ??
      agent.result ??
      agent.error
    );
  }
  return (
    agent.error ??
    agent.result ??
    agent.progress ??
    (agent.lastToolName ? `▸ ${agent.lastToolName}` : null)
  );
}

export function buildAgentRowModel(agent: RuntimeSubagent, nowMs: number): AgentRowModel {
  const visuals = STATUS_VISUALS[agent.status];
  const statusLabel =
    agent.kind === "subagent_batch" && agent.status === "idle" ? "Idle" : visuals.label;
  const role =
    agent.role?.trim().toLocaleLowerCase() === agent.title.trim().toLocaleLowerCase()
      ? null
      : agent.role;
  const metadata = [
    formatSubagentModelLabel(agent.model, agent.effort),
    agent.usage ? `${formatSubagentTokenCount(agent.usage.totalTokens)} tok` : "— tok",
    agent.usage?.toolUses !== undefined ? `${agent.usage.toolUses} tools` : null,
    agent.activationCount > 1 ? `run ${agent.activationCount}` : null,
  ].filter((value): value is string => value !== null);
  return {
    id: agent.id,
    title: agent.title,
    role: role || null,
    status: agent.status,
    statusTone: visuals.tone,
    statusLabel,
    activityText: agentActivityText(agent) ?? statusLabel,
    activityTone: agent.status === "failed" ? "failed" : "muted",
    metadataText: metadata.join(" · "),
    elapsed: buildAgentElapsedModel(agent, nowMs),
    showCompletedCheck: agent.status === "completed",
  };
}

function phaseTone(state: AgentPhaseState): AgentPhaseTone {
  return state === "running" ? "info" : state === "done" ? "success" : "muted";
}

function memberDots(members: ReadonlyArray<RuntimeSubagent>): ReadonlyArray<AgentMemberDotModel> {
  return members.map((member) => ({ id: member.id, tone: STATUS_VISUALS[member.status].tone }));
}

export function resolveAgentPhaseAutoOpen(input: {
  readonly previousState: AgentPhaseState;
  readonly nextState: AgentPhaseState;
}): boolean {
  return input.previousState !== "running" && input.nextState === "running";
}

export function buildAgentWorkflowSectionModel(
  group: AgentPanelWorkflowGroup,
  nowMs: number,
): AgentWorkflowSectionModel {
  const members = [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
  const settled = members.filter(
    (member) =>
      member.status === "completed" ||
      member.status === "failed" ||
      member.status === "cancelled" ||
      member.status === "interrupted",
  ).length;
  const failed = members.filter((member) => member.status === "failed").length;
  // Coordinator usage may already aggregate members (panel-footer rule):
  // count it only when there are no member rows to sum.
  const totalTokens = members.reduce(
    (sum, member) => sum + (member.usage?.totalTokens ?? 0),
    members.length === 0 ? (group.workflow.usage?.totalTokens ?? 0) : 0,
  );
  const elapsed =
    group.workflow.startedAt && group.workflow.completedAt
      ? formatAgentElapsed(group.workflow.startedAt, group.workflow.completedAt, nowMs)
      : null;
  const workflowStatus = group.workflow.status;
  const workflowLive =
    workflowStatus !== "completed" &&
    workflowStatus !== "failed" &&
    workflowStatus !== "cancelled" &&
    workflowStatus !== "interrupted";
  const title = group.workflow.workflowName ?? group.workflow.title;
  const expanded: AgentWorkflowExpandedModel = {
    statusTone: STATUS_VISUALS[group.workflow.status].tone,
    title,
    scriptPath: group.workflow.runHandles?.scriptPath ?? null,
    scriptToggleLabel: "{} script",
    settledText: `${settled}/${members.length} settled`,
    collapseAriaLabel: "Collapse workflow",
    phaseRail: group.phases.map((phase, index) => ({
      index: phase.index,
      label: `${phase.state === "done" ? "✓ " : ""}${phase.title}`,
      tone: phaseTone(phase.state),
      showSeparator: index > 0,
      memberDots: memberDots(phase.members),
      emptyMembersText: phase.members.length === 0 ? "–" : null,
    })),
    phases: group.phases.map((phase) => ({
      index: phase.index,
      title: phase.title,
      state: phase.state,
      tone: phaseTone(phase.state),
      showDoneCheck: phase.state === "done",
      summaryText:
        phase.state === "pending" && phase.members.length === 0
          ? "pending"
          : phase.state === "done"
            ? `${phase.settledCount} done`
            : `${phase.activeCount} active · ${phase.settledCount} done`,
      defaultOpen: !workflowLive || phase.state === "running",
      memberDots: memberDots(phase.members),
      rows: phase.members.map((member) => buildAgentRowModel(member, nowMs)),
    })),
    unphasedRows: group.unphasedMembers.map((member) => buildAgentRowModel(member, nowMs)),
    fallbackRow:
      group.phases.length === 0 && group.unphasedMembers.length === 0
        ? buildAgentRowModel(group.workflow, nowMs)
        : null,
  };
  return {
    id: group.workflow.id,
    defaultExpanded: workflowLive,
    expanded,
    collapsed: {
      statusTone: STATUS_VISUALS[failed > 0 ? "failed" : group.workflow.status].tone,
      title,
      failedText: failed > 0 ? `${failed} failed` : null,
      agentsText: `${members.length} agents`,
      tokensText: `· ${formatSubagentTokenCount(totalTokens)} tok`,
      elapsedText: elapsed ? `· ${elapsed}` : null,
    },
  };
}

export function buildAgentsPanelFooterModel(model: AgentPanelModel): AgentsPanelFooterModel {
  const working = model.runningCount + model.waitingCount;
  return {
    workingText: working > 0 ? `● ${working} working` : null,
    idleText: model.idleCount > 0 ? `${model.idleCount} idle` : null,
    settledText: model.settledCount > 0 ? `${model.settledCount} settled` : null,
    totalTokensText: `Σ ${formatSubagentTokenCount(model.totalTokens)} tok`,
  };
}

export function buildAgentsPanelModel(input: AgentsPanelModelInput): AgentsPanelViewModel {
  const { model, nowMs } = input;
  if (!model.hasAgents) {
    return { kind: "empty", empty: AGENTS_PANEL_EMPTY };
  }
  return {
    kind: "agents",
    workflows: model.workflows.map((group) => buildAgentWorkflowSectionModel(group, nowMs)),
    direct:
      model.directAgents.length > 0
        ? {
            title: "Direct spawns",
            rows: model.directAgents.map((agent) => buildAgentRowModel(agent, nowMs)),
          }
        : null,
    footer: buildAgentsPanelFooterModel(model),
  };
}

export function buildWorkflowScriptViewModel(
  scriptPath: string,
  result: WorkflowScriptResultInput,
): WorkflowScriptViewModel {
  return {
    fileName: scriptPath.split("/").at(-1) ?? "",
    closeAriaLabel: "Close script",
    body:
      result.status === "success"
        ? {
            kind: "success",
            text: `${result.contents}${result.truncated ? "\n… (truncated)" : ""}`,
          }
        : result.status === "failure"
          ? { kind: "failure", text: "Could not load the script." }
          : { kind: "loading", text: "Loading…" },
  };
}
