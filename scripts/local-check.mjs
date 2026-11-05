import { execFileSync } from "node:child_process";

if (!process.argv.includes("--budget")) {
  const run = (...args) =>
    execFileSync(args[0], args.slice(1), { stdio: "inherit", timeout: 300_000 });
  for (const name of [
    "@t3tools/contracts",
    "@t3tools/shared",
    "t3",
    "@t3tools/web",
    "@t3tools/desktop",
    "@t3tools/mobile",
    "@local-studio/controller",
  ]) {
    run("pnpm", "--filter", name, "typecheck");
  }
  run("pnpm", "--filter", "@t3tools/web", "build");
  run("node", "scripts/local-e2e.mjs");
}
