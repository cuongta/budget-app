import { Sankey } from "./Sankey";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const isIncome = (row) => row.kind === "Income";

// Node colors by category kind; uncategorized counts as spending.
const KIND_COLORS = {
  Expense: "var(--color-spending)",
  Investment: "var(--color-investment)",
  Transfer: "var(--color-transfer)",
};

/**
 * `rows` are monthly category totals ({ category, kind, total }) for the period
 * shown, e.g. one month or the last twelve; a category spread over several months
 * is added up.
 *
 * Two stages: Income on the left, flowing into every other category on the right,
 * biggest first. Income left over shows as "Unspent".
 * If more went out than came in, the gap is drawn as a second source,
 * "From checking balance" (cash already in the account, e.g. moved out to park in
 * investments), and each category's band is split between the two sources.
 * Categories that net to <= 0 (e.g. more transferred in than out) are left out,
 * since a band can't be negative.
 */
export const MoneyFlow = ({ rows }) => {
  const income = rows.filter(isIncome).reduce((s, r) => s + r.total, 0);

  // category -> money out, summed over the months
  const byCategory = new Map();
  for (const r of rows.filter((r) => !isIncome(r))) {
    const c = byCategory.get(r.category) ?? { label: r.category, kind: r.kind, value: 0 };
    c.value -= r.total; // the bank records money out as negative
    byCategory.set(r.category, c);
  }
  const categories = [...byCategory.values()]
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const out = categories.reduce((s, c) => s + c.value, 0);

  if (!(income > 0) && !(out > 0)) {
    return <p className="page__hint">Nothing in this period.</p>;
  }

  const targets = categories.map((c) => ({
    id: `cat:${c.label}`,
    label: c.label,
    color: KIND_COLORS[c.kind] ?? KIND_COLORS.Expense,
    value: c.value,
  }));
  if (income > out) {
    targets.push({ id: "unspent", label: "Unspent", color: "var(--color-positive)", value: income - out });
  }

  const sources = [{ id: "income", label: "Income", color: "var(--color-income)", value: Math.max(0, income) }];
  if (out > income) {
    sources.push({ id: "balance", label: "From checking balance", color: "var(--color-muted)", value: out - Math.max(0, income) });
  }
  const sourceTotal = sources.reduce((s, x) => s + x.value, 0);

  const nodes = [
    ...sources.filter((s) => s.value > 0).map((s) => ({ ...s, column: 0 })),
    ...targets.map((t) => ({ ...t, column: 1 })),
  ];
  // Each source pays its share of every target.
  const links = sources
    .filter((s) => s.value > 0)
    .flatMap((s) =>
      targets.map((t) => ({ source: s.id, target: t.id, value: (t.value * s.value) / sourceTotal })),
    );

  return (
    <Sankey
      nodes={nodes}
      links={links}
      total={Math.max(income, out)}
      format={(v) => dollars.format(v)}
      label={`Income ${dollars.format(income)}, money out ${dollars.format(out)}`}
    />
  );
};
