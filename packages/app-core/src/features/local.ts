import {
  LocalRecipes,
  LocalRegistry,
  LocalRegistryRecord,
  LocalSharePreview,
  LocalShareResult,
  LocalSnapshot,
  LocalTailnet,
} from "@t3tools/contracts/local-studio";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  LOCAL_MACHINE_UI_DEFAULT,
  buildLocalPageModel,
  resolveLocalJobStop,
  resolveLocalLoad,
  resolveLocalReachableTargets,
  resolveLocalRename,
  resolveLocalTailnetDevice,
  resolveLocalTarget,
  resolveLocalUnload,
  type LocalActRequest,
  type LocalArmDecision,
  type LocalMachineInput,
  type LocalMachineUiState,
  type LocalPageModel,
} from "@t3tools/web/src/components/local/LocalPage.logic.ts";
import {
  REGISTRY_PAGE_SIZE,
  buildRegistryInspectModel,
  buildRegistrySectionModel,
  buildSharePanelModel,
  resolveRegistryDownload,
  resolveRegistryListRequest,
  resolveRegistryRecordRequest,
  resolveSharePreviewRequest,
  resolveSharePrimary,
  type RegistryInspectModel,
  type RegistrySectionModel,
  type SharePanelModel,
  type SharePanelStep,
} from "@t3tools/web/src/components/local/RegistrySection.logic.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { clipboardService } from "../clipboard.ts";
import { openExternal } from "../openExternal.ts";

export type LocalShareView = { readonly url: string; readonly panel: SharePanelModel };

export type LocalPageView = {
  readonly page: LocalPageModel;
  readonly registry: RegistrySectionModel;
  readonly inspect: RegistryInspectModel | null;
  readonly shares: ReadonlyArray<LocalShareView>;
};

type LocalData = {
  readonly root: LocalSnapshot | null;
  readonly snapshots: Readonly<Record<string, LocalSnapshot | undefined>>;
  readonly recipes: Readonly<Record<string, LocalRecipes | undefined>>;
  readonly tailnet: LocalTailnet | null;
  readonly error: string | null;
  readonly busy: string | null;
  readonly nowMs: number;
};

type RegistryState = {
  readonly controller: string;
  readonly all: boolean;
  readonly query: string;
  readonly data: LocalRegistry | null;
  readonly error: string | null;
  readonly open: string | null;
  readonly inspect: string | null;
  readonly limit: number;
};

type InspectState = {
  readonly id: string;
  readonly record: LocalRegistryRecord | null;
  readonly error: string | null;
  readonly downloadState: string | null;
  readonly isCopied: boolean;
};

type ShareState = {
  readonly port: number;
  readonly preview: LocalSharePreview | null;
  readonly step: SharePanelStep;
  readonly url: string | null;
  readonly error: string | null;
};

const POLL_MS = 5000;
const COPY_RESET_MS = 2000;

const UrlParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const EditParams = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String, value: Schema.NullOr(Schema.String) }),
);
const ChoiceParams = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String, recipeId: Schema.String }),
);
const EndpointParams = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String, endpointId: Schema.String }),
);
const JobParams = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String, jobId: Schema.String }),
);
const ShareParams = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String, port: Schema.Number }),
);
const IpParams = Schema.decodeUnknownSync(Schema.Struct({ ip: Schema.String }));
const ControllerParams = Schema.decodeUnknownSync(Schema.Struct({ controller: Schema.String }));
const AllParams = Schema.decodeUnknownSync(Schema.Struct({ all: Schema.Boolean }));
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const RepoParams = Schema.decodeUnknownSync(Schema.Struct({ repo: Schema.String }));
const InspectParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NullOr(Schema.String) }));
const DownloadResult = Schema.Struct({ state: Schema.String });

const HrefParams = Schema.decodeUnknownSync(Schema.Struct({ href: Schema.String }));

export function createLocalFeature(context: FeatureContext): CoreFeature {
  const { registry, state, pageAtom } = context;
  const dataAtom = Atom.make<LocalData>({
    root: null,
    snapshots: {},
    recipes: {},
    tailnet: null,
    error: null,
    busy: null,
    nowMs: Date.now(),
  }).pipe(Atom.keepAlive);
  const machineUiAtom = Atom.make<Readonly<Record<string, LocalMachineUiState>>>({}).pipe(
    Atom.keepAlive,
  );
  const registryAtom = Atom.make<RegistryState>({
    controller: "",
    all: false,
    query: "",
    data: null,
    error: null,
    open: null,
    inspect: null,
    limit: REGISTRY_PAGE_SIZE,
  }).pipe(Atom.keepAlive);
  const inspectAtom = Atom.make<InspectState | null>(null).pipe(Atom.keepAlive);
  const sharesAtom = Atom.make<Readonly<Record<string, ShareState>>>({}).pipe(Atom.keepAlive);
  const shownAtom = Atom.make((get) => {
    const page = get(pageAtom);
    return page.kind === "settings" && page.section === "local";
  });

  const patchData = (patch: Partial<LocalData>) =>
    registry.set(dataAtom, { ...registry.get(dataAtom), ...patch });
  const patchRegistry = (patch: Partial<RegistryState>) =>
    registry.set(registryAtom, { ...registry.get(registryAtom), ...patch });
  const uiOf = (url: string) => registry.get(machineUiAtom)[url] ?? LOCAL_MACHINE_UI_DEFAULT;
  const patchUi = (url: string, patch: Partial<LocalMachineUiState>) =>
    registry.set(machineUiAtom, {
      ...registry.get(machineUiAtom),
      [url]: { ...uiOf(url), ...patch },
    });

  const call = async <A>(
    path: string,
    controller: string,
    schema: Schema.Decoder<A>,
    body?: unknown,
  ): Promise<A> => {
    const environmentId = registry.get(state.primaryEnvironmentIdAtom);
    const connection =
      environmentId === null
        ? Option.none()
        : registry.get(state.environmentSession.preparedConnectionValueAtom(environmentId));
    if (Option.isNone(connection)) throw new Error("Not connected to the server.");
    const result = await runAtomCommand(
      registry,
      state.localStudioHttp,
      { httpBaseUrl: connection.value.httpBaseUrl, path, controller, body },
      { label: `local ${path}`, reportFailure: false },
    );
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return Schema.decodeUnknownSync(schema)(result.value);
  };
  const message = (cause: unknown) => String(cause);

  const fetchEach = async <A>(
    path: string,
    schema: Schema.Decoder<A>,
    controllers: ReadonlyArray<string>,
  ) => {
    const entries = await Promise.all(
      controllers.map((controller) =>
        call(path, controller, schema).then(
          (value) => [[controller, value] as const],
          () => [],
        ),
      ),
    );
    return Object.fromEntries(entries.flat());
  };

  let pollGeneration = 0;
  let pollTimer: NodeJS.Timeout | undefined;
  let copyTimer: NodeJS.Timeout | undefined;
  let recipesKey: string | null = null;

  const refreshRecipes = async (force: boolean) => {
    const reachable = resolveLocalReachableTargets(registry.get(dataAtom).root);
    const key = reachable.join(" ");
    if (!force && key === recipesKey) return;
    recipesKey = key;
    patchData({ recipes: await fetchEach("recipes?archived=1", LocalRecipes, reachable) });
  };

  const pollOnce = async (generation: number) => {
    try {
      const root = await call("snapshot", "", LocalSnapshot);
      const each = await fetchEach(
        "snapshot",
        LocalSnapshot,
        root.controllers.filter((device) => device.reachable).map(resolveLocalTarget),
      );
      if (generation !== pollGeneration) return;
      patchData({
        root,
        nowMs: Date.now(),
        snapshots: Object.fromEntries(
          root.controllers.map((device) => [device.url, each[resolveLocalTarget(device)]]),
        ),
      });
      void refreshRecipes(false);
    } catch (cause) {
      if (generation === pollGeneration) patchData({ error: message(cause) });
    }
  };

  const schedule = (generation: number) => {
    pollTimer = setTimeout(() => {
      void pollOnce(generation).finally(() => {
        if (generation === pollGeneration) schedule(generation);
      });
    }, POLL_MS);
  };

  const stopPolling = () => {
    pollGeneration += 1;
    clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const restartPolling = () => {
    stopPolling();
    const generation = pollGeneration;
    void pollOnce(generation).finally(() => {
      if (generation === pollGeneration) schedule(generation);
    });
  };

  const perform = async <A>(key: string, run: () => Promise<A>, then: (value: A) => void) => {
    patchData({ busy: key, error: null });
    try {
      then(await run());
    } catch (cause) {
      patchData({ error: message(cause) });
    } finally {
      patchData({ busy: null });
    }
  };

  const act = (request: LocalActRequest) =>
    perform(
      request.key,
      () => call(request.path, request.controller, Schema.Unknown, request.body),
      () => {
        restartPolling();
        void refreshRecipes(true);
      },
    );

  const scan = () =>
    perform(
      "scan",
      () => call("tailnet", "", LocalTailnet),
      (tailnet) => patchData({ tailnet }),
    );

  let registryGeneration = 0;
  const loadRegistry = () => {
    const generation = ++registryGeneration;
    const { all, controller } = registry.get(registryAtom);
    call(resolveRegistryListRequest(all).path, controller, LocalRegistry).then(
      (data) => {
        if (generation === registryGeneration) patchRegistry({ data, error: null });
      },
      (cause: unknown) => {
        if (generation === registryGeneration) patchRegistry({ error: message(cause) });
      },
    );
  };

  const loadInspect = (id: string) => {
    registry.set(inspectAtom, {
      id,
      record: null,
      error: null,
      downloadState: null,
      isCopied: false,
    });
    const { controller } = registry.get(registryAtom);
    call(resolveRegistryRecordRequest(id).path, controller, LocalRegistryRecord).then(
      (record) => {
        const current = registry.get(inspectAtom);
        if (current?.id === id) registry.set(inspectAtom, { ...current, record });
      },
      (cause: unknown) => {
        const current = registry.get(inspectAtom);
        if (current?.id === id) registry.set(inspectAtom, { ...current, error: message(cause) });
      },
    );
  };

  const patchShare = (url: string, port: number, patch: Partial<ShareState>) => {
    const current = registry.get(sharesAtom)[url];
    if (current?.port !== port) return;
    registry.set(sharesAtom, { ...registry.get(sharesAtom), [url]: { ...current, ...patch } });
  };

  const closeShare = (url: string) => {
    const { [url]: _closed, ...rest } = registry.get(sharesAtom);
    registry.set(sharesAtom, rest);
    patchUi(url, { sharing: null });
  };

  const machineInput = (url: string): LocalMachineInput => {
    const data = registry.get(dataAtom);
    const device = data.root?.controllers.find((row) => row.url === url);
    if (!device) throw new Error("This machine is no longer listed.");
    return {
      device,
      snapshot: data.snapshots[url],
      recipes: data.recipes[resolveLocalTarget(device)],
      busy: data.busy,
      ui: uiOf(url),
    };
  };

  const apply = async (url: string, decision: LocalArmDecision) => {
    if (decision.kind === "none") return;
    patchUi(url, { armed: decision.armed });
    if (decision.kind === "act") await act(decision.request);
  };

  registry.subscribe(
    shownAtom,
    (shown) => {
      if (!shown) {
        stopPolling();
        return;
      }
      restartPolling();
      recipesKey = null;
      void scan();
      loadRegistry();
    },
    { immediate: true },
  );

  const localPageAtom = Atom.make((get): LocalPageView | null => {
    if (!get(shownAtom)) return null;
    const data = get(dataAtom);
    const machineUi = get(machineUiAtom);
    const page = buildLocalPageModel({ ...data, machineUi });
    const reg = get(registryAtom);
    const inspect = get(inspectAtom);
    return {
      page,
      registry: buildRegistrySectionModel({ ...reg, devices: page.registryDevices }),
      inspect: inspect && reg.inspect === inspect.id ? buildRegistryInspectModel(inspect) : null,
      shares: Object.entries(get(sharesAtom)).map(([url, share]) => ({
        url,
        panel: buildSharePanelModel(share),
      })),
    };
  });

  return {
    views: { localPage: localPageAtom },
    actions: {
      localToggleMachine: async (params) => {
        const { url } = UrlParams(params);
        patchUi(url, { open: !uiOf(url).open });
        return null;
      },
      localToggleAddress: async (params) => {
        const { url } = UrlParams(params);
        patchUi(url, { reveal: !uiOf(url).reveal });
        return null;
      },
      localEditName: async (params) => {
        const { url, value } = EditParams(params);
        patchUi(url, { editing: value });
        return null;
      },
      localSubmitName: async (params) => {
        const { url } = UrlParams(params);
        const input = machineInput(url);
        const editing = input.ui.editing;
        patchUi(url, { editing: null });
        if (editing === null) return null;
        const decision = resolveLocalRename(input.device, editing);
        if (decision.kind === "rename") await act(decision.request);
        return null;
      },
      localChooseRecipe: async (params) => {
        const { url, recipeId } = ChoiceParams(params);
        patchUi(url, { choice: recipeId });
        return null;
      },
      localLoad: async (params) => {
        const { url } = UrlParams(params);
        await apply(url, resolveLocalLoad(machineInput(url)));
        return null;
      },
      localUnload: async (params) => {
        const { url, endpointId } = EndpointParams(params);
        await apply(url, resolveLocalUnload(machineInput(url), endpointId));
        return null;
      },
      localStopJob: async (params) => {
        const { url, jobId } = JobParams(params);
        await act(resolveLocalJobStop(machineInput(url).device, jobId));
        return null;
      },
      localToggleShare: async (params) => {
        const { url, port } = ShareParams(params);
        if (uiOf(url).sharing === port) {
          closeShare(url);
          return null;
        }
        const controller = resolveLocalTarget(machineInput(url).device);
        patchUi(url, { sharing: port });
        registry.set(sharesAtom, {
          ...registry.get(sharesAtom),
          [url]: { port, preview: null, step: "preview", url: null, error: null },
        });
        call(resolveSharePreviewRequest(port).path, controller, LocalSharePreview).then(
          (preview) => patchShare(url, port, { preview }),
          (cause: unknown) => patchShare(url, port, { error: message(cause) }),
        );
        return null;
      },
      localSharePrimary: async (params) => {
        const { url } = UrlParams(params);
        const share = registry.get(sharesAtom)[url];
        if (!share) return null;
        const { port } = share;
        const decision = resolveSharePrimary(share.step, port);
        patchShare(url, port, { step: decision.step });
        if (decision.kind === "create") {
          const controller = resolveLocalTarget(machineInput(url).device);
          await call(decision.path, controller, LocalShareResult, decision.body).then(
            (result) => patchShare(url, port, { url: result.url }),
            (cause: unknown) => patchShare(url, port, { error: message(cause), step: "confirm" }),
          );
        }
        return null;
      },
      localShareDecline: async (params) => {
        closeShare(UrlParams(params).url);
        return null;
      },
      localScan: async () => {
        await scan();
        return null;
      },
      localTailnetDevice: async (params) => {
        const { ip } = IpParams(params);
        const request = resolveLocalTailnetDevice(registry.get(dataAtom).tailnet, ip);
        if (request) await act(request);
        return null;
      },
      localRegistrySetController: async (params) => {
        patchRegistry({ controller: ControllerParams(params).controller });
        loadRegistry();
        return null;
      },
      localRegistrySetAll: async (params) => {
        patchRegistry({ all: AllParams(params).all });
        loadRegistry();
        return null;
      },
      localRegistryQuery: async (params) => {
        patchRegistry({ query: QueryParams(params).query });
        return null;
      },
      localRegistryToggleModel: async (params) => {
        const { repo } = RepoParams(params);
        patchRegistry({ open: registry.get(registryAtom).open === repo ? null : repo });
        return null;
      },
      localRegistryInspect: async (params) => {
        const { id } = InspectParams(params);
        patchRegistry({ inspect: id });
        if (id === null) registry.set(inspectAtom, null);
        else loadInspect(id);
        return null;
      },
      localRegistryShowMore: async () => {
        patchRegistry({ limit: registry.get(registryAtom).limit + REGISTRY_PAGE_SIZE });
        return null;
      },
      localRegistryDownload: async () => {
        const inspect = registry.get(inspectAtom);
        if (!inspect) return null;
        const { id } = inspect;
        const download = resolveRegistryDownload(id);
        const { controller } = registry.get(registryAtom);
        await call(download.path, controller, DownloadResult, download.body).then(
          (result) => {
            const current = registry.get(inspectAtom);
            if (current?.id === id)
              registry.set(inspectAtom, { ...current, downloadState: result.state });
          },
          (cause: unknown) => {
            const current = registry.get(inspectAtom);
            if (current?.id === id)
              registry.set(inspectAtom, { ...current, error: message(cause) });
          },
        );
        return null;
      },
      localRegistryCopy: async () => {
        const inspect = registry.get(inspectAtom);
        const command = inspect?.record?.command;
        if (!inspect || !command) return null;
        await clipboardService(context).writeText(command);
        clearTimeout(copyTimer);
        const current = registry.get(inspectAtom);
        if (current?.id === inspect.id) registry.set(inspectAtom, { ...current, isCopied: true });
        copyTimer = setTimeout(() => {
          const latest = registry.get(inspectAtom);
          if (latest?.id === inspect.id) registry.set(inspectAtom, { ...latest, isCopied: false });
        }, COPY_RESET_MS);
        return null;
      },
      localOpenLink: async (params) => {
        await openExternal(HrefParams(params).href);
        return null;
      },
    },
  };
}
