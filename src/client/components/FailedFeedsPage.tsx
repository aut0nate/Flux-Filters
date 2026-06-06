import type { MinifluxFeed } from "../../shared/miniflux";

interface FailedFeedsPageProps {
  feeds: MinifluxFeed[];
  minifluxServerUrl: string;
  loading: boolean;
  refreshMessage: string;
  onBack: () => void;
  onRefreshFeeds: () => void;
  onSelectFeed: (feedId: number) => void;
}

function joinMinifluxUrl(serverUrl: string, path: string): string {
  const base = new URL(serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`);
  return new URL(path.replace(/^\//, ""), base).toString();
}

function getFeedEntriesUrl(serverUrl: string, feedId: number): string {
  return joinMinifluxUrl(serverUrl, `/feed/${feedId}/entries`);
}

function formatCheckedAt(value?: string): string {
  if (!value) {
    return "Never checked";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Last check unavailable";
  }

  return `Last checked ${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date)}`;
}

function getErrorSummary(feed: MinifluxFeed): string {
  const count = feed.parsing_error_count ?? 0;
  const label = count === 1 ? "1 error" : `${count} errors`;
  const message = feed.parsing_error_message?.trim();

  if (!message) {
    return label;
  }

  return `${label} - ${message}`;
}

export default function FailedFeedsPage({
  feeds,
  minifluxServerUrl,
  loading,
  refreshMessage,
  onBack,
  onRefreshFeeds,
  onSelectFeed
}: FailedFeedsPageProps) {
  return (
    <section className="failed-feeds-panel">
      <div className="failed-feeds-panel__header">
        <div>
          <button type="button" className="ghost-button back-button" onClick={onBack}>
            <span aria-hidden="true" className="back-button__icon">
              &larr;
            </span>
            <span>Back</span>
          </button>
          <p className="eyebrow">Feed Health</p>
          <h2>Failed Feeds</h2>
          <p className="subtle">
            Feeds with Miniflux parsing errors are listed here so you can review them without
            leaving Flux Filters.
          </p>
        </div>

        <div className="failed-feeds-panel__actions">
          <span className="failed-count-badge">{feeds.length} failed</span>
          <button
            type="button"
            className="primary-button"
            onClick={onRefreshFeeds}
            disabled={loading || feeds.length === 0}
          >
            {loading ? "Retrying..." : "Retry Failed Feeds"}
          </button>
        </div>
      </div>

      {refreshMessage ? <div className="form-success">{refreshMessage}</div> : null}

      {feeds.length === 0 ? (
        <div className="empty-state">No failed feeds are currently reported by Miniflux.</div>
      ) : (
        <div className="failed-feed-list">
          {feeds.map((feed) => (
            <article className="failed-feed-card" key={feed.id}>
              <div className="failed-feed-card__body">
                <div>
                  <p className="failed-feed-card__meta">
                    {feed.category?.title ? `${feed.category.title} | ` : ""}
                    {formatCheckedAt(feed.checked_at)}
                    {feed.disabled ? " | Disabled" : ""}
                  </p>
                  <h3>{feed.title}</h3>
                </div>

                <p className="failed-feed-card__url">{feed.feed_url}</p>
                <p className="failed-feed-card__error">{getErrorSummary(feed)}</p>
              </div>

              <div className="failed-feed-card__actions">
                <a
                  className="ghost-button failed-feed-card__link"
                  href={getFeedEntriesUrl(minifluxServerUrl, feed.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View in Miniflux
                </a>
                {feed.site_url ? (
                  <a
                    className="ghost-button failed-feed-card__link"
                    href={feed.site_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Site
                  </a>
                ) : null}
                <a
                  className="ghost-button failed-feed-card__link"
                  href={feed.feed_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Feed URL
                </a>
                <button type="button" className="ghost-button" onClick={() => onSelectFeed(feed.id)}>
                  Manage Rules
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
