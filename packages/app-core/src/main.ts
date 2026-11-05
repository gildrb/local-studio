import { createInterface } from "node:readline";
import * as Path from "node:path";
import { format } from "node:util";

import { registerSourceResolution } from "./loader.ts";
import { makeStdoutSend, parseHello, parseInbound, type InboundMessage } from "./protocol.ts";
import { createFileStorage, installLocalStorage } from "./storage/fileStorage.ts";

for (const method of ["log", "info", "debug", "trace"] as const) {
  console[method] = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };
}

registerSourceResolution();

const send = makeStdoutSend();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending: InboundMessage[] = [];
let handle: ((message: InboundMessage) => void) | null = null;
let helloReceived = false;

lines.on("line", (line) => {
  if (line.trim() === "") return;
  if (!helloReceived) {
    helloReceived = true;
    void start(line);
    return;
  }
  let message: InboundMessage;
  try {
    message = parseInbound(line);
  } catch (error) {
    send({ t: "log", level: "error", msg: `Ignoring malformed protocol line: ${String(error)}` });
    return;
  }
  if (handle === null) pending.push(message);
  else handle(message);
});

lines.on("close", () => {
  process.exit(0);
});

async function start(line: string): Promise<void> {
  try {
    const hello = parseHello(line);
    installLocalStorage(
      createFileStorage(Path.join(hello.t3Home, "gpui-core", "local-storage.json")),
    );
    const { startCore } = await import("./app.ts");
    const core = await startCore(hello, send);
    handle = core.handle;
    for (const message of pending.splice(0)) core.handle(message);
  } catch (error) {
    send({ t: "status", phase: "failed", detail: String(error) });
    process.exitCode = 1;
  }
}
