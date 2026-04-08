import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { fetchFeed, fetchFeeds, saveFeedRules, testConnection, type ClientSession } from "./api";
import FeedSidebar from "./components/FeedSidebar";
import LoginScreen from "./components/LoginScreen";
import RuleEditor from "./components/RuleEditor";
import SummaryCards from "./components/SummaryCards";
import ThemeToggle from "./components/ThemeToggle";
import {
  compileRuleText,
  countRules,
  getFeedAllowRules,
  getFeedBlockRules,
  hasEntryFilterRules,
  parseRuleText,
  type MinifluxFeed,
  type RuleDraft
} from "../shared/miniflux";

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

const SESSION_STORAGE_KEY = "flux-filters-session";
const THEME_STORAGE_KEY = "flux-filters-theme";

type ThemeMode = "dark" | "light";

function readSavedSession(): SavedSession | null {
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
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
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function readSavedTheme(): ThemeMode {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function createDraftState(feed: MinifluxFeed | null): DraftState {
  return {
    feedId: feed?.id ?? null,
    blockRules: parseRuleText(getFeedBlockRules(feed || {})),
    allowRules: parseRuleText(getFeedAllowRules(feed || {}))
  };
}

export default function App() {
  const [session, setSession] = useState<SavedSession | null>(() => readSavedSession());
  const [theme, setTheme] = useState<ThemeMode>(() => readSavedTheme());
  const [feeds, setFeeds] = useState<MinifluxFeed[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [draftState, setDraftState] = useState<DraftState>(() => createDraftState(null));
  const [activeTab, setActiveTab] = useState<RuleTab>("block");
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingFeeds, setLoadingFeeds] = useState(false);
  const [loadingSelectedFeed, setLoadingSelectedFeed] = useState(false);
  const [sessionError, setSessionError] = useState("");
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
              : nextFeeds[0]?.id ?? null
          );
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Unable to load feeds.";
        setSessionError(message);

        if (message.toLowerCase().includes("unauthor")) {
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

  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;

  useEffect(() => {
    setDraftState(createDraftState(selectedFeed));
    setSaveError("");
    setSaveMessage("");
  }, [
    selectedFeed?.id,
    selectedFeed?.block_filter_entry_rules,
    selectedFeed?.keep_filter_entry_rules,
    selectedFeed?.blocklist_rules,
    selectedFeed?.keeplist_rules
  ]);

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

  const filteredFeeds = feeds.filter((feed) => {
    const matchesSearch =
      deferredSearch.trim() === "" ||
      feed.title.toLowerCase().includes(deferredSearch.toLowerCase()) ||
      feed.feed_url.toLowerCase().includes(deferredSearch.toLowerCase());

    if (!matchesSearch) {
      return false;
    }

    if (onlyWithRules && !hasEntryFilterRules(feed)) {
      return false;
    }

    return true;
  });

  const dirty =
    selectedFeed !== null &&
    (compileRuleText(draftState.blockRules) !== getFeedBlockRules(selectedFeed).trim() ||
      compileRuleText(draftState.allowRules) !== getFeedAllowRules(selectedFeed).trim());

  const totalBlockRules = feeds.reduce((count, feed) => count + countRules(getFeedBlockRules(feed)), 0);
  const totalAllowRules = feeds.reduce((count, feed) => count + countRules(getFeedAllowRules(feed)), 0);
  const feedsWithRules = feeds.filter((feed) => hasEntryFilterRules(feed)).length;

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
    setSelectedFeedId(null);
    setSessionError("");
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
        <div>
          <h1>Minflux Filters</h1>
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
            onClick={() => {
              setLoadingFeeds(true);
              void fetchFeeds(session)
                .then((nextFeeds) => setFeeds(nextFeeds))
                .catch((error) =>
                  setSessionError(error instanceof Error ? error.message : "Unable to refresh feeds.")
                )
                .finally(() => setLoadingFeeds(false));
            }}
            disabled={loadingFeeds}
          >
            {loadingFeeds ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="ghost-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <SummaryCards
        totalFeeds={feeds.length}
        feedsWithRules={feedsWithRules}
        totalBlockRules={totalBlockRules}
        totalAllowRules={totalAllowRules}
      />

      {sessionError ? <div className="form-error">{sessionError}</div> : null}

      <main className="workspace">
        <FeedSidebar
          feeds={filteredFeeds}
          selectedFeedId={selectedFeedId}
          search={search}
          onSearchChange={setSearch}
          onlyWithRules={onlyWithRules}
          onOnlyWithRulesChange={setOnlyWithRules}
          onSelectFeed={setSelectedFeedId}
        />

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
    </div>
  );
}
