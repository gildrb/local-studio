import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ExternalLinkIcon, PackagePlusIcon, PaletteIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  importOpenVsxThemeExtension,
  searchOpenVsxThemes,
  type OpenVsxThemeExtension,
  type OpenVsxThemeSort,
} from "../../openVsxThemes";
import { useDebouncedValue } from "../../state/queries";
import {
  getCustomThemes,
  getStoredCustomThemeCollection,
  replaceCustomThemeCollection,
  type ThemeDefinition,
} from "../../themePalette";
import { GitHubIcon, GitLabIcon } from "../Icons";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import {
  buildThemeSearchModel,
  resolveThemeInstallStart,
  resolveThemeSearchSort,
  resolveThemeSearchSuggestion,
  themeSearchErrorMessage,
  themeSearchKey,
  THEME_SEARCH_DEBOUNCE_MS,
  THEME_SEARCH_DEFAULT_SORT,
  THEME_SEARCH_FAILURE_FALLBACK,
  THEME_SEARCH_INSTALL_FAILURE_FALLBACK,
  THEME_SEARCH_READ_INSTALLED_FALLBACK,
  type ThemeSourceLinkIcon,
} from "./ThemeSearchSection.logic";

function SourceLinkIcon({ icon }: { icon: ThemeSourceLinkIcon }) {
  if (icon === "github") return <GitHubIcon className="size-3.5" />;
  if (icon === "gitlab") return <GitLabIcon className="size-3.5" monochrome />;
  return <ExternalLinkIcon className="size-3.5" />;
}

function ThemeExtensionIcon({ iconUrl }: { iconUrl: string | null }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
      {iconUrl && !failed ? (
        <img
          alt=""
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={iconUrl}
          onError={() => setFailed(true)}
        />
      ) : (
        <PaletteIcon className="size-4" />
      )}
    </div>
  );
}

export function ThemeSearchSection({
  open,
  onInstalled,
}: {
  open: boolean;
  onInstalled: (themes: ReadonlyArray<ThemeDefinition>, context: { updated: boolean }) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<OpenVsxThemeSort>(THEME_SEARCH_DEFAULT_SORT);
  const [results, setResults] = useState<ReadonlyArray<OpenVsxThemeExtension> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<OpenVsxThemeExtension | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  // The (query, sort) pair the last search actually ran, so an install
  // finishing can tell a same-key rerun (which must not wipe an install
  // error) from a query that changed mid-install (which must be searched).
  const lastSearchKeyRef = useRef<string | null>(null);
  // The (query, sort) pair from the previous effect run, so a search error
  // that belongs to an older key can be cleared when the user returns to
  // already-shown results without clearing a fresh install error.
  const prevSearchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    if (open) {
      lastSearchKeyRef.current = null;
      prevSearchKeyRef.current = null;
      setQuery("");
      setSortBy(THEME_SEARCH_DEFAULT_SORT);
      setResults(null);
      setError(null);
      setIsSearching(false);
      setInstallingId(null);
      setPendingUpdate(null);
    }
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [open]);

  const runSearch = useCallback(
    async (searchText: string, nextSort = sortBy) => {
      const trimmed = searchText.trim();
      if (!trimmed) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setError(null);
      setIsSearching(true);
      try {
        const nextResults = await searchOpenVsxThemes(trimmed, {
          signal: controller.signal,
          sortBy: nextSort,
        });
        if (!controller.signal.aborted) {
          setResults(nextResults);
          lastSearchKeyRef.current = themeSearchKey(trimmed, nextSort);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setResults(null);
          lastSearchKeyRef.current = null;
          setError(themeSearchErrorMessage(cause, THEME_SEARCH_FAILURE_FALLBACK));
        }
      }
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsSearching(false);
      }
    },
    [sortBy],
  );

  const debouncedQuery = useDebouncedValue(query.trim(), THEME_SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (query.trim() || installingId !== null) return;
    requestRef.current?.abort();
    requestRef.current = null;
    lastSearchKeyRef.current = null;
    setResults(null);
    setError(null);
    setIsSearching(false);
  }, [query, installingId]);

  useEffect(() => {
    if (!open) return;
    const searchKey = themeSearchKey(debouncedQuery, sortBy);
    const keyChanged = prevSearchKeyRef.current !== searchKey;
    prevSearchKeyRef.current = searchKey;
    if (installingId !== null) return;
    if (!debouncedQuery) {
      lastSearchKeyRef.current = null;
      requestRef.current?.abort();
      requestRef.current = null;
      setResults(null);
      setError(null);
      setIsSearching(false);
      return;
    }
    if (debouncedQuery !== query.trim()) {
      // The debounced value still trails the input (dialog reopened with the
      // box reset, or the user is mid-keystroke). Searching it would hit Open
      // VSX for a query that is no longer visible; wait for the debounce to
      // catch up to the current input instead.
      return;
    }
    if (lastSearchKeyRef.current === searchKey) {
      // The results already match this query. A request for a newer key may
      // still be in flight (typed and then undone); abort it so it cannot
      // overwrite the results. Only a genuine key change makes a stale search
      // error irrelevant, so an install error on an unchanged query survives.
      requestRef.current?.abort();
      requestRef.current = null;
      setIsSearching(false);
      if (keyChanged) setError(null);
      return;
    }
    void runSearch(debouncedQuery);
    // `sortBy` is deliberately not a direct dependency: the guards above read
    // the current value from the fresh render closure. An install finishing
    // reruns the search only when the query or sort changed while it was in
    // flight (checked via lastSearchKeyRef, recorded only once a search
    // succeeds), so the install error the user needs to see is preserved
    // across that rerun.
  }, [open, query, debouncedQuery, installingId, runSearch]);

  const handleSortChange = useCallback((value: OpenVsxThemeSort | null) => {
    const nextSort = resolveThemeSearchSort(value);
    if (!nextSort) return;
    setSortBy(nextSort);
  }, []);

  const handleInstall = useCallback(
    async (extension: OpenVsxThemeExtension, allowUpdate: boolean) => {
      setError(null);
      let installedCollection: ReadonlyArray<ThemeDefinition>;
      try {
        installedCollection = getStoredCustomThemeCollection(extension.collectionId);
      } catch (cause) {
        setError(themeSearchErrorMessage(cause, THEME_SEARCH_READ_INSTALLED_FALLBACK));
        return;
      }
      const decision = resolveThemeInstallStart({ installedCollection, allowUpdate });
      if (decision.kind === "confirm-update") {
        setPendingUpdate(extension);
        return;
      }
      const updated = decision.updated;

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setIsSearching(false);
      setInstallingId(extension.id);
      try {
        const themes = await importOpenVsxThemeExtension(extension, controller.signal);
        if (!controller.signal.aborted) {
          const imported = replaceCustomThemeCollection(extension.collectionId, themes, {
            expectedCollection: installedCollection,
          });
          onInstalled(imported, { updated });
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(themeSearchErrorMessage(cause, THEME_SEARCH_INSTALL_FAILURE_FALLBACK));
        }
      }
      if (requestRef.current === controller) {
        requestRef.current = null;
        setInstallingId(null);
      }
    },
    [onInstalled],
  );

  const model = buildThemeSearchModel({
    query,
    sortBy,
    results,
    error,
    isSearching,
    installingId,
    pendingUpdate,
    customThemes: getCustomThemes(),
  });

  return (
    <section className="space-y-3" aria-labelledby={model.headingId}>
      <div>
        <h3 className="text-sm font-medium" id={model.headingId}>
          {model.title}
        </h3>
        <p className="mt-0.5 text-muted-foreground text-xs">{model.description}</p>
      </div>
      <InputGroup>
        <InputGroupAddon>
          {model.input.icon === "spinner" ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
        </InputGroupAddon>
        <InputGroupInput
          aria-label={model.input.ariaLabel}
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !isSearching && installingId === null)
              void runSearch(query.trim());
          }}
          placeholder={model.input.placeholder}
          size="lg"
          type="search"
          value={model.input.value}
        />
      </InputGroup>

      {model.toolbar ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="text-muted-foreground text-xs">{model.toolbar.suggestionsLabel}</p>
            {model.toolbar.suggestions.map((suggestion) => (
              <Button
                key={suggestion.label}
                disabled={suggestion.disabled}
                size="xs"
                variant="ghost"
                onClick={() => {
                  const intent = resolveThemeSearchSuggestion(query, suggestion.label);
                  if (intent.kind === "search") {
                    void runSearch(intent.query);
                  } else {
                    setQuery(intent.query);
                  }
                }}
              >
                {suggestion.label}
              </Button>
            ))}
          </div>
          {model.toolbar.sort ? (
            <div className="flex shrink-0 items-center justify-end gap-2">
              <p className="text-muted-foreground text-xs">{model.toolbar.sort.label}</p>
              <Select
                disabled={model.toolbar.sort.disabled}
                value={model.toolbar.sort.value}
                onValueChange={handleSortChange}
              >
                <SelectTrigger size="sm" className="w-40" aria-label={model.toolbar.sort.ariaLabel}>
                  <SelectValue>{model.toolbar.sort.valueLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {model.toolbar.sort.options.map((option) => (
                    <SelectItem key={option.value} hideIndicator value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sr-only" role="status">
        {model.statusText}
      </div>

      {model.error ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm"
        >
          {model.error}
        </div>
      ) : null}

      {model.loadingText === null ? null : (
        <div className="flex min-h-20 items-center justify-center gap-2 text-muted-foreground text-sm">
          <Spinner /> {model.loadingText}
        </div>
      )}

      {model.empty ? (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
          <p className="text-sm font-medium">{model.empty.title}</p>
          <p className="mt-1 text-muted-foreground text-xs">{model.empty.description}</p>
        </div>
      ) : null}

      {model.results ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {model.results.map((result) => (
            <article
              className="group flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-3 transition-colors hover:bg-accent/20"
              key={result.id}
            >
              <div className="flex min-w-0 gap-3">
                <ThemeExtensionIcon key={result.iconUrl} iconUrl={result.iconUrl} />
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-medium">{result.name}</h4>
                  <p className="truncate text-muted-foreground text-xs">{result.meta}</p>
                </div>
              </div>
              <p className="line-clamp-2 min-h-8 text-muted-foreground text-xs leading-4">
                {result.description}
              </p>
              <div className="mt-auto flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {result.sourceUrl && result.sourceIcon ? (
                    <Button
                      aria-label={result.sourceAriaLabel}
                      render={<a href={result.sourceUrl} rel="noreferrer" target="_blank" />}
                      size="icon-micro"
                      variant="ghost-muted"
                    >
                      <SourceLinkIcon icon={result.sourceIcon} />
                    </Button>
                  ) : null}
                </div>
                <Button
                  aria-label={result.actionAriaLabel}
                  disabled={result.actionDisabled}
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    const extension = results?.find((candidate) => candidate.id === result.id);
                    if (extension) void handleInstall(extension, false);
                  }}
                >
                  {result.actionIcon === "spinner" ? (
                    <Spinner />
                  ) : result.actionIcon === "refresh" ? (
                    <RefreshIcon />
                  ) : (
                    <PackagePlusIcon />
                  )}
                  {result.actionLabel}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <AlertDialog
        open={model.updateDialog.open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingUpdate(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{model.updateDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{model.updateDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {model.updateDialog.cancelLabel}
            </AlertDialogClose>
            <Button
              onClick={() => {
                const extension = pendingUpdate;
                setPendingUpdate(null);
                if (extension) void handleInstall(extension, true);
              }}
            >
              {model.updateDialog.confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}
