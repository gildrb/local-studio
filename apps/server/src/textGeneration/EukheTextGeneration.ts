import {
  type EukheSettings,
  PI_DEFAULT_MODEL,
  type ModelSelection,
  TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import {
  EUKHE_MODEL_CONFIG_ID,
  EUKHE_THOUGHT_LEVEL_CONFIG_ID,
  REASONING_OPTION_ID,
  eukheModelValueForSlug,
  eukheSessionCatalogFromConfigOptions,
  makeEukheAcpRuntime,
  resolveEukheBinary,
} from "../provider/acp/EukheAcpSupport.ts";
import type { AcpSessionRuntime } from "../provider/acp/AcpSessionRuntime.ts";
import type * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const EUKHE_TEXT_TIMEOUT_MS = 180_000;

const isTextGenerationError = Schema.is(TextGenerationError);

export const makeEukheTextGeneration = Effect.fn("makeEukheTextGeneration")(function* (
  settings: EukheSettings,
  environment: NodeJS.ProcessEnv,
) {
  const runEukheJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const binary = yield* resolveEukheBinary(settings, environment);
      if (binary._tag !== "Resolved") {
        return yield* new TextGenerationError({
          operation,
          detail: binary.detail,
        });
      }
      const applySelection = (runtime: AcpSessionRuntime["Service"]) =>
        Effect.gen(function* () {
          const slug = modelSelection.model;
          if (slug && slug !== PI_DEFAULT_MODEL) {
            const configOptions = yield* runtime.getConfigOptions;
            const value = eukheModelValueForSlug(configOptions, slug);
            if (!value) {
              return yield* new TextGenerationError({
                operation,
                detail: `Eukhe does not offer model '${slug}'.`,
              });
            }
            yield* runtime.setConfigOption(EUKHE_MODEL_CONFIG_ID, value);
          }
          const effort = getModelSelectionStringOptionValue(modelSelection, REASONING_OPTION_ID);
          if (effort) {
            const catalog = eukheSessionCatalogFromConfigOptions(yield* runtime.getConfigOptions);
            const values = catalog.reasoningDescriptor?.values ?? [];
            if (values.includes(effort)) {
              yield* runtime.setConfigOption(EUKHE_THOUGHT_LEVEL_CONFIG_ID, effort);
            }
          }
        });
      const outcome = yield* Effect.gen(function* () {
        const runtime = yield* makeEukheAcpRuntime({
          bin: binary.bin,
          cwd,
          environment,
          childProcessSpawner: spawner,
          clientInfo: { name: "t3-code-eukhe-text", version: "0.0.0" },
          extraArgs: ["--no-session"],
        }).pipe(Effect.provideService(Crypto.Crypto, crypto));
        const outputRef = yield* Ref.make("");
        yield* runtime.handleSessionUpdate((notification) => {
          const update = notification.update;
          if (update.sessionUpdate !== "agent_message_chunk") {
            return Effect.void;
          }
          const content = update.content;
          if (content.type !== "text") {
            return Effect.void;
          }
          return Ref.update(outputRef, (current) => current + content.text);
        });
        yield* runtime.start();
        yield* applySelection(runtime);
        const promptResult = yield* runtime.prompt({
          prompt: [{ type: "text", text: prompt }],
        });
        return { promptResult, text: (yield* Ref.get(outputRef)).trim() };
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause: EffectAcpErrors.AcpError | TextGenerationError) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({ operation, detail: "Eukhe request failed.", cause }),
        ),
        Effect.timeoutOption(EUKHE_TEXT_TIMEOUT_MS),
      );
      if (Option.isNone(outcome)) {
        return yield* new TextGenerationError({
          operation,
          detail: "Eukhe request timed out.",
        });
      }
      const { promptResult, text } = outcome.value;
      const trimmed = text;
      if (!trimmed) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "Eukhe request was cancelled."
              : "Eukhe returned empty output.",
        });
      }
      return yield* Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))(
        extractJsonObject(trimmed),
      ).pipe(
        Effect.mapError(
          (cause: unknown) =>
            new TextGenerationError({
              operation,
              detail: "Eukhe returned malformed JSON output.",
              cause,
            }),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: "Eukhe text generation failed.",
              cause,
            }),
      ),
    );

  return {
    generateCommitMessage: (input) => {
      const built = buildCommitMessagePrompt({
        ...input,
        includeBranch: input.includeBranch === true,
      });
      return runEukheJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchemaJson: built.outputSchema,
        modelSelection: input.modelSelection,
      }).pipe(
        Effect.map((generated) => ({
          subject: sanitizeCommitSubject(generated.subject),
          body: generated.body.trim(),
          ...("branch" in generated && typeof generated.branch === "string"
            ? { branch: sanitizeFeatureBranchName(generated.branch) }
            : {}),
        })),
      );
    },
    generatePrContent: (input) => {
      const built = buildPrContentPrompt(input);
      return runEukheJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchemaJson: built.outputSchema,
        modelSelection: input.modelSelection,
      }).pipe(
        Effect.map((generated) => ({
          title: sanitizePrTitle(generated.title),
          body: generated.body.trim(),
        })),
      );
    },
    generateBranchName: (input) => {
      const built = buildBranchNamePrompt(input);
      return runEukheJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchemaJson: built.outputSchema,
        modelSelection: input.modelSelection,
      }).pipe(Effect.map((generated) => ({ branch: sanitizeBranchFragment(generated.branch) })));
    },
    generateThreadTitle: (input) => {
      const built = buildThreadTitlePrompt(input);
      return runEukheJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchemaJson: built.outputSchema,
        modelSelection: input.modelSelection,
      }).pipe(
        Effect.map((generated) => ({
          title: sanitizeThreadTitle(generated.title),
          ...(generated.needsRefinement ? { needsRefinement: true } : {}),
        })),
      );
    },
  } satisfies TextGeneration.TextGeneration["Service"];
});
