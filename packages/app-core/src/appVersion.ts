import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as Schema from "effect/Schema";

const PackageSchema = Schema.Struct({ version: Schema.String });

export function readAppVersion(): string {
  const configured = process.env.APP_VERSION?.trim();
  if (configured) return configured;
  const path = fileURLToPath(new URL("../../../apps/web/package.json", import.meta.url));
  return Schema.decodeSync(Schema.fromJsonString(PackageSchema))(readFileSync(path, "utf8"))
    .version;
}
