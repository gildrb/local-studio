import type { BitbucketSettings, EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  buildBitbucketCredentialsModel,
  EMPTY_BITBUCKET_CREDENTIALS_DRAFT,
  resolveBitbucketCredentialMethodChange,
  resolveBitbucketCredentialsDraftChange,
  resolveBitbucketCredentialsRemove,
  resolveBitbucketCredentialsSave,
  resolveBitbucketCredentialsSaved,
  type BitbucketCredentialsDraft,
  type BitbucketCredentialsIntent,
} from "./BitbucketCredentialsSettings.logic";

/** A write-only token field. It never shows the saved token; typing a new one replaces it. */
function TokenInput({
  id,
  placeholder,
  draft,
  onDraftChange,
}: {
  readonly id: string;
  readonly placeholder: string;
  readonly draft: string;
  readonly onDraftChange: (draft: string) => void;
}) {
  return (
    <Input
      id={id}
      type="password"
      autoComplete="off"
      size="sm"
      placeholder={placeholder}
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
    />
  );
}

/**
 * Bitbucket credentials for one environment: an access token or an Atlassian
 * account email + API token, never both. Tokens are write-only: the server
 * keeps them in its secret store and only reports whether each one is set.
 */
export function BitbucketCredentialsSettings({
  environmentId,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly onSaved: () => void;
}) {
  const saved = useEnvironmentSettings(environmentId, (settings) => settings.bitbucket);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save Bitbucket credentials",
  });
  const [draft, setDraft] = useState<BitbucketCredentialsDraft>(EMPTY_BITBUCKET_CREDENTIALS_DRAFT);
  const [saving, setSaving] = useState(false);
  const model = buildBitbucketCredentialsModel({ environmentId, saved, draft, saving });

  const save = async (next: BitbucketSettings) => {
    setSaving(true);
    try {
      const result = await updateSettings({
        environmentId,
        input: { patch: { bitbucket: next } },
      });
      if (result._tag === "Success") {
        setDraft(resolveBitbucketCredentialsSaved);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  const runIntent = (intent: BitbucketCredentialsIntent) => {
    if (intent.kind === "save") void save(intent.settings);
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        runIntent(resolveBitbucketCredentialsSave({ saved, draft }));
      }}
    >
      {/* Locked while saving: a successful save clears the drafts, which would drop edits made mid-request. */}
      <fieldset disabled={model.locked} className="contents">
        <ToggleGroup
          aria-label={model.methodGroupAriaLabel}
          variant="segmented"
          value={[model.method]}
          onValueChange={(next) => {
            const methodChoice = resolveBitbucketCredentialMethodChange(next);
            if (methodChoice !== null) setDraft((current) => ({ ...current, methodChoice }));
          }}
        >
          {model.methodOptions.map((option) => (
            <Toggle key={option.value} value={option.value}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {model.description}{" "}
          <InlineButton render={<a href={model.link} target="_blank" rel="noreferrer noopener" />}>
            {model.linkLabel}
            <ExternalLinkIcon aria-hidden className="size-3" />
          </InlineButton>
        </p>
        {model.fields.map((field) => (
          <div key={field.field} className="grid gap-1.5">
            <Label htmlFor={field.id}>{field.label}</Label>
            {field.inputType === "password" ? (
              <TokenInput
                id={field.id}
                placeholder={field.placeholder}
                draft={field.value}
                onDraftChange={(value) =>
                  setDraft((current) =>
                    resolveBitbucketCredentialsDraftChange(current, field.field, value),
                  )
                }
              />
            ) : (
              <Input
                id={field.id}
                type="email"
                autoComplete="off"
                size="sm"
                placeholder={field.placeholder}
                value={field.value}
                onChange={(event) =>
                  setDraft((current) =>
                    resolveBitbucketCredentialsDraftChange(
                      current,
                      field.field,
                      event.target.value,
                    ),
                  )
                }
              />
            )}
          </div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{model.footnote}</p>
          <div className="flex shrink-0 gap-2">
            {model.showRemove ? (
              <Button
                size="xs"
                variant="outline"
                disabled={model.removeDisabled}
                onClick={() => runIntent(resolveBitbucketCredentialsRemove())}
              >
                {model.removeLabel}
              </Button>
            ) : null}
            <Button type="submit" size="xs" disabled={model.saveDisabled}>
              {model.saveLabel}
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
