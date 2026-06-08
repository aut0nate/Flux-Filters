import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  ApiError,
  applyDedupeEntries,
  fetchDedupeAudit,
  fetchDedupePreview,
  fetchFeed,
  fetchFeeds,
  fetchStarredEntries,
  refreshAllFeeds,
  refreshFeed,
  saveFeedRules,
  testConnection,
  markDedupeEntriesUnread,
  toggleEntryBookmark,
  type ClientSession
} from "./api";
import DedupeReview from "./components/DedupeReview";
import FeedSidebar from "./components/FeedSidebar";
import FailedFeedsPage from "./components/FailedFeedsPage";
import LoginScreen from "./components/LoginScreen";
import RuleEditor from "./components/RuleEditor";
import StarredQueue from "./components/StarredQueue";
import SummaryCards from "./components/SummaryCards";
import ThemeToggle from "./components/ThemeToggle";
import {
  compileRuleText,
  countRules,
  getFeedAllowRules,
  getFeedBlockRules,
  hasFeedFailure,
  hasEntryFilterRules,
  parseRuleText,
  type MinifluxEntry,
  type MinifluxFeed,
  type RuleDraft
} from "../shared/miniflux";
import type { DedupeAuditRun, DedupePreview } from "../shared/dedupe";

type RuleTab = "block" | "allow";

interface SavedSession extends ClientSession {
  username: string;
  version: string;
}

interface DraftState {
  feedId: number | null;
  blockRules: RuleDraft[];
  allowRules: RuleDraft[];
}

interface PendingSuggestedRule {
  feedId: number;
  rules: RuleDraft[];
}

const SESSION_STORAGE_KEY = "flux-filters-session";
const LEGACY_SESSION_STORAGE_KEY = "flux-filters-session-storage";
const THEME_STORAGE_KEY = "flux-filters-theme";

type ThemeMode = "dark" | "light";
type AppView = "dashboard" | "feed" | "failed-feeds" | "dedupe";

function readSavedSession(): SavedSession | null {
  const raw =
    window.localStorage.getItem(SESSION_STORAGE_KEY) ??
    window.sessionStorage.getItem(SESSION_STORAGE_KEY) ??
    window.sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
}

function writeSavedSession(session: SavedSession | null) {
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function readSavedTheme(): ThemeMode {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function createDraftState(feed: MinifluxFeed | null): DraftState {
  return createDraftStateFromRuleText(
    feed?.id ?? null,
    getFeedBlockRules(feed || {}),
    getFeedAllowRules(feed || {})
  );
}

function createDraftStateFromRuleText(
  feedId: number | null,
  blockRules: string,
  allowRules: string
): DraftState {
  return {
    feedId,
    blockRules: parseRuleText(blockRules),
    allowRules: parseRuleText(allowRules)
  };
}

function scrollToRule(ruleId: string) {
  window.setTimeout(() => {
    document.getElementById(`rule-${ruleId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }, 80);
}

function scrollToStarredEntry(entryId: number) {
  const targetId = `starred-entry-${entryId}`;
  let attempts = 0;

  function scrollWhenReady() {
    const target = document.getElementById(targetId);

    if (!target) {
      attempts += 1;

      if (attempts < 12) {
        window.setTimeout(scrollWhenReady, 80);
      }

      return;
    }

    const scrollParent = target.closest<HTMLElement>(".starred-list");

    if (scrollParent) {
      const parentRect = scrollParent.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetOffset =
        scrollParent.scrollTop +
        targetRect.top -
        parentRect.top -
        scrollParent.clientHeight / 2 +
        targetRect.height / 2;

      scrollParent.scrollTo({
        behavior: "smooth",
        top: Math.max(0, targetOffset)
      });

      scrollParent.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  window.setTimeout(scrollWhenReady, 80);
}

function scrollToPageTop() {
  window.scrollTo({
    behavior: "smooth",
    top: 0
  });
}

export default function App() {
  const [session, setSession] = useState<SavedSession | null>(() => readSavedSession());
  const [theme, setTheme] = useState<ThemeMode>(() => readSavedTheme());
  const [feeds, setFeeds] = useState<MinifluxFeed[]>([]);
  const [starredEntries, setStarredEntries] = useState<MinifluxEntry[]>([]);
  const [starredTotal, setStarredTotal] = useState(0);
  const [dedupePreview, setDedupePreview] = useState<DedupePreview | null>(null);
  const [dedupeAuditRuns, setDedupeAuditRuns] = useState<DedupeAuditRun[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [appView, setAppView] = useState<AppView>("dashboard");
  const [draftState, setDraftState] = useState<DraftState>(() => createDraftState(null));
  const [pendingSuggestedRule, setPendingSuggestedRule] = useState<PendingSuggestedRule | null>(null);
  const returnToStarredEntryId = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<RuleTab>("block");
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingFeeds, setLoadingFeeds] = useState(false);
  const [loadingStarred, setLoadingStarred] = useState(false);
  const [loadingDedupe, setLoadingDedupe] = useState(false);
  const [loadingDedupeAudit, setLoadingDedupeAudit] = useState(false);
  const [loadingSelectedFeed, setLoadingSelectedFeed] = useState(false);
  const [applyingDedupe, setApplyingDedupe] = useState(false);
  const [restoringDedupeEntryIds, setRestoringDedupeEntryIds] = useState<number[]>([]);
  const [sessionError, setSessionError] = useState("");
  const [starredError, setStarredError] = useState("");
  const [dedupeError, setDedupeError] = useState("");
  const [dedupeMessage, setDedupeMessage] = useState("");
  const [failedFeedsMessage, setFailedFeedsMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyWithRules, setOnlyWithRules] = useState(false);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;

    async function loadFeeds() {
      setLoadingFeeds(true);
      setSessionError("");

      try {
        const nextFeeds = await fetchFeeds(session);
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setFeeds(nextFeeds);
          setSelectedFeedId((currentSelectedFeedId) =>
            currentSelectedFeedId && nextFeeds.some((feed) => feed.id === currentSelectedFeedId)
              ? currentSelectedFeedId
              : null
          );
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Unable to load feeds.";
        setSessionError(message);

        if (error instanceof ApiError && error.status === 401) {
          writeSavedSession(null);
          setSession(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingFeeds(false);
        }
      }
    }

    void loadFeeds();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;

    async function loadStarredEntries() {
      setLoadingStarred(true);
      setStarredError("");

      try {
        const response = await fetchStarredEntries(session);
        if (cancelled) {
          return;
        }

        setStarredEntries(response.entries);
        setStarredTotal(response.total);
      } catch (error) {
        if (!cancelled) {
          setStarredError(error instanceof Error ? error.message : "Unable to load starred entries.");
        }
      } finally {
        if (!cancelled) {
          setLoadingStarred(false);
        }
      }
    }

    void loadStarredEntries();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;
  const selectedFeedIdForDraft = selectedFeed?.id ?? null;
  const selectedFeedBlockRules = selectedFeed ? getFeedBlockRules(selectedFeed) : "";
  const selectedFeedAllowRules = selectedFeed ? getFeedAllowRules(selectedFeed) : "";
  const selectedFeedDraftState = useMemo(
    () =>
      createDraftStateFromRuleText(
        selectedFeedIdForDraft,
        selectedFeedBlockRules,
        selectedFeedAllowRules
      ),
    [selectedFeedIdForDraft, selectedFeedBlockRules, selectedFeedAllowRules]
  );

  useEffect(() => {
    setDraftState(selectedFeedDraftState);
    setSaveError("");
    setSaveMessage("");
  }, [selectedFeedDraftState]);

  useEffect(() => {
    if (pendingSuggestedRule && pendingSuggestedRule.feedId === selectedFeedDraftState.feedId) {
      if (loadingSelectedFeed) {
        return;
      }

      setDraftState({
        ...selectedFeedDraftState,
        blockRules: [...selectedFeedDraftState.blockRules, ...pendingSuggestedRule.rules]
      });
      setActiveTab("block");
      setSaveError("");
      setSaveMessage(
        pendingSuggestedRule.rules.length === 1
          ? "Suggested rule added. Review it, then save to Miniflux."
          : "Suggested rules added. Review them, then save to Miniflux."
      );
      scrollToRule(pendingSuggestedRule.rules[pendingSuggestedRule.rules.length - 1].id);
      setPendingSuggestedRule(null);
      return;
    }
  }, [loadingSelectedFeed, pendingSuggestedRule, selectedFeedDraftState]);

  useEffect(() => {
    if (!session || !selectedFeedId) {
      return;
    }

    let cancelled = false;

    async function loadSelectedFeed() {
      setLoadingSelectedFeed(true);

      try {
        const detailedFeed = await fetchFeed(session, selectedFeedId);
        if (cancelled) {
          return;
        }

        setFeeds((current) =>
          current.map((feed) => (feed.id === detailedFeed.id ? detailedFeed : feed))
        );
      } catch (error) {
        if (!cancelled) {
          setSessionError(
            error instanceof Error ? error.message : "Unable to load the selected feed details."
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingSelectedFeed(false);
        }
      }
    }

    void loadSelectedFeed();

    return () => {
      cancelled = true;
    };
  }, [session, selectedFeedId]);

  const filteredFeeds = useMemo(() => {
    const normalisedSearch = deferredSearch.trim().toLowerCase();

    return feeds.filter((feed) => {
      const matchesSearch =
        normalisedSearch === "" ||
        feed.title.toLowerCase().includes(normalisedSearch) ||
        feed.feed_url.toLowerCase().includes(normalisedSearch);

      if (!matchesSearch) {
        return false;
      }

      if (onlyWithRules && !hasEntryFilterRules(feed)) {
        return false;
      }

      return true;
    });
  }, [deferredSearch, feeds, onlyWithRules]);

  const dirty =
    selectedFeed !== null &&
    (compileRuleText(draftState.blockRules) !== getFeedBlockRules(selectedFeed).trim() ||
      compileRuleText(draftState.allowRules) !== getFeedAllowRules(selectedFeed).trim());

  const feedRuleSummary = useMemo(
    () =>
      feeds.reduce(
        (summary, feed) => ({
          totalBlockRules: summary.totalBlockRules + countRules(getFeedBlockRules(feed)),
          totalAllowRules: summary.totalAllowRules + countRules(getFeedAllowRules(feed)),
          feedsWithRules: summary.feedsWithRules + (hasEntryFilterRules(feed) ? 1 : 0)
        }),
        {
          totalBlockRules: 0,
          totalAllowRules: 0,
          feedsWithRules: 0
        }
      ),
    [feeds]
  );
  const { totalBlockRules, totalAllowRules, feedsWithRules } = feedRuleSummary;
  const failedFeeds = useMemo(
    () =>
      feeds
        .filter(hasFeedFailure)
        .sort((left, right) => {
          const errorDifference =
            (right.parsing_error_count ?? 0) - (left.parsing_error_count ?? 0);

          if (errorDifference !== 0) {
            return errorDifference;
          }

          return left.title.localeCompare(right.title, "en-GB", { sensitivity: "base" });
        }),
    [feeds]
  );

  async function handleLogin(payload: ClientSession) {
    setLoadingSession(true);
    setSessionError("");

    try {
      const response = await testConnection(payload);
      const nextSession = {
        ...payload,
        serverUrl: response.serverUrl,
        username: response.user.username,
        version: response.version.version
      };

      writeSavedSession(nextSession);
      setSession(nextSession);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Unable to connect to Miniflux.");
    } finally {
      setLoadingSession(false);
    }
  }

  function handleLogout() {
    writeSavedSession(null);
    setSession(null);
    setFeeds([]);
    setStarredEntries([]);
    setStarredTotal(0);
    setDedupePreview(null);
    setDedupeAuditRuns([]);
    setSelectedFeedId(null);
    setSessionError("");
    setStarredError("");
    setDedupeError("");
    setDedupeMessage("");
    returnToStarredEntryId.current = null;
  }

  function handleChangeRules(tab: RuleTab, rules: RuleDraft[]) {
    setSaveError("");
    setSaveMessage("");
    setDraftState((current) => ({
      ...current,
      blockRules: tab === "block" ? rules : current.blockRules,
      allowRules: tab === "allow" ? rules : current.allowRules
    }));
  }

  function handleReset() {
    setDraftState(createDraftState(selectedFeed));
    setSaveError("");
    setSaveMessage("");
  }

  function handleSelectFeed(feedId: number) {
    returnToStarredEntryId.current = null;
    setSelectedFeedId(feedId);
    setAppView("feed");
    scrollToPageTop();
  }

  function handleShowDashboard() {
    setAppView("dashboard");
    setSaveError("");
    setSaveMessage("");
    setFailedFeedsMessage("");
    scrollToPageTop();
  }

  function handleShowFailedFeeds() {
    returnToStarredEntryId.current = null;
    setAppView("failed-feeds");
    setSaveError("");
    setSaveMessage("");
    setFailedFeedsMessage("");
    scrollToPageTop();
  }

  function handleShowDedupe() {
    returnToStarredEntryId.current = null;
    setAppView("dedupe");
    setSaveError("");
    setSaveMessage("");
    setFailedFeedsMessage("");
    setDedupeError("");
    setDedupeMessage("");
    scrollToPageTop();

    void handleRefreshDedupeAudit();
  }

  function handleBackToDashboard() {
    const targetEntryId = returnToStarredEntryId.current;

    setAppView("dashboard");
    setSaveError("");
    setSaveMessage("");
    returnToStarredEntryId.current = null;

    if (targetEntryId) {
      scrollToStarredEntry(targetEntryId);
      return;
    }

    scrollToPageTop();
  }

  async function handleRefreshFeeds(triggerUpstreamRefresh = false) {
    if (!session) {
      return;
    }

    setLoadingFeeds(true);
    setSessionError("");

    try {
      if (triggerUpstreamRefresh) {
        await refreshAllFeeds(session);
      }

      const nextFeeds = await fetchFeeds(session);
      setFeeds(nextFeeds);
      setSelectedFeedId((currentSelectedFeedId) =>
        currentSelectedFeedId && nextFeeds.some((feed) => feed.id === currentSelectedFeedId)
          ? currentSelectedFeedId
          : null
      );
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Unable to refresh feeds.");
    } finally {
      setLoadingFeeds(false);
    }
  }

  async function handleRefreshFailedFeeds() {
    if (!session || failedFeeds.length === 0) {
      return;
    }

    const failedFeedIds = new Set(failedFeeds.map((feed) => feed.id));

    setLoadingFeeds(true);
    setSessionError("");
    setFailedFeedsMessage("");

    try {
      const results = await Promise.allSettled(
        failedFeeds.map((feed) => refreshFeed(session, feed.id))
      );
      const requestFailures = results.filter((result) => result.status === "rejected").length;
      const nextFeeds = await fetchFeeds(session);
      const nextFailedFeeds = nextFeeds.filter(hasFeedFailure);
      const stillFailingIds = new Set(nextFailedFeeds.map((feed) => feed.id));
      const recoveredCount = [...failedFeedIds].filter((feedId) => !stillFailingIds.has(feedId)).length;
      const stillFailingCount = [...failedFeedIds].filter((feedId) =>
        stillFailingIds.has(feedId)
      ).length;

      setFeeds(nextFeeds);
      setFailedFeedsMessage(
        [
          `Retried ${failedFeedIds.size} failed ${failedFeedIds.size === 1 ? "feed" : "feeds"}.`,
          `${recoveredCount} recovered.`,
          `${stillFailingCount} still failing.`,
          requestFailures > 0
            ? `${requestFailures} refresh ${requestFailures === 1 ? "request" : "requests"} failed.`
            : ""
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Unable to refresh failed feeds.");
    } finally {
      setLoadingFeeds(false);
    }
  }

  async function handleSave() {
    if (!session || !selectedFeed) {
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaveMessage("");

    try {
      const updatedFeed = await saveFeedRules(session, selectedFeed.id, {
        blocklistRules: compileRuleText(draftState.blockRules),
        keeplistRules: compileRuleText(draftState.allowRules)
      });

      setFeeds((current) =>
        current.map((feed) => (feed.id === updatedFeed.id ? updatedFeed : feed))
      );
      setSaveMessage("Rules saved to Miniflux.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save rules.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshStarred() {
    if (!session) {
      return;
    }

    setLoadingStarred(true);
    setStarredError("");

    try {
      const response = await fetchStarredEntries(session);
      setStarredEntries(response.entries);
      setStarredTotal(response.total);
    } catch (error) {
      setStarredError(error instanceof Error ? error.message : "Unable to refresh starred entries.");
    } finally {
      setLoadingStarred(false);
    }
  }

  async function handleRefreshDedupePreview() {
    if (!session) {
      return;
    }

    setLoadingDedupe(true);
    setDedupeError("");
    setDedupeMessage("");

    try {
      const preview = await fetchDedupePreview(session, 7);
      setDedupePreview(preview);
    } catch (error) {
      setDedupeError(error instanceof Error ? error.message : "Unable to check duplicate entries.");
    } finally {
      setLoadingDedupe(false);
    }
  }

  async function handleRefreshDedupeAudit() {
    if (!session) {
      return;
    }

    setLoadingDedupeAudit(true);

    try {
      const audit = await fetchDedupeAudit(session, 7);
      setDedupeAuditRuns(audit.runs);
    } catch (error) {
      setDedupeError(error instanceof Error ? error.message : "Unable to load duplicate history.");
    } finally {
      setLoadingDedupeAudit(false);
    }
  }

  async function handleApplyDedupe() {
    if (!session || !dedupePreview || dedupePreview.markReadEntryIds.length === 0) {
      return;
    }

    setApplyingDedupe(true);
    setDedupeError("");
    setDedupeMessage("");

    try {
      const result = await applyDedupeEntries(session, dedupePreview.markReadEntryIds);
      setDedupeMessage(
        `Marked ${result.markedReadCount} duplicate ${
          result.markedReadCount === 1 ? "article" : "articles"
        } as read.`
      );
      const refreshedPreview = await fetchDedupePreview(session, 7);
      setDedupePreview(refreshedPreview);
      await handleRefreshDedupeAudit();
    } catch (error) {
      setDedupeError(error instanceof Error ? error.message : "Unable to mark duplicate entries as read.");
    } finally {
      setApplyingDedupe(false);
    }
  }

  async function handleRestoreDedupeEntries(entryIds: number[]) {
    if (!session || entryIds.length === 0) {
      return;
    }

    setRestoringDedupeEntryIds(entryIds);
    setDedupeError("");
    setDedupeMessage("");

    try {
      const result = await markDedupeEntriesUnread(session, entryIds);
      setDedupeMessage(
        `Marked ${result.markedUnreadCount} ${
          result.markedUnreadCount === 1 ? "article" : "articles"
        } as unread.`
      );
      await Promise.all([handleRefreshDedupePreview(), handleRefreshDedupeAudit()]);
    } catch (error) {
      setDedupeError(error instanceof Error ? error.message : "Unable to mark duplicate entries as unread.");
    } finally {
      setRestoringDedupeEntryIds([]);
    }
  }

  function handleAddSuggestedRule(entry: MinifluxEntry, rule: RuleDraft) {
    handleAddSuggestedRules(entry, [rule]);
  }

  function handleAddSuggestedRules(entry: MinifluxEntry, rules: RuleDraft[]) {
    if (rules.length === 0) {
      return;
    }

    returnToStarredEntryId.current = entry.id;
    setAppView("feed");

    if (selectedFeedId === entry.feed_id && draftState.feedId === entry.feed_id && !loadingSelectedFeed) {
      setDraftState((current) => ({
        ...current,
        blockRules: [...current.blockRules, ...rules]
      }));
      setActiveTab("block");
      setSaveError("");
      setSaveMessage(
        rules.length === 1
          ? "Suggested rule added. Review it, then save to Miniflux."
          : "Suggested rules added. Review them, then save to Miniflux."
      );
      scrollToRule(rules[rules.length - 1].id);
      return;
    }

    if (selectedFeedId !== entry.feed_id) {
      setLoadingSelectedFeed(true);
    }

    setSelectedFeedId(entry.feed_id);
    setPendingSuggestedRule({ feedId: entry.feed_id, rules });
  }

  async function handleUnstarEntry(entry: MinifluxEntry) {
    if (!session) {
      return;
    }

    try {
      await toggleEntryBookmark(session, entry.id);
      setStarredEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
      setStarredTotal((current) => Math.max(current - 1, 0));
    } catch (error) {
      setStarredError(error instanceof Error ? error.message : "Unable to unstar entry.");
    }
  }

  if (!session) {
    return (
      <LoginScreen
        initialServerUrl=""
        onSubmit={handleLogin}
        loading={loadingSession}
        error={sessionError}
        theme={theme}
        onThemeChange={setTheme}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div className="brand-mark app-header__brand-mark" aria-hidden="true">
            m
          </div>
          <h1>Flux Filters</h1>
          <p className="subtle">
            Signed in as <strong>{session.username}</strong> to {session.serverUrl} on Miniflux{" "}
            {session.version}.
          </p>
        </div>

        <div className="app-header__actions">
          <ThemeToggle theme={theme} onChange={setTheme} />
          <button
            type="button"
            className="ghost-button"
            onClick={handleShowDedupe}
          >
            Duplicates
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={handleShowFailedFeeds}
          >
            Failed Feeds ({failedFeeds.length})
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void handleRefreshFeeds()}
            disabled={loadingFeeds}
          >
            {loadingFeeds ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="ghost-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {sessionError ? <div className="form-error">{sessionError}</div> : null}

      {appView === "dashboard" ? (
        <>
          <SummaryCards
            totalFeeds={feeds.length}
            feedsWithRules={feedsWithRules}
            failedFeeds={failedFeeds.length}
            totalBlockRules={totalBlockRules}
            totalAllowRules={totalAllowRules}
            onShowFailedFeeds={handleShowFailedFeeds}
          />

          <StarredQueue
            entries={starredEntries}
            total={starredTotal}
            loading={loadingStarred}
            error={starredError}
            minifluxServerUrl={session.serverUrl}
            onRefresh={handleRefreshStarred}
            onAddRule={handleAddSuggestedRule}
            onAddRules={handleAddSuggestedRules}
            onUnstar={handleUnstarEntry}
          />

          <main className="workspace workspace--dashboard">
            <FeedSidebar
              feeds={filteredFeeds}
              selectedFeedId={selectedFeedId}
              search={search}
              onSearchChange={setSearch}
              onlyWithRules={onlyWithRules}
              onOnlyWithRulesChange={setOnlyWithRules}
              onSelectFeed={handleSelectFeed}
            />
          </main>
        </>
      ) : appView === "dedupe" ? (
        <main className="workspace workspace--dashboard">
          <DedupeReview
            preview={dedupePreview}
            auditRuns={dedupeAuditRuns}
            loading={loadingDedupe}
            loadingAudit={loadingDedupeAudit}
            applying={applyingDedupe}
            restoringEntryIds={restoringDedupeEntryIds}
            error={dedupeError}
            message={dedupeMessage}
            onBack={handleShowDashboard}
            onPreview={handleRefreshDedupePreview}
            onApply={handleApplyDedupe}
            onRestoreEntries={handleRestoreDedupeEntries}
          />
        </main>
      ) : appView === "failed-feeds" ? (
        <main className="workspace workspace--dashboard">
          <FailedFeedsPage
            feeds={failedFeeds}
            minifluxServerUrl={session.serverUrl}
            loading={loadingFeeds}
            refreshMessage={failedFeedsMessage}
            onBack={handleShowDashboard}
            onRefreshFeeds={() => void handleRefreshFailedFeeds()}
            onSelectFeed={handleSelectFeed}
          />
        </main>
      ) : (
        <main className="workspace workspace--feed">
          <section className="workspace__content">
            {loadingFeeds ? <div className="empty-state">Loading feeds…</div> : null}

            {!loadingFeeds && loadingSelectedFeed ? (
              <div className="empty-state">Loading feed rules…</div>
            ) : null}

            {!loadingFeeds && !loadingSelectedFeed && selectedFeed ? (
              <RuleEditor
                feed={selectedFeed}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                blockRules={draftState.blockRules}
                allowRules={draftState.allowRules}
                onChangeRules={handleChangeRules}
                onSave={handleSave}
                onReset={handleReset}
                onBack={handleBackToDashboard}
                saving={saving}
                dirty={dirty}
                saveError={saveError}
                saveMessage={saveMessage}
              />
            ) : null}

            {!loadingFeeds && !selectedFeed ? (
              <div className="empty-state">Select a feed to inspect its rules.</div>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}
