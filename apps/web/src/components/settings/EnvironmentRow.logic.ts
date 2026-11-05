import {
  resolveEnvironmentMachineKind,
  type DesktopSshEnvironmentTarget,
  type EnvironmentId,
  type EnvironmentMachineKind,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import type { EnvironmentPresentation } from "../../state/environments";

export function formatDesktopSshTarget(target: DesktopSshEnvironmentTarget): string {
  const authority = target.username ? `${target.username}@${target.hostname}` : target.hostname;
  return target.port ? `${authority}:${target.port}` : authority;
}

export function environmentTransportLabel(environment: EnvironmentPresentation): string {
  const { entry } = environment;
  if (entry.target._tag === "PrimaryConnectionTarget") return "This machine";
  if (environment.relayManaged) return "T3 Connect";
  if (isDesktopLocalConnectionTarget(entry.target)) return "WSL";
  if (
    entry.target._tag === "SshConnectionTarget" &&
    Option.isSome(entry.profile) &&
    entry.profile.value._tag === "SshConnectionProfile"
  ) {
    return `SSH ${formatDesktopSshTarget(entry.profile.value.target)}`;
  }
  return environment.displayUrl ?? "Remote link";
}

export type EnvironmentRowModelInput = {
  readonly environment: EnvironmentPresentation;
};

export type EnvironmentRowModel = {
  readonly id: EnvironmentId;
  readonly kind: EnvironmentMachineKind;
  readonly label: string;
  readonly subtitle: string;
};

export function buildEnvironmentRowModel(input: EnvironmentRowModelInput): EnvironmentRowModel {
  const { environment } = input;
  return {
    id: environment.environmentId,
    kind: resolveEnvironmentMachineKind(environment.serverConfig),
    label: environment.label,
    subtitle: environmentTransportLabel(environment),
  };
}
