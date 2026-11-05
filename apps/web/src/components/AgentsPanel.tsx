/**
 * Agents right-panel surface: the fleet view over the native subagent fold.
 * The chat carries one expandable row per spawn batch and links here.
 *
 * Visualization rules (from live-test feedback):
 * - Spawn order is stable. Activity and completion update rows in place.
 * - Agent rows reserve three fixed lines for identity, activity, and metrics;
 *   changing data must never change their height.
 * - Workflow expansion is presentation state. A live run stays expanded when
 *   it settles; older collapsed runs can still be opened at run granularity.
 * - Static status dots, DOM-write elapsed timers, plain token counters.
 */
import { useAtomValue } from "@effect/atom-react";
import type { AgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Bot, Braces, Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Button } from "~/components/ui/button";

import {
  buildAgentsPanelModel,
  buildWorkflowScriptViewModel,
  formatAgentElapsed,
  resolveAgentPhaseAutoOpen,
  type AgentElapsedModel,
  type AgentMemberDotModel,
  type AgentPhaseSectionModel,
  type AgentPhaseTone,
  type AgentRowModel,
  type AgentStatusTone,
  type AgentWorkflowCollapsedModel,
  type AgentWorkflowExpandedModel,
  type AgentWorkflowSectionModel,
} from "./AgentsPanel.logic";

const STATUS_DOT_CLASS: Record<AgentStatusTone, string> = {
  working: "bg-info",
  idle: "bg-muted-foreground/50",
  success: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/60",
};

const PHASE_BORDER_CLASS: Record<AgentPhaseTone, string> = {
  info: "border-info/40",
  success: "border-success/30",
  muted: "border-border/50",
};

const PHASE_TEXT_CLASS: Record<AgentPhaseTone, string> = {
  info: "text-info-foreground",
  success: "text-success-foreground",
  muted: "text-muted-foreground/70",
};

function StatusDot({ tone }: { tone: AgentStatusTone }) {
  return (
    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASS[tone])} />
  );
}

function MemberDots({ dots }: { dots: ReadonlyArray<AgentMemberDotModel> }) {
  return dots.map((dot) => <StatusDot key={dot.id} tone={dot.tone} />);
}

/**
 * Elapsed time for the current activation. Live agents self-tick via DOM
 * writes (zero React commits per tick); settled agents freeze at completedAt.
 */
function AgentElapsed({ elapsed }: { elapsed: AgentElapsedModel }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const { live, startedAt } = elapsed;

  useEffect(() => {
    if (!live) {
      return;
    }
    const update = () => {
      if (textRef.current) {
        textRef.current.textContent = formatAgentElapsed(startedAt, null, Date.now());
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [live, startedAt]);

  return (
    <span ref={textRef} className="tabular-nums">
      {elapsed.text}
    </span>
  );
}

/** Flat, non-interactive agent status line. No unfold. */
function AgentRow({ row }: { row: AgentRowModel }) {
  return (
    <div className="grid h-[3.875rem] grid-cols-[0.375rem_minmax(0,1fr)_auto] grid-rows-[1.25rem_1.125rem_1rem] items-center gap-x-2 rounded-md px-1.5 py-1">
      <span className="col-start-1 row-start-1 flex items-center">
        <StatusDot tone={row.statusTone} />
      </span>
      <span className="col-start-2 row-start-1 flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{row.title}</span>
        {row.role ? (
          <span className="max-w-28 shrink-0 truncate rounded-sm border border-border/60 px-1 font-mono text-3xs text-muted-foreground">
            {row.role}
          </span>
        ) : null}
      </span>
      <span className="col-start-3 row-start-1 min-w-14 text-right font-mono text-2xs text-muted-foreground/80">
        <span className="inline-flex items-center gap-1">
          {row.elapsed ? <AgentElapsed elapsed={row.elapsed} /> : null}
          {row.showCompletedCheck ? <Check aria-hidden className="size-3 text-success" /> : null}
        </span>
      </span>
      <span
        className={cn(
          "col-start-2 col-end-4 row-start-2 block truncate text-xs",
          row.activityTone === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
        )}
      >
        {row.activityText}
      </span>
      <span className="col-start-2 col-end-4 row-start-3 truncate font-mono text-2xs tabular-nums text-muted-foreground/70">
        {row.metadataText}
      </span>
      <span className="sr-only">{row.statusLabel}</span>
    </div>
  );
}

/**
 * Phase rail: the run's shape at a glance. One segment per phase in order,
 * separated by chevrons; each segment shows title + one dot per member.
 * The whole arc (done → live → pending) is visible without scrolling the
 * member list.
 */
function PhaseRail({ segments }: { segments: AgentWorkflowExpandedModel["phaseRail"] }) {
  if (segments.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1.5 pb-1 pt-1.5">
      {segments.map((segment) => (
        <div key={segment.index} className="flex items-center gap-1">
          {segment.showSeparator ? (
            <ChevronRight aria-hidden className="size-3 text-muted-foreground/40" />
          ) : null}
          <div
            className={cn(
              "flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
              PHASE_BORDER_CLASS[segment.tone],
            )}
          >
            <span className={cn("font-mono text-3xs", PHASE_TEXT_CLASS[segment.tone])}>
              {segment.label}
            </span>
            <span className="flex items-center gap-0.5">
              {segment.emptyMembersText !== null ? (
                <span className="font-mono text-3xs text-muted-foreground/50">
                  {segment.emptyMembersText}
                </span>
              ) : (
                <MemberDots dots={segment.memberDots} />
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only workflow script viewer, fetched through the contained
 * getWorkflowScript RPC (never a raw filesystem read from the client).
 */
function WorkflowScriptView({
  environmentId,
  threadId,
  scriptPath,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  scriptPath: string;
  onClose: () => void;
}) {
  const result = useAtomValue(
    orchestrationEnvironment.workflowScript({ environmentId, input: { threadId, scriptPath } }),
  );
  const view = buildWorkflowScriptViewModel(
    scriptPath,
    result._tag === "Success"
      ? {
          status: "success",
          contents: result.value.contents,
          truncated: result.value.truncated,
        }
      : result._tag === "Failure"
        ? { status: "failure" }
        : { status: "loading" },
  );
  return (
    <div className="mx-1.5 mb-1 rounded-md border border-border/60 bg-background/60">
      <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1">
        <Braces aria-hidden className="size-3 text-muted-foreground" />
        <span className="truncate font-mono text-3xs text-muted-foreground">{view.fileName}</span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onClose}
          aria-label={view.closeAriaLabel}
          className="ml-auto"
        >
          <X aria-hidden className="size-3" />
        </Button>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {view.body.kind === "success" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-foreground/90">
            {view.body.text}
          </pre>
        ) : view.body.kind === "failure" ? (
          <p className="text-xs text-destructive-foreground">{view.body.text}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{view.body.text}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible phase section. A phase opens when it becomes active, then keeps
 * that shape as it settles so completion never yanks rows out from under the
 * user. Manual toggles stick until a later activation begins.
 */
function PhaseSection({ phase }: { phase: AgentPhaseSectionModel }) {
  const [open, setOpen] = useState(phase.defaultOpen);
  const previousState = useRef(phase.state);

  useEffect(() => {
    if (
      resolveAgentPhaseAutoOpen({ previousState: previousState.current, nextState: phase.state })
    ) {
      setOpen(true);
    }
    previousState.current = phase.state;
  }, [phase.state]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "mt-2 flex w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-3xs font-medium uppercase tracking-wider hover:bg-accent/40",
          PHASE_TEXT_CLASS[phase.tone],
        )}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0" />
        )}
        {phase.showDoneCheck ? <Check aria-hidden className="size-3" /> : null}
        <span>{phase.title}</span>
        <span className="font-normal normal-case text-muted-foreground/70">
          {phase.summaryText}
        </span>
        {!open && phase.memberDots.length > 0 ? (
          <span className="ml-auto flex items-center gap-0.5">
            <MemberDots dots={phase.memberDots} />
          </span>
        ) : null}
      </button>
      {open ? phase.rows.map((row) => <AgentRow key={row.id} row={row} />) : null}
    </div>
  );
}

/** Expanded workflow: phase rail + full phase tree. */
function ExpandedWorkflowSection({
  section,
  environmentId,
  threadId,
  onCollapse,
}: {
  section: AgentWorkflowExpandedModel;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onCollapse: () => void;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const { scriptPath } = section;
  const canShowScript = scriptPath !== null && environmentId !== null && threadId !== null;
  return (
    <section className="rounded-lg border border-border/50 bg-card/30 p-1.5">
      <div className="flex items-center gap-2 px-1.5 pt-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        <StatusDot tone={section.statusTone} />
        <span className="min-w-0 truncate">{section.title}</span>
        {canShowScript ? (
          <button
            type="button"
            onClick={() => setScriptOpen((value) => !value)}
            className={cn(
              "rounded-sm border border-border/60 px-1 font-mono normal-case hover:text-foreground",
              scriptOpen && "text-foreground",
            )}
            aria-expanded={scriptOpen}
          >
            {section.scriptToggleLabel}
          </button>
        ) : null}
        <span className="ml-auto font-mono normal-case text-muted-foreground/80">
          {section.settledText}
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onCollapse}
          aria-label={section.collapseAriaLabel}
        >
          <ChevronDown aria-hidden className="size-3" />
        </Button>
      </div>
      <PhaseRail segments={section.phaseRail} />
      {scriptOpen && canShowScript ? (
        <WorkflowScriptView
          environmentId={environmentId}
          threadId={threadId}
          scriptPath={scriptPath}
          onClose={() => setScriptOpen(false)}
        />
      ) : null}
      {section.phases.map((phase) => (
        <PhaseSection key={phase.index} phase={phase} />
      ))}
      {section.unphasedRows.map((row) => (
        <AgentRow key={row.id} row={row} />
      ))}
      {section.fallbackRow ? <AgentRow row={section.fallbackRow} /> : null}
    </section>
  );
}

/**
 * Collapsed workflow: one summary line. The parent owns expansion so a live
 * workflow keeps its shape when it settles.
 */
function CollapsedWorkflowSection({
  section,
  onExpand,
}: {
  section: AgentWorkflowCollapsedModel;
  onExpand: () => void;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/40"
        aria-expanded={false}
      >
        <StatusDot tone={section.statusTone} />
        <span className="truncate text-sm">{section.title}</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-2xs text-muted-foreground/80">
          {section.failedText ? (
            <span className="text-destructive-foreground">{section.failedText}</span>
          ) : null}
          <span>{section.agentsText}</span>
          <span className="tabular-nums">{section.tokensText}</span>
          {section.elapsedText ? <span className="tabular-nums">{section.elapsedText}</span> : null}
          <ChevronRight aria-hidden className="size-3" />
        </span>
      </button>
    </section>
  );
}

/** A workflow's open state is presentation state, not a status derivative. */
function WorkflowSection({
  section,
  environmentId,
  threadId,
}: {
  section: AgentWorkflowSectionModel;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
}) {
  const [open, setOpen] = useState(section.defaultExpanded);
  return open ? (
    <ExpandedWorkflowSection
      section={section.expanded}
      environmentId={environmentId}
      threadId={threadId}
      onCollapse={() => setOpen(false)}
    />
  ) : (
    <CollapsedWorkflowSection section={section.collapsed} onExpand={() => setOpen(true)} />
  );
}

export function AgentsPanel({
  model,
  environmentId = null,
  threadId = null,
}: {
  model: AgentPanelModel;
  environmentId?: EnvironmentId | null;
  threadId?: ThreadId | null;
}) {
  const view = buildAgentsPanelModel({ model, nowMs: Date.now() });
  if (view.kind === "empty") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Bot aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">{view.empty.title}</p>
        <p className="max-w-56 text-xs text-muted-foreground">{view.empty.description}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {view.workflows.map((section) => (
            <WorkflowSection
              key={section.id}
              section={section}
              environmentId={environmentId}
              threadId={threadId}
            />
          ))}
          {view.direct ? (
            <section>
              <div className="px-1.5 pt-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
                {view.direct.title}
              </div>
              {view.direct.rows.map((row) => (
                <AgentRow key={row.id} row={row} />
              ))}
            </section>
          ) : null}
        </div>
      </ScrollArea>
      <footer className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 font-mono text-2xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {view.footer.workingText ? (
            <span className="text-info-foreground">{view.footer.workingText}</span>
          ) : null}
          {view.footer.idleText ? <span>{view.footer.idleText}</span> : null}
          {view.footer.settledText ? <span>{view.footer.settledText}</span> : null}
        </span>
        <span className="tabular-nums">{view.footer.totalTokensText}</span>
      </footer>
    </div>
  );
}
