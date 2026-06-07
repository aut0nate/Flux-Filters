import type {
  DedupeAuditRun,
  DedupeEntrySummary,
  DedupeGroup,
  DedupePreview
} from "../../shared/dedupe";

interface DedupeReviewProps {
  preview: DedupePreview | null;
  auditRuns: DedupeAuditRun[];
  loading: boolean;
  loadingAudit: boolean;
  applying: boolean;
  restoringEntryIds: number[];
  error: string;
  message: string;
  onBack: () => void;
  onPreview: () => Promise<void>;
  onApply: () => Promise<void>;
  onRestoreEntries: (entryIds: number[]) => Promise<void>;
}

const STAGE_LABELS: Record<DedupeGroup["stage"], string> = {
  url: "URL",
  title: "Title",
  "similar-title": "Similar title"
};

export default function DedupeReview({
  preview,
  auditRuns,
  loading,
  loadingAudit,
  applying,
  restoringEntryIds,
  error,
  message,
  onBack,
  onPreview,
  onApply,
  onRestoreEntries
}: DedupeReviewProps) {
  const markReadCount = preview?.markReadEntryIds.length ?? 0;
  const restoringEntryIdSet = new Set(restoringEntryIds);

  return (
    <section className="dedupe-panel">
      <div className="panel-heading">
        <div>
          <button type="button" className="ghost-button" onClick={onBack}>
            Back to dashboard
          </button>
          <p className="eyebrow">Unread duplicate review</p>
          <h2>Duplicate articles</h2>
          <p>
            Flux Filters checks unread articles from the last 7 days, keeps the oldest article in
            each group, and marks newer high-confidence duplicates as read.
          </p>
        </div>
        <div className="panel-heading__actions">
          <button type="button" className="ghost-button" onClick={() => void onPreview()} disabled={loading || applying}>
            {loading ? "Checking…" : "Refresh preview"}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void onApply()}
            disabled={loading || applying || markReadCount === 0}
          >
            {applying ? "Marking as read…" : `Mark ${markReadCount} as read`}
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {message ? <div className="form-success">{message}</div> : null}

      {!preview && !loading ? (
        <div className="empty-state">Run a preview to find duplicate unread articles.</div>
      ) : null}

      {loading && !preview ? <div className="empty-state">Checking unread articles…</div> : null}

      {preview ? (
        <>
          <div className="dedupe-summary">
            <div>
              <span>{preview.totalUnreadEntries}</span>
              <p>Unread checked</p>
            </div>
            <div>
              <span>{preview.groups.length}</span>
              <p>Duplicate groups</p>
            </div>
            <div>
              <span>{markReadCount}</span>
              <p>Will be marked read</p>
            </div>
          </div>

          {preview.groups.length === 0 ? (
            <div className="empty-state">No high-confidence duplicates found.</div>
          ) : (
            <div className="dedupe-groups">
              {preview.groups.map((group) => (
                <article className="dedupe-group" key={group.id}>
                  <div className="dedupe-group__header">
                    <span className="pill">{STAGE_LABELS[group.stage]}</span>
                    <span className="subtle">{group.reason}</span>
                    <span className="subtle">Score {Math.round(group.score * 100)}%</span>
                  </div>

                  <div className="dedupe-entry dedupe-entry--keeper">
                    <span className="dedupe-entry__label">Keep unread</span>
                    <EntrySummary entry={group.keeper} />
                  </div>

                  {group.duplicates.map((entry) => (
                    <div className="dedupe-entry" key={entry.id}>
                      <span className="dedupe-entry__label">Mark read</span>
                      <EntrySummary entry={entry} />
                    </div>
                  ))}
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      <section className="dedupe-history">
        <div className="dedupe-history__header">
          <div>
            <p className="eyebrow">Last 7 days</p>
            <h2>Marked read by dedupe</h2>
            <p>Review automatic and manual dedupe actions, then restore any false positives to unread.</p>
          </div>
          {loadingAudit ? <span className="pill">Loading history</span> : null}
        </div>

        {!loadingAudit && auditRuns.length === 0 ? (
          <div className="empty-state">No duplicate articles have been marked read by Flux Filters yet.</div>
        ) : null}

        {auditRuns.length > 0 ? (
          <div className="dedupe-groups">
            {auditRuns.map((run) => (
              <article className="dedupe-run" key={run.id}>
                <div className="dedupe-run__header">
                  <div>
                    <h3>{formatDate(run.createdAt)}</h3>
                    <p>
                      {run.mode === "automatic" ? "Automatic run" : "Manual run"} |{" "}
                      {run.markedReadCount} marked read | {run.totalUnreadEntries} unread checked
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={run.markedReadEntryIds.some((entryId) => restoringEntryIdSet.has(entryId))}
                    onClick={() => void onRestoreEntries(run.markedReadEntryIds)}
                  >
                    Mark run unread
                  </button>
                </div>

                {run.groups.map((group) => (
                  <div className="dedupe-group dedupe-group--nested" key={`${run.id}-${group.id}`}>
                    <div className="dedupe-group__header">
                      <span className="pill">{STAGE_LABELS[group.stage]}</span>
                      <span className="subtle">{group.reason}</span>
                      <span className="subtle">Score {Math.round(group.score * 100)}%</span>
                    </div>

                    <div className="dedupe-entry dedupe-entry--keeper">
                      <span className="dedupe-entry__label">Kept unread</span>
                      <EntrySummary entry={group.keeper} />
                    </div>

                    {group.duplicates.map((entry) => (
                      <div className="dedupe-entry" key={`${run.id}-${entry.id}`}>
                        <span className="dedupe-entry__label">Marked read</span>
                        <EntrySummary entry={entry} />
                        <button
                          type="button"
                          className="ghost-button compact-button"
                          disabled={restoringEntryIdSet.has(entry.id)}
                          onClick={() => void onRestoreEntries([entry.id])}
                        >
                          Mark unread
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}

function EntrySummary({ entry }: { entry: DedupeEntrySummary }) {
  return (
    <div className="dedupe-entry__body">
      <h3>
        <a href={entry.url} target="_blank" rel="noreferrer">
          {entry.title}
        </a>
      </h3>
      <p>
        {entry.feedTitle} | {formatDate(entry.publishedAt)}
      </p>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
