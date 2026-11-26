import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EukheSettings,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../src/background/BackgroundPolicy.ts";
import * as HostPowerMonitor from "../src/background/HostPowerMonitor.ts";
import { ServerConfig } from "../src/config.ts";
import { checkEukheProviderStatus, EukheDriver } from "../src/provider/Drivers/EukheAcpDriver.ts";
import { makeEukheAcpAdapter } from "../src/provider/Layers/EukheAcpAdapter.ts";
import * as ServerSettings from "../src/serverSettings.ts";
import { makeEukheTextGeneration } from "../src/textGeneration/EukheTextGeneration.ts";

const decodeSettings = Schema.decodeSync(EukheSettings);
const settings = decodeSettings({ enabled: true });

const root = mkdtempSync(join(tmpdir(), "eukhe-acp-e2e-"));
const agentDir = join(root, "agent");
const projectDir = join(root, "project");
const stateDir = join(root, "state");
const attachmentsDir = join(stateDir, "attachments");
mkdirSync(agentDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });
mkdirSync(stateDir, { recursive: true });
mkdirSync(attachmentsDir, { recursive: true });

writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      faux: {
        api: "faux",
        baseUrl: "http://localhost:0",
        apiKey: "sk-faux",
        models: [
          {
            id: "faux-1",
            name: "Faux Model",
            api: "faux",
            baseUrl: "http://localhost:0",
            reasoning: true,
            contextWindow: 128_000,
            maxTokens: 4_096,
          },
          {
            id: "plain-model",
            name: "Plain Model",
            api: "faux",
            baseUrl: "http://localhost:0",
            contextWindow: 128_000,
            maxTokens: 4_096,
          },
        ],
      },
    },
  }),
);
const fauxScriptPath = join(root, "faux-script.json");
writeFileSync(
  fauxScriptPath,
  JSON.stringify({
    modelId: "faux-1",
    reasoning: true,
    tokensPerSecond: 400,
    responses: [
      {
        content: [
          { type: "thinking", thinking: "weighing the request" },
          { type: "text", text: "E2E_OK first turn answer" },
        ],
      },
      {
        content: [
          {
            type: "toolCall",
            name: "bash",
            arguments: { command: "printf done > eukhe-e2e-marker.txt" },
            id: "call-1",
          },
        ],
        stopReason: "toolUse",
      },
      { content: [{ type: "text", text: "marker written" }] },
      { content: [{ type: "text", text: "slow output" }], delayMs: 8_000 },
      { content: [{ type: "text", text: "Eukhe E2E Title" }] },
    ],
  }),
);

const eukheEnv: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: root,
  EUKHE_CODING_AGENT_DIR: agentDir,
  EUKHE_DAEMON_SOCKET: join(root, "daemon.sock"),
  EUKHE_FAUX_SCRIPT: fauxScriptPath,
};

const threadId = "e2e-thread" as ThreadId;
const events: Array<ProviderRuntimeEvent> = [];
const waitFor = (predicate: (event: ProviderRuntimeEvent) => boolean, label: string) =>
  Effect.callback<ProviderRuntimeEvent, Error>((resume) => {
    const deadline = Date.now() + 60_000;
    const poll = () => {
      const found = events.find(predicate);
      if (found) {
        resume(Effect.succeed(found));
        return;
      }
      if (Date.now() > deadline) {
        resume(Effect.fail(new Error(`Timed out waiting for ${label}`)));
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });

const idleHostPowerMonitor = Layer.effect(
  HostPowerMonitor.HostPowerMonitor,
  HostPowerMonitor.make(),
);

const services = ServerConfig.layerTest(projectDir, stateDir).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      NodeServices.layer,
      ServerSettings.layerTest(),
      BackgroundPolicy.layer.pipe(
        Layer.provide(idleHostPowerMonitor),
        Layer.provide(ServerSettings.layerTest()),
      ),
    ),
  ),
);

const program = Effect.gen(function* () {
  yield* Effect.log("eukhe acp e2e: probing the provider");
  const probe = yield* checkEukheProviderStatus(settings, eukheEnv, projectDir).pipe(
    Effect.provide(services),
  );
  assert.equal(probe.status, "ready", `probe status: ${probe.status} (${probe.message ?? ""})`);
  assert.equal(probe.installed, true);
  const slugs = probe.models.map((model) => model.slug).sort();
  assert.ok(slugs.includes("faux/faux-1"), `models: ${slugs.join(", ")}`);
  assert.ok(slugs.includes("faux/plain-model"), `models: ${slugs.join(", ")}`);
  const defaultModel = probe.models.find((model) => model.isDefault);
  assert.ok(defaultModel, "probe has no default model");
  const reasoningOption = probe.models
    .at(0)
    ?.capabilities?.optionDescriptors.find((descriptor) => descriptor.id === "reasoningEffort");
  assert.ok(reasoningOption, "reasoning effort descriptor missing");
  yield* Effect.log(`probe ok: models=${slugs.join(",")} default=${defaultModel.slug}`);

  const driver = yield* EukheDriver.create({
    instanceId: ProviderInstanceId.make("eukhe-e2e"),
    displayName: "Eukhe E2E",
    accentColor: undefined,
    environment: [
      { name: "HOME", value: root },
      { name: "EUKHE_CODING_AGENT_DIR", value: agentDir },
      { name: "EUKHE_DAEMON_SOCKET", value: join(root, "daemon.sock") },
      { name: "EUKHE_FAUX_SCRIPT", value: fauxScriptPath },
    ],
    enabled: true,
    config: decodeSettings({ enabled: true }),
  }).pipe(Effect.provide(services), Effect.scoped);
  assert.equal(driver.driverKind, "eukhe");

  const adapter = driver.adapter;
  yield* Stream.runForEach(adapter.streamEvents, (event) =>
    Effect.sync(() => {
      events.push(event);
    }),
  ).pipe(Effect.forkScoped);

  yield* Effect.log("starting a session");
  const session = yield* adapter.startSession({
    threadId,
    cwd: projectDir,
    runtimeMode: "auto",
    modelSelection: {
      instanceId: ProviderInstanceId.make("eukhe-e2e"),
      model: "faux/faux-1",
    },
  });
  assert.equal(session.status, "ready");
  yield* waitFor(
    (event) => event.type === "session.started" && event.threadId === threadId,
    "session.started",
  );
  yield* waitFor((event) => event.type === "thread.started", "thread.started");

  yield* Effect.log("turn 1: prompt with thinking and a file-writing tool call");
  yield* adapter.sendTurn({
    threadId,
    input: "write the marker file",
    modelSelection: {
      instanceId: ProviderInstanceId.make("eukhe-e2e"),
      model: "faux/faux-1",
    },
  });
  const turnCompleted = yield* waitFor(
    (event) => event.type === "turn.completed",
    "turn.completed",
  );
  assert.equal(
    turnCompleted.type === "turn.completed" ? turnCompleted.payload.state : "",
    "completed",
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "content.delta" &&
        event.payload.streamKind === "assistant_text" &&
        event.payload.delta.includes("marker written"),
    ),
    "assistant text streamed",
  );
  assert.ok(
    events.some(
      (event) => event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
    ),
    "reasoning streamed",
  );
  assert.ok(
    events.some(
      (event) => event.type === "item.completed" && event.payload.itemType === "command_execution",
    ),
    "tool item completed",
  );
  const usageEvent = yield* waitFor(
    (event) => event.type === "thread.token-usage.updated",
    "token usage",
  );
  assert.ok(
    usageEvent.type === "thread.token-usage.updated" && usageEvent.payload.usage.usedTokens > 0,
    "token usage reported",
  );
  assert.ok(
    turnCompleted.type === "turn.completed" && turnCompleted.payload.usage !== undefined,
    "run report attached to turn.completed",
  );
  assert.ok(existsSync(join(projectDir, "eukhe-e2e-marker.txt")), "marker file written");

  yield* Effect.log("resume: stopping and reopening the session");
  const resumeCursor = session.resumeCursor;
  yield* adapter.stopSession(threadId);
  yield* waitFor((event) => event.type === "session.exited", "session.exited");
  const resumed = yield* adapter.startSession({
    threadId,
    cwd: projectDir,
    runtimeMode: "auto",
    resumeCursor,
  });
  assert.ok(resumed.resumeCursor !== undefined);

  yield* Effect.log("turn 2: interrupt a slow turn");
  const sendFiber = yield* adapter
    .sendTurn({
      threadId,
      input: "say something slow",
    })
    .pipe(Effect.forkScoped);
  yield* waitFor((event) => event.type === "turn.started", "turn.started");
  yield* adapter.interruptTurn(threadId);
  const interrupted = yield* waitFor(
    (event) => event.type === "turn.completed" && event.payload.state === "interrupted",
    "interrupted turn.completed",
  );
  assert.ok(interrupted);
  yield* sendFiber.await.pipe(Effect.ignore);

  yield* Effect.log("rollback: undoing the last turn");
  const rolledBack = yield* adapter.rollbackThread(threadId, 1);
  assert.ok(rolledBack.turns.length >= 1, "rollback returned turns");
  assert.ok(!existsSync(join(projectDir, "eukhe-e2e-marker.txt")), "marker file undone");

  yield* Effect.log("text generation");
  const textGeneration = yield* makeEukheTextGeneration(settings, eukheEnv);
  const title = yield* textGeneration.generateThreadTitle({
    cwd: projectDir,
    message: "pick a title",
    modelSelection: {
      instanceId: ProviderInstanceId.make("eukhe-e2e"),
      model: "faux/faux-1",
    },
  });
  assert.ok(title.title.length > 0, `title: ${title.title}`);

  yield* adapter.stopSession(threadId);
  yield* Effect.log("e2e passed");
}).pipe(Effect.scoped, Effect.provide(services));

Effect.runPromiseExit(program).then((exit) => {
  rmSync(root, { recursive: true, force: true });
  if (Exit.isSuccess(exit)) {
    process.stdout.write("EUKHE ACP E2E: PASS\n");
    process.exit(0);
  }
  const cause = exit.cause;
  const detail =
    typeof cause === "object" && cause !== null && "error" in cause
      ? String((cause as { error?: unknown }).error)
      : String(cause);
  process.stderr.write(`EUKHE ACP E2E: FAIL\n${detail}\n${String(cause)}\n`);
  process.exit(1);
});
