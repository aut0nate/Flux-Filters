import type {
  DedupeAuditRun,
  DedupeEntrySummary,
  DedupeGroup,
  DedupeLlmSummary,
  DedupePreview
} from "../../shared/dedupe";
import BackButton from "./BackButton";

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
  "similar-title": "Similar Title",
  "semantic-title": "Semantic Title"
};

function formatStatus(value: DedupeEntrySummary["status"]): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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
          <BackButton onClick={onBack} />
          <p className="eyebrow">Recent Filter Review</p>
          <h2>Filtered Articles</h2>
          <p>
            Flux Filters checks read and unread articles from the last 7 days, keeps the oldest
            article in each group, and marks newer unread high-confidence duplicates as read.
          </p>
        </div>
        <div className="panel-heading__actions">
          <button type="button" className="ghost-button" onClick={() => void onPreview()} disabled={loading || applying}>
            {loading ? "Checking…" : "Refresh Preview"}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void onApply()}
            disabled={loading || applying || markReadCount === 0}
          >
            {applying ? "Marking as Read…" : `Mark ${markReadCount} as Read`}
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {message ? <div className="form-success">{message}</div> : null}

      {!preview && !loading ? (
        <div className="empty-state">Run a Preview to Find Recent Filter Candidates.</div>
      ) : null}

      {loading && !preview ? <div className="empty-state">Checking Recent Articles…</div> : null}

      {preview ? (
        <>
          <div className="dedupe-summary">
            <div>
              <span>{preview.totalCheckedEntries ?? preview.totalUnreadEntries}</span>
              <p>Recent Checked</p>
            </div>
            <div>
              <span>{preview.groups.length}</span>
              <p>Filter Groups</p>
            </div>
            <div>
              <span>{markReadCount}</span>
              <p>Will Be Marked Read</p>
            </div>
            {preview.llm ? (
              <div>
                <span>{preview.llm.checkedPairs}</span>
                <p>{formatLlmSummary(preview.llm)}</p>
              </div>
            ) : null}
          </div>

          {preview.groups.length === 0 ? (
            <div className="empty-state">No High-Confidence Filter Candidates Found.</div>
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
                    <span className="dedupe-entry__label">Keep {formatStatus(group.keeper.status)}</span>
                    <EntrySummary entry={group.keeper} />
                  </div>

                  {group.duplicates.map((entry) => (
                    <div className="dedupe-entry" key={entry.id}>
                      <span className="dedupe-entry__label">Mark Read</span>
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
            <p className="eyebrow">Last 7 Days</p>
            <h2>Marked Read by Dedupe</h2>
            <p>Review automatic and manual dedupe actions, then restore any false positives to unread.</p>
          </div>
          {loadingAudit ? <span className="pill">Loading History</span> : null}
        </div>

        {!loadingAudit && auditRuns.length === 0 ? (
          <div className="empty-state">No Filtered Articles Have Been Marked Read by Flux Filters Yet.</div>
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
                      {run.markedReadCount} Marked Read | {run.totalCheckedEntries ?? run.totalUnreadEntries} Recent Checked
                      {run.llm ? ` | ${formatLlmSummary(run.llm)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={run.markedReadEntryIds.some((entryId) => restoringEntryIdSet.has(entryId))}
                    onClick={() => void onRestoreEntries(run.markedReadEntryIds)}
                  >
                    Mark Run Unread
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
                      <span className="dedupe-entry__label">Kept {formatStatus(group.keeper.status)}</span>
                      <EntrySummary entry={group.keeper} />
                    </div>

                    {group.duplicates.map((entry) => (
                      <div className="dedupe-entry" key={`${run.id}-${entry.id}`}>
                        <span className="dedupe-entry__label">Marked Read</span>
                        <EntrySummary entry={entry} />
                        <button
                          type="button"
                          className="ghost-button compact-button"
                          disabled={restoringEntryIdSet.has(entry.id)}
                          onClick={() => void onRestoreEntries([entry.id])}
                        >
                          Mark Unread
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

function formatLlmSummary(summary: DedupeLlmSummary): string {
  if (!summary.enabled) {
    return "LLM Disabled";
  }

  if (summary.error) {
    return "LLM Error";
  }

  return `LLM checked ${summary.checkedPairs} of ${summary.candidatePairs}, matched ${summary.matchedPairs}, rejected ${summary.rejectedPairs}, skipped ${summary.skippedPairs}`;
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
