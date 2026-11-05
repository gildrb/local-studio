import {
  createAllEnvironmentProjectSnapshotsReadyAtom,
  createAllEnvironmentShellsBootstrappedAtom,
} from "./shellBootstrap.logic";
import {
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@t3tools/client-runtime/state/shell";
import { Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { isHostedStaticApp } from "../hostedPairing";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);

export const allEnvironmentShellsBootstrappedAtom = createAllEnvironmentShellsBootstrappedAtom({
  catalogAtom: environmentCatalog.catalogAtom,
  connectionStateAtom: environmentCatalog.stateAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
}).pipe(Atom.withLabel("web-all-environment-shells-bootstrapped"));

export const allEnvironmentProjectSnapshotsReadyAtom =
  createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    shellStateValueAtom: environmentShell.stateValueAtom,
    requiresPrimaryEnvironment: !isHostedStaticApp(),
  });
