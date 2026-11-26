import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budget = 4000;
const baselineArgIndex = process.argv.indexOf("--baseline");
const baseline =
  baselineArgIndex >= 0
    ? process.argv[baselineArgIndex + 1]
    : execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root }).toString().trim();

const EXCLUDED = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)_generated\//,
  /(^|\/)native\/vendor\//,
  /(^|\/)dist\//,
  /(^|\/)dist-electron\//,
  /(^|\/)\.t3\//,
  /(^|\/)CHANGELOG\.md$/,
  /\.snap$/,
];

const numstat = execFileSync("git", ["diff", "--numstat", `${baseline}..HEAD`], {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
})
  .toString()
  .split("\n")
  .filter((line) => line.trim().length > 0);

const perFile = [];
for (const line of numstat) {
  const [added, deleted, file] = line.split("\t");
  if (added === "-" || deleted === "-") continue;
  if (EXCLUDED.some((pattern) => pattern.test(file))) continue;
  perFile.push({ file, added: Number(added) });
}

const total = perFile.reduce((sum, entry) => sum + entry.added, 0);
const top = [...perFile].sort((a, b) => b.added - a.added).slice(0, 15);
for (const entry of top) {
  console.log(`${String(entry.added).padStart(6)}  ${entry.file}`);
}
console.log(`baseline ${baseline.slice(0, 12)}: ${total} lines, cap ${budget}`);
if (total > budget) {
  console.error(`check:budget failed: ${total} > ${budget}`);
  process.exit(1);
}
