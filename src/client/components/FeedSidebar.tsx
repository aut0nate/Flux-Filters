import type { MinifluxFeed } from "../../shared/miniflux";
import { countRules, getFeedAllowRules, getFeedBlockRules } from "../../shared/miniflux";

interface FeedSidebarProps {
  feeds: MinifluxFeed[];
  selectedFeedId: number | null;
  search: string;
  onSearchChange: (value: string) => void;
  onlyWithRules: boolean;
  onOnlyWithRulesChange: (value: boolean) => void;
  onSelectFeed: (feedId: number) => void;
}

export default function FeedSidebar({
  feeds,
  selectedFeedId,
  search,
  onSearchChange,
  onlyWithRules,
  onOnlyWithRulesChange,
  onSelectFeed
}: FeedSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__top">
        <div className="sidebar__heading">
          <div>
            <p className="eyebrow">Feed dashboard</p>
            <h2>Feeds</h2>
          </div>
          <span className="pill sidebar__count">{feeds.length}</span>
        </div>

        <div className="sidebar__controls">
          <input
            className="search-input"
            type="search"
            placeholder="Search feeds"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />

          <label className="toggle">
            <input
              type="checkbox"
              checked={onlyWithRules}
              onChange={(event) => onOnlyWithRulesChange(event.target.checked)}
            />
            <span>Only show feeds with rules</span>
          </label>
        </div>

        <p className="sidebar__meta">
          Select a feed to inspect its rule order and edit block or allow patterns.
        </p>
      </div>

      <div className="feed-list">
        {feeds.length === 0 ? (
          <div className="empty-state compact">No feeds match your search.</div>
        ) : null}

        {feeds.map((feed) => {
          const blockCount = countRules(getFeedBlockRules(feed));
          const allowCount = countRules(getFeedAllowRules(feed));
          const selected = feed.id === selectedFeedId;

          return (
            <button
              key={feed.id}
              type="button"
              className={`feed-item${selected ? " feed-item--selected" : ""}`}
              onClick={() => onSelectFeed(feed.id)}
            >
              <div className="feed-item__title-row">
                <strong>{feed.title}</strong>
                <span className="feed-item__id">#{feed.id}</span>
              </div>
              <p>{feed.feed_url}</p>
              <div className="feed-item__counts">
                <span>{blockCount} block</span>
                <span>{allowCount} allow</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
