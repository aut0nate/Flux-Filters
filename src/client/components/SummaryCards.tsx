interface SummaryCardsProps {
  totalFeeds: number;
  feedsWithRules: number;
  failedFeeds: number;
  totalBlockRules: number;
  totalAllowRules: number;
  onShowFailedFeeds?: () => void;
}

export default function SummaryCards({
  totalFeeds,
  feedsWithRules,
  failedFeeds,
  totalBlockRules,
  totalAllowRules,
  onShowFailedFeeds
}: SummaryCardsProps) {
  const metrics = [
    { label: "Total Feeds", value: totalFeeds },
    { label: "Feeds with Rules", value: feedsWithRules },
    { label: "Failed Feeds", value: failedFeeds, onClick: onShowFailedFeeds },
    { label: "Block Rules", value: totalBlockRules },
    { label: "Allow Rules", value: totalAllowRules }
  ];

  return (
    <section className="summary-strip" aria-label="Overview">
      {metrics.map((metric) =>
        metric.onClick ? (
          <button
            type="button"
            className="summary-metric summary-metric--button"
            key={metric.label}
            onClick={metric.onClick}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </button>
        ) : (
          <article className="summary-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        )
      )}
    </section>
  );
}
