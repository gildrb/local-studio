import { execFile } from "node:child_process";

function openerCommand(target: string): readonly [string, ReadonlyArray<string>] {
  if (process.platform === "darwin") return ["open", [target]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", "", target]];
  return ["xdg-open", [target]];
}

export function openExternal(url: string): Promise<void> {
  const [command, args] = openerCommand(url);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  execFile(command, [...args], (error) => (error ? reject(error) : resolve()));
  return promise;
}
