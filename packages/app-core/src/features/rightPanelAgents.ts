import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { AgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { mergeEnvironmentThread } from "@t3tools/client-runtime/state/threads";
import type { OrchestrationThreadActivity, ScopedThreadRef } from "@t3tools/contracts";
import {
  buildAgentsPanelModel,
  buildWorkflowScriptViewModel,
  deriveThreadAgentPanelModel,
  resolveAgentPhaseAutoOpen,
  type AgentPhaseSectionModel,
  type AgentPhaseState,
  type AgentRowModel,
  type AgentWorkflowCollapsedModel,
  type AgentWorkflowExpandedModel,
  type AgentWorkflowSectionModel,
  type AgentsPanelViewModel,
  type WorkflowScriptViewModel,
} from "@t3tools/web/src/components/AgentsPanel.logic.ts";
import { derivePhase } from "@t3tools/web/src/session-logic.ts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { makeRouteRightPanelStateAtom } from "../rightPanelState.ts";

const ELAPSED_TICK_MS = 1000;
const EMPTY_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];

const WorkflowParams = Schema.decodeUnknownSync(Schema.Struct({ workflowId: Schema.String }));
const PhaseParams = Schema.decodeUnknownSync(
  Schema.Struct({ workflowId: Schema.String, phaseIndex: Schema.Number }),
);

type PhaseUi = { open: boolean; previousState: AgentPhaseState };

type WorkflowUi = { open: boolean; scriptOpen: boolean; phases: Map<number, PhaseUi> };

export type RightPanelAgentsPhaseView = AgentPhaseSectionModel & { readonly open: boolean };

export type RightPanelAgentsWorkflowView =
  | (AgentWorkflowExpandedModel & {
      readonly kind: "expanded";
      readonly id: string;
      readonly canShowScript: boolean;
      readonly scriptOpen: boolean;
      readonly script: WorkflowScriptViewModel | null;
      readonly phases: ReadonlyArray<RightPanelAgentsPhaseView>;
    })
  | (AgentWorkflowCollapsedModel & { readonly kind: "collapsed"; readonly id: string });

export type RightPanelAgentsView =
  | Extract<AgentsPanelViewModel, { readonly kind: "empty" }>
  | {
      readonly kind: "agents";
      readonly workflows: ReadonlyArray<RightPanelAgentsWorkflowView>;
      readonly direct: {
        readonly title: string;
        readonly rows: ReadonlyArray<AgentRowModel>;
      } | null;
      readonly footer: Extract<AgentsPanelViewModel, { readonly kind: "agents" }>["footer"];
    };

const panelModelAtoms = new WeakMap<FeatureContext, Atom.Atom<AgentPanelModel | null>>();

function threadAgentPanelModelAtom(context: FeatureContext): Atom.Atom<AgentPanelModel | null> {
  const cached = panelModelAtoms.get(context);
  if (cached !== undefined) return cached;
  let memo: {
    readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
    readonly sessionLive: boolean;
    readonly model: AgentPanelModel;
  } | null = null;
  const atom = Atom.make((get): AgentPanelModel | null => {
    const route = get(context.routeAtom);
    if (route === null) return null;
    const thread = mergeEnvironmentThread(
      get(context.state.environmentThreadDetails.detailAtom(route)),
      get(context.state.environmentThreadShells.threadShellAtom(route)),
    );
    const activities = thread?.activities ?? EMPTY_ACTIVITIES;
    const sessionPhase = derivePhase(thread?.session ?? null);
    const sessionLive = sessionPhase !== "disconnected";
    if (memo !== null && memo.activities === activities && memo.sessionLive === sessionLive) {
      return memo.model;
    }
    const model = deriveThreadAgentPanelModel({ activities, sessionPhase });
    memo = { activities, sessionLive, model };
    return model;
  }).pipe(Atom.withLabel("gpui-right-panel-agents-model"));
  panelModelAtoms.set(context, atom);
  return atom;
}

export function makeLiveAgentCountAtom(context: FeatureContext): Atom.Atom<number> {
  const modelAtom = threadAgentPanelModelAtom(context);
  return Atom.make((get) => get(modelAtom)?.liveCount ?? 0);
}

function hasLiveElapsed(view: AgentsPanelViewModel): boolean {
  if (view.kind === "empty") return false;
  const live = (row: AgentRowModel | null) => row?.elapsed?.live === true;
  return (
    (view.direct?.rows.some(live) ?? false) ||
    view.workflows.some(
      ({ expanded }) =>
        expanded.unphasedRows.some(live) ||
        live(expanded.fallbackRow) ||
        expanded.phases.some((phase) => phase.rows.some(live)),
    )
  );
}

export function rightPanelAgentsFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const modelAtom = threadAgentPanelModelAtom(context);
  const panelStateAtom = makeRouteRightPanelStateAtom(context.routeAtom);
  const uiRevisionAtom = Atom.make(0).pipe(Atom.keepAlive);
  const nowTickAtom = Atom.make((get) => {
    const timer = setInterval(() => get.setSelf(Date.now()), ELAPSED_TICK_MS);
    get.addFinalizer(() => clearInterval(timer));
    return Date.now();
  });

  const ui: { threadKey: string | null; workflows: Map<string, WorkflowUi> } = {
    threadKey: null,
    workflows: new Map(),
  };

  const bump = () => registry.set(uiRevisionAtom, registry.get(uiRevisionAtom) + 1);

  const workflowUi = (workflowId: string): WorkflowUi => {
    const entry = ui.workflows.get(workflowId);
    if (entry === undefined) throw new Error(`Unknown agents workflow ${workflowId}.`);
    return entry;
  };

  const syncWorkflow = (section: AgentWorkflowSectionModel, record: boolean): WorkflowUi => {
    const existing = ui.workflows.get(section.id);
    const entry: WorkflowUi = existing ?? {
      open: section.defaultExpanded,
      scriptOpen: false,
      phases: new Map(),
    };
    if (record && existing === undefined) ui.workflows.set(section.id, entry);
    if (!entry.open) return entry;
    const seen = new Set<number>();
    for (const phase of section.expanded.phases) {
      seen.add(phase.index);
      const phaseUi = entry.phases.get(phase.index);
      if (phaseUi === undefined) {
        if (record) {
          entry.phases.set(phase.index, { open: phase.defaultOpen, previousState: phase.state });
        }
        continue;
      }
      if (
        resolveAgentPhaseAutoOpen({ previousState: phaseUi.previousState, nextState: phase.state })
      ) {
        phaseUi.open = true;
      }
      phaseUi.previousState = phase.state;
    }
    for (const index of entry.phases.keys()) {
      if (!seen.has(index)) entry.phases.delete(index);
    }
    return entry;
  };

  const scriptView = (
    get: Atom.AtomContext,
    route: ScopedThreadRef,
    scriptPath: string,
  ): WorkflowScriptViewModel => {
    const result = get(
      state.orchestrationEnvironment.workflowScript({
        environmentId: route.environmentId,
        input: { threadId: route.threadId, scriptPath },
      }),
    );
    return buildWorkflowScriptViewModel(
      scriptPath,
      AsyncResult.isSuccess(result)
        ? { status: "success", contents: result.value.contents, truncated: result.value.truncated }
        : AsyncResult.isFailure(result)
          ? { status: "failure" }
          : { status: "loading" },
    );
  };

  const viewAtom = Atom.make((get): RightPanelAgentsView | null => {
    const route = get(context.routeAtom);
    if (route === null) return null;
    get(uiRevisionAtom);
    const panel = get(panelStateAtom);
    const active = panel !== null && panel.state.isOpen && panel.activeSurface?.kind === "agents";
    const threadKey = scopedThreadKey(route);
    if (!active || ui.threadKey !== threadKey) {
      ui.workflows.clear();
      ui.threadKey = threadKey;
    }
    const model = get(modelAtom);
    if (model === null) return null;
    const view = buildAgentsPanelModel({ model, nowMs: Date.now() });
    if (active && hasLiveElapsed(view)) get(nowTickAtom);
    if (view.kind === "empty") return view;
    const seen = new Set(view.workflows.map((section) => section.id));
    for (const id of ui.workflows.keys()) {
      if (!seen.has(id)) ui.workflows.delete(id);
    }
    const workflows = view.workflows.map((section): RightPanelAgentsWorkflowView => {
      const entry = syncWorkflow(section, active);
      if (!entry.open) return { kind: "collapsed", id: section.id, ...section.collapsed };
      const { expanded } = section;
      const canShowScript = expanded.scriptPath !== null;
      const scriptOpen = entry.scriptOpen && canShowScript;
      return {
        kind: "expanded",
        id: section.id,
        ...expanded,
        canShowScript,
        scriptOpen,
        script:
          scriptOpen && expanded.scriptPath !== null && active
            ? scriptView(get, route, expanded.scriptPath)
            : null,
        phases: expanded.phases.map((phase) => ({
          ...phase,
          open: entry.phases.get(phase.index)?.open ?? phase.defaultOpen,
        })),
      };
    });
    return { kind: "agents", workflows, direct: view.direct, footer: view.footer };
  }).pipe(Atom.withLabel("gpui-right-panel-agents"));

  return {
    views: { rightPanelAgents: viewAtom },
    actions: {
      rightPanelAgentsToggleWorkflow: async (params) => {
        const entry = workflowUi(WorkflowParams(params).workflowId);
        entry.open = !entry.open;
        if (!entry.open) {
          entry.scriptOpen = false;
          entry.phases.clear();
        }
        bump();
        return null;
      },
      rightPanelAgentsTogglePhase: async (params) => {
        const { workflowId, phaseIndex } = PhaseParams(params);
        const phase = workflowUi(workflowId).phases.get(phaseIndex);
        if (phase === undefined) throw new Error(`Unknown agents phase ${phaseIndex}.`);
        phase.open = !phase.open;
        bump();
        return null;
      },
      rightPanelAgentsToggleScript: async (params) => {
        const entry = workflowUi(WorkflowParams(params).workflowId);
        entry.scriptOpen = !entry.scriptOpen;
        bump();
        return null;
      },
      rightPanelAgentsCloseScript: async (params) => {
        workflowUi(WorkflowParams(params).workflowId).scriptOpen = false;
        bump();
        return null;
      },
    },
  };
}
