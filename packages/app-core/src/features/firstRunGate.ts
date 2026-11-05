import {
  buildFirstRunRecoveryModel,
  isFirstRunWorkspaceProvenanceAuthoritative,
  isFreshFirstRunWorkspace,
  resolveFirstRunDecision,
  resolveFirstRunGateView,
  transitionFirstRunGateState,
  type FirstRunDecision,
  type FirstRunGateState,
  type FirstRunRecoveryModel,
} from "@t3tools/web/src/onboarding/firstRun.logic.ts";
import { createAllEnvironmentShellsBootstrappedAtom } from "@t3tools/web/src/state/shellBootstrap.logic.ts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../feature.ts";
import type { AppPageKind } from "../page.ts";

const FIRST_RUN_DECISION_TIMEOUT_MS = 4_000;
const HYDRATION_STATUS = "ready";
const UNGATED_PAGES: ReadonlySet<AppPageKind> = new Set(["welcome", "pair", "connect"]);

export type FirstRunGateView =
  | { readonly kind: "app" }
  | { readonly kind: "blank" }
  | ({ readonly kind: "recovery" } & FirstRunRecoveryModel);

type Evidence = {
  readonly decision: FirstRunDecision;
  readonly persistCompletion: boolean;
  readonly completed: boolean;
};

export function isUngatedPage(kind: AppPageKind): boolean {
  return UNGATED_PAGES.has(kind);
}

export function createFirstRunGate(
  context: FeatureContext,
  completeOnboarding: () => Promise<void>,
) {
  const { registry, state } = context;

  const initialState = (): FirstRunGateState => ({
    decision:
      registry.get(context.clientSettingsAtom).onboardingCompletedAt !== null ? "app" : "pending",
    stalled: false,
  });
  const gateAtom = Atom.make<FirstRunGateState>(initialState()).pipe(Atom.keepAlive);

  const bootstrappedAtom = createAllEnvironmentShellsBootstrappedAtom({
    catalogAtom: state.environmentCatalog.catalogAtom,
    connectionStateAtom: state.environmentCatalog.stateAtom,
    shellStateValueAtom: state.environmentShell.stateValueAtom,
  });

  const evidenceAtom = Atom.make((get): Evidence => {
    const completed = get(context.clientSettingsAtom).onboardingCompletedAt !== null;
    const serverConfig = get(state.primaryServerConfigAtom);
    const primaryEnvironmentId = serverConfig?.environment.environmentId ?? null;
    const welcome =
      primaryEnvironmentId === null
        ? null
        : Option.getOrNull(
            AsyncResult.value(
              get(
                state.serverEnvironment.welcome({ environmentId: primaryEnvironmentId, input: {} }),
              ),
            ),
          );
    const projects = get(state.environmentProjects.projectsAtom);
    const threads = get(state.environmentThreadShells.threadShellsAtom);
    const primaryShellLive =
      primaryEnvironmentId !== null &&
      get(state.environmentShell.stateValueAtom(primaryEnvironmentId)).status === "live";
    const evidenceEnvironmentIds = new Set([
      ...projects.map((project) => project.environmentId),
      ...threads.map((thread) => thread.environmentId),
    ]);
    let workspaceEvidenceLive = true;
    for (const environmentId of evidenceEnvironmentIds) {
      if (get(state.environmentShell.stateValueAtom(environmentId)).status !== "live") {
        workspaceEvidenceLive = false;
        break;
      }
    }
    const workspaceFresh = isFreshFirstRunWorkspace({
      primaryEnvironmentId,
      serverCwd: serverConfig?.cwd ?? null,
      bootstrapProjectId: welcome?.bootstrapProjectId,
      bootstrapThreadId: welcome?.bootstrapThreadId,
      bootstrapProjectCreated: welcome?.bootstrapProjectCreated,
      bootstrapThreadCreated: welcome?.bootstrapThreadCreated,
      projects,
      threads,
    });
    const { decision, persistCompletion } = resolveFirstRunDecision({
      enabled: true,
      hydrated: true,
      completed,
      bootstrapped: get(bootstrappedAtom),
      authoritative: primaryShellLive,
      workspaceAuthoritative: workspaceEvidenceLive,
      workspaceProvenanceAuthoritative: isFirstRunWorkspaceProvenanceAuthoritative({
        welcomeReceived: welcome !== null,
        bootstrapStatus: welcome?.bootstrapStatus ?? null,
      }),
      catalogReady: get(state.environmentCatalog.catalogValueAtom).isReady,
      serverConfigAvailable: serverConfig !== null,
      workspaceFresh,
      projectCount: projects.length,
      threadCount: threads.length,
    });
    return { decision, persistCompletion, completed };
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const scheduleTimeout = () => {
    const gate = registry.get(gateAtom);
    const ungated = isUngatedPage(registry.get(context.pageAtom).kind);
    if (ungated || gate.decision !== "pending") {
      clearTimer();
      return;
    }
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      registry.set(
        gateAtom,
        transitionFirstRunGateState(registry.get(gateAtom), { type: "timeout" }),
      );
    }, FIRST_RUN_DECISION_TIMEOUT_MS);
  };

  const applyEvidence = () => {
    if (isUngatedPage(registry.get(context.pageAtom).kind)) return;
    const gate = registry.get(gateAtom);
    if (gate.decision === "wizard") return;
    const evidence = registry.get(evidenceAtom);
    if (evidence.persistCompletion && !evidence.completed) {
      void completeOnboarding().catch(() => undefined);
    }
    registry.set(
      gateAtom,
      transitionFirstRunGateState(gate, { type: "evidence", decision: evidence.decision }),
    );
  };

  registry.subscribe(evidenceAtom, applyEvidence, { immediate: true });

  let previousPage = registry.get(context.pageAtom).kind;
  registry.subscribe(
    context.pageAtom,
    (page) => {
      const wasUngated = isUngatedPage(previousPage);
      previousPage = page.kind;
      if (wasUngated && !isUngatedPage(page.kind)) {
        clearTimer();
        registry.set(gateAtom, initialState());
        applyEvidence();
      }
      scheduleTimeout();
    },
    { immediate: true },
  );

  registry.subscribe(
    gateAtom,
    (gate) => {
      scheduleTimeout();
      if (gate.decision === "wizard" && registry.get(context.pageAtom).kind !== "welcome") {
        context.navigate({ kind: "welcome" });
      }
    },
    { immediate: true },
  );

  const viewAtom = Atom.make((get): FirstRunGateView => {
    if (isUngatedPage(get(context.pageAtom).kind)) return { kind: "app" };
    const gate = get(gateAtom);
    const view = resolveFirstRunGateView({
      hydrationStatus: HYDRATION_STATUS,
      decision: gate.decision,
      stalled: gate.stalled,
    });
    if (view.kind !== "recovery") return view;
    return {
      kind: "recovery",
      ...buildFirstRunRecoveryModel({ reason: view.reason, retrying: view.retrying }),
    };
  });

  const retry = async () => {
    clearTimer();
    registry.set(gateAtom, initialState());
    applyEvidence();
    scheduleTimeout();
    return null;
  };

  return { viewAtom, retry };
}
