import { parseAppUpdateYmlEntries } from "@t3tools/desktop/src/updates/updatePolicy.ts";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

export type UpdateFeedConfig =
  | { readonly provider: "github"; readonly owner: string; readonly repo: string }
  | { readonly provider: "generic"; readonly url: string };

const UpdateFile = Schema.Struct({
  url: Schema.String,
  sha512: Schema.String,
  size: Schema.optional(Schema.Number),
});
export type UpdateFile = typeof UpdateFile.Type;

const UpdateManifest = Schema.Struct({
  version: Schema.String,
  files: Schema.Array(UpdateFile),
  releaseNotes: Schema.optional(Schema.Unknown),
});
const decodeUpdateManifest = Schema.decodeUnknownSync(fromYaml(UpdateManifest));
const decodeLatestRelease = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ tag_name: Schema.String })),
);

export type ReleaseNoteEntry = { readonly version: string; readonly note: string };

export type FeedUpdateInfo = {
  readonly version: string;
  readonly files: ReadonlyArray<UpdateFile>;
  readonly releaseNotes: unknown;
  readonly fileBaseUrl: string;
};

export type FeedQuery = {
  readonly config: UpdateFeedConfig;
  readonly channelFile: string;
  readonly feedChannel: string;
  readonly allowPrerelease: boolean;
  readonly fullChangelog: boolean;
  readonly currentVersion: string;
};

type AtomEntry = { readonly tag: string; readonly note: string };

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/giu, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return XML_ENTITIES[name] ?? entity;
  });
}

function parseAtomEntries(feed: string): ReadonlyArray<AtomEntry> {
  const entries: AtomEntry[] = [];
  for (const match of feed.matchAll(/<entry>([\s\S]*?)<\/entry>/gu)) {
    const body = match[1] ?? "";
    const href = /<link[^>]*href="([^"]*)"/u.exec(body)?.[1];
    const tag = href === undefined ? undefined : /\/tag\/([^/]+)$/u.exec(decodeXmlText(href))?.[1];
    if (tag === undefined) continue;
    const content = /<content[^>]*>([\s\S]*?)<\/content>/u.exec(body)?.[1];
    entries.push({
      tag: decodeURIComponent(tag),
      note: content === undefined ? "No content." : decodeXmlText(content),
    });
  }
  return entries;
}

function versionOfTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function prereleaseChannel(version: string): string | null {
  return parseSemver(version)?.prerelease[0] ?? null;
}

async function request(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, { headers: { accept, "cache-control": "no-cache" } });
  if (!response.ok) {
    throw new Error(`HttpError: ${response.status} ${response.statusText} for ${url}`);
  }
  return response;
}

export function resolveUpdateFeedConfig(appUpdateYml: string): UpdateFeedConfig | null {
  const entries = parseAppUpdateYmlEntries(appUpdateYml);
  if (entries.provider === "github" && entries.owner && entries.repo) {
    return { provider: "github", owner: entries.owner, repo: entries.repo };
  }
  if (entries.provider === "generic" && entries.url) {
    return { provider: "generic", url: entries.url };
  }
  return null;
}

export function isUpdateNewer(input: {
  readonly latestVersion: string;
  readonly currentVersion: string;
  readonly allowDowngrade: boolean;
}): boolean {
  const comparison = compareSemverVersions(input.latestVersion, input.currentVersion);
  return comparison > 0 || (input.allowDowngrade && comparison < 0);
}

async function fetchManifest(
  url: string,
  channelFile: string,
): Promise<typeof UpdateManifest.Type> {
  let raw: string;
  try {
    raw = await (await request(url, "application/x-yaml, text/yaml, */*")).text();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Cannot find ${channelFile} in the latest release artifacts (${url}): ${detail}`,
      { cause },
    );
  }
  return decodeUpdateManifest(raw);
}

async function fetchGitHubUpdate(
  query: FeedQuery,
  config: { readonly owner: string; readonly repo: string },
): Promise<FeedUpdateInfo> {
  const base = `https://github.com/${config.owner}/${config.repo}/releases`;
  const entries = parseAtomEntries(
    await (
      await request(`${base}.atom`, "application/xml, application/atom+xml, text/xml, */*")
    ).text(),
  );
  if (entries.length === 0) throw new Error("No published versions on GitHub");

  let latest: AtomEntry | undefined;
  if (query.allowPrerelease) {
    latest = entries.find(
      (entry) => prereleaseChannel(versionOfTag(entry.tag)) === query.feedChannel,
    );
  } else {
    const tag = decodeLatestRelease(
      await (await request(`${base}/latest`, "application/json")).text(),
    ).tag_name;
    latest = entries.find((entry) => entry.tag === tag) ?? { tag, note: "No content." };
  }
  if (latest === undefined) throw new Error("No published versions on GitHub");

  const fileBaseUrl = `${base}/download/${encodeURIComponent(latest.tag)}/`;
  const manifest = await fetchManifest(`${fileBaseUrl}${query.channelFile}`, query.channelFile);
  const releaseNotes =
    manifest.releaseNotes ??
    (query.fullChangelog
      ? entries
          .map((entry): ReleaseNoteEntry => ({
            version: versionOfTag(entry.tag),
            note: entry.note,
          }))
          .filter((entry) => compareSemverVersions(query.currentVersion, entry.version) < 0)
          .toSorted((left, right) => compareSemverVersions(right.version, left.version))
      : latest.note);
  return { version: manifest.version, files: manifest.files, releaseNotes, fileBaseUrl };
}

async function fetchGenericUpdate(query: FeedQuery, url: string): Promise<FeedUpdateInfo> {
  const fileBaseUrl = url.endsWith("/") ? url : `${url}/`;
  const manifest = await fetchManifest(`${fileBaseUrl}${query.channelFile}`, query.channelFile);
  return {
    version: manifest.version,
    files: manifest.files,
    releaseNotes: manifest.releaseNotes ?? null,
    fileBaseUrl,
  };
}

export function fetchLatestUpdateInfo(query: FeedQuery): Promise<FeedUpdateInfo> {
  return query.config.provider === "github"
    ? fetchGitHubUpdate(query, query.config)
    : fetchGenericUpdate(query, query.config.url);
}

/** The native app's release artifact for one architecture, published next to the Electron files. */
export function nativeUpdateArtifactName(version: string, arch: string): string {
  return `Local-Studio-Native-${version}-${arch}.zip`;
}
