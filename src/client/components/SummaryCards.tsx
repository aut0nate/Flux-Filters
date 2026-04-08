interface SummaryCardsProps {
  totalFeeds: number;
  feedsWithRules: number;
  totalBlockRules: number;
  totalAllowRules: number;
}

export default function SummaryCards({
  totalFeeds,
  feedsWithRules,
  totalBlockRules,
  totalAllowRules
}: SummaryCardsProps) {
  const metrics = [
    { label: "Total feeds", value: totalFeeds },
    { label: "Feeds with rules", value: feedsWithRules },
    { label: "Block rules", value: totalBlockRules },
    { label: "Allow rules", value: totalAllowRules }
  ];

  return (
    <section className="summary-strip" aria-label="Overview">
      {metrics.map((metric) => (
        <article className="summary-metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </article>
      ))}
    </section>
  );
}
