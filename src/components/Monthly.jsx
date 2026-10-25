import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { getMonthlyCategoryTotals, getMonthTransactions } from "../lib/db";
import { MoneyFlow } from "./MoneyFlow";
import { PieChart, PieGrid, PieHeadline } from "./PieChart";
import { SortHeader, sortRows } from "./Sort";
import { Page, Section, Status } from "./Page";
import { useWidth } from "../hooks/useWidth";
import "./Monthly.css";

// Same cache entry as Home; both live under ["transactions", ...] so imports and
// category changes (which invalidate ["transactions"]) refresh them.
const MONTHLY_KEY = ["transactions", "monthly-totals"];
const monthKey = (month) => ["transactions", "month", month];

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const cents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Same definitions as Home: uncategorized counts as spending until categorized;
// investments and transfers are neither.
const isSpending = (kind) => kind === "Expense" || kind === null;
const isIncome = (kind) => kind === "Income";

export const Monthly = () => {
  const totals = useQuery({
    queryKey: MONTHLY_KEY,
    queryFn: getMonthlyCategoryTotals,
  });
  const [selected, setSelected] = useState(null);
  const [compareTo, setCompareTo] = useState("previous");

  if (totals.isPending || totals.isError || totals.data.length === 0) {
    return (
      <Page title="Monthly">
        {totals.isPending ? (
          <Status>Loading…</Status>
        ) : totals.isError ? (
          <Status error>Couldn't load totals: {String(totals.error)}</Status>
        ) : (
          <Status>No transactions yet. Import a statement on Home.</Status>
        )}
      </Page>
    );
  }

  const summary = summarizeByMonth(totals.data);
  const months = summary.map((s) => s.month);
  // Default to the latest month; also recover if the selected month disappeared.
  const month = months.includes(selected)
    ? selected
    : months[months.length - 1];
  const current = summary.find((s) => s.month === month);
  const index = months.indexOf(month);

  return (
    <Page
      title="Monthly"
      subtitle={formatMonth(month, "long")}
      actions={
        <>
          <button
            className="monthly__nav"
            onClick={() => setSelected(months[index - 1])}
            disabled={index === 0}
            aria-label="Previous month"
          >
            ‹
          </button>
          <select
            value={month}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Month"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m, "long")}
              </option>
            ))}
          </select>
          <button
            className="monthly__nav"
            onClick={() => setSelected(months[index + 1])}
            disabled={index === months.length - 1}
            aria-label="Next month"
          >
            ›
          </button>
        </>
      }
    >
      <Section
        title="Income, spending & investments"
        hint="Click a month to select it. Hover for exact amounts."
      >
        <IncomeSpendingChart
          data={summary}
          selected={month}
          onSelect={setSelected}
        />
        <dl
          className="monthly__totals"
          aria-label={`Totals for ${formatMonth(month, "long")}`}
        >
          <div>
            <dt>{formatMonth(month, "long")}</dt>
          </div>
          <div>
            <dt>Income</dt>
            <dd>{dollars.format(current.income)}</dd>
          </div>
          <div>
            <dt>Spending</dt>
            <dd>{dollars.format(current.spending)}</dd>
          </div>
          <div>
            <dt>Investments</dt>
            <dd>{dollars.format(current.investment)}</dd>
          </div>
          <div>
            <dt>Net</dt>
            <dd className={signClass(current.net)}>
              {formatSigned(current.net)}
            </dd>
          </div>
        </dl>
      </Section>

      <Section
        title="Income and expenses"
        hint={`Where ${formatMonth(month, "long")}'s income went. Hover a category to highlight its flow.`}
      >
        <MoneyFlow rows={totals.data.filter((r) => r.month === month)} />
      </Section>

      <Section title="Spending compared">
        <div className="compare__controls">
          <span className="compare__controls-label">
            Compare {formatMonth(month, "long")} with
          </span>
          <ToggleGroup
            label="Compare with"
            options={COMPARE_OPTIONS}
            value={compareTo}
            onChange={setCompareTo}
          />
        </div>
        {index === 0 ? (
          <Status>No earlier month to compare with.</Status>
        ) : (
          <MonthComparison
            rows={totals.data}
            month={month}
            {...baselineFor(compareTo, months, index)}
          />
        )}
      </Section>

      <MonthTransactions month={month} current={current} />
    </Page>
  );
};

// ---------------------------------------------------------------------------
// Spending compared: a dumbbell per category (baseline → this month on one $ scale),
// with both amounts and the change as numbers beside it. The baseline is the
// previous month or an average of earlier months (COMPARE_OPTIONS).

const percentChange = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

// What the selected month is compared with. Averages are over the months *before*
// the selected one, so the month never counts toward its own baseline.
const COMPARE_OPTIONS = [
  { value: "previous", label: "Previous month" },
  { value: "avg3", label: "3-month average" },
  { value: "avg", label: "Average" },
];

/**
 * { baselineMonths, short, long } for the chosen comparison; `short` labels the
 * baseline column/legend, `long` describes it in the hint. Needs index > 0.
 */
const baselineFor = (compareTo, months, index) => {
  if (compareTo === "previous") {
    const m = months[index - 1];
    return {
      baselineMonths: [m],
      short: formatMonth(m, "short"),
      long: formatMonth(m, "long"),
    };
  }
  const earlier =
    compareTo === "avg3"
      ? months.slice(Math.max(0, index - 3), index)
      : months.slice(0, index);
  const n = earlier.length;
  const range =
    n === 1
      ? formatMonth(earlier[0], "long")
      : `${formatMonth(earlier[0], "short")}–${formatMonth(earlier[n - 1], "long")}`;
  return {
    baselineMonths: earlier,
    short: compareTo === "avg3" && n === 3 ? "3-mo avg" : `${n}-mo avg`,
    long: `average of ${n} month${n === 1 ? "" : "s"}, ${range}`,
  };
};

const MonthComparison = ({ rows, month, baselineMonths, short, long }) => {
  // category -> { current, previous } spending (positive = money out, refunds netted).
  // "previous" is the baseline: one month, or the average of several.
  const inBaseline = new Set(baselineMonths);
  const byCategory = new Map();
  for (const r of rows) {
    if (!isSpending(r.kind) || (r.month !== month && !inBaseline.has(r.month)))
      continue;
    if (!byCategory.has(r.category))
      byCategory.set(r.category, { current: 0, previous: 0 });
    const c = byCategory.get(r.category);
    // A month with no spending in a category counts as $0 in the average.
    if (r.month === month) c.current -= r.total;
    else c.previous -= r.total / baselineMonths.length;
  }
  const categories = [...byCategory]
    .map(([category, v]) => ({ category, ...v }))
    // Biggest this month first; categories that only had spending last month go last.
    .sort((a, b) => b.current - a.current || b.previous - a.previous);
  if (categories.length === 0)
    return <Status>No spending in either month.</Status>;

  const total = categories.reduce(
    (t, c) => ({
      current: t.current + c.current,
      previous: t.previous + c.previous,
    }),
    { current: 0, previous: 0 },
  );
  // Category rows share one scale; the total row gets its own (it's much larger).
  const max = Math.max(
    0,
    ...categories.flatMap((c) => [c.current, c.previous]),
  );

  return (
    <>
      <p className="page__hint">
        Each row: {long} (light dot) → {formatMonth(month, "long")} (solid dot).
      </p>
      <table className="data-table compare">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col" className="compare__track-col">
              <span className="compare__legend">
                <span className="compare__dot compare__dot--previous" /> {short}
                <span className="compare__dot compare__dot--current" />{" "}
                {formatMonth(month, "short")}
              </span>
            </th>
            <th scope="col" className="num">
              {short}
            </th>
            <th scope="col" className="num">
              {formatMonth(month, "short")}
            </th>
            <th scope="col" className="num">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          <ComparisonRow
            label="Total spending"
            {...total}
            max={Math.max(total.current, total.previous)}
            strong
          />
          {categories.map((c) => (
            <ComparisonRow
              key={c.category}
              label={c.category}
              {...c}
              max={max}
            />
          ))}
        </tbody>
      </table>
    </>
  );
};

/** Row of mutually exclusive buttons (a segmented control). */
const ToggleGroup = ({ label, options, value, onChange }) => (
  <div className="toggle-group" role="group" aria-label={label}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        className="toggle-group__item"
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const ComparisonRow = ({ label, current, previous, max, strong }) => {
  // Position on the track in %, clamped so a net refund (negative spend) sits at 0.
  const at = (v) => (max > 0 ? (Math.max(0, v) / max) * 100 : 0);
  const [lo, hi] = [at(previous), at(current)].sort((a, b) => a - b);
  const change = current - previous;
  const up = Math.round(change) > 0;
  const down = Math.round(change) < 0;
  return (
    <tr className={strong ? "compare__total" : undefined}>
      <th scope="row">{label}</th>
      <td className="compare__track-col" aria-hidden="true">
        <div className="compare__track">
          <span
            className="compare__bar"
            style={{ left: `${lo}%`, width: `${hi - lo}%` }}
          />
          <span
            className="compare__dot compare__dot--previous"
            style={{ left: `${at(previous)}%` }}
          />
          <span
            className="compare__dot compare__dot--current"
            style={{ left: `${at(current)}%` }}
          />
        </div>
      </td>
      <td className="num compare__muted">{dollars.format(previous)}</td>
      <td className="num">{dollars.format(current)}</td>
      {/* Spending up is bad (red), down is good (green); the arrow and sign carry it too. */}
      <td
        className={`num ${up ? "monthly__negative" : down ? "monthly__positive" : "compare__muted"}`}
      >
        {up || down ? (
          <>
            {up ? "▲ +" : "▼ "}
            {dollars.format(change)}
            {previous > 0 && (
              <span className="compare__pct">
                {" "}
                ({percentChange.format(change / previous)})
              </span>
            )}
            {previous <= 0 && up && (
              <span className="compare__pct"> (new)</span>
            )}
          </>
        ) : (
          "–"
        )}
      </td>
    </tr>
  );
};

/** [{ month, income, spending, investment, net }] oldest first, from the per-category totals. */
const summarizeByMonth = (rows) => {
  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month))
      byMonth.set(r.month, {
        month: r.month,
        income: 0,
        spending: 0,
        investment: 0,
      });
    const s = byMonth.get(r.month);
    // The bank records money out as negative; all three are shown as positive amounts.
    if (isIncome(r.kind)) s.income += r.total;
    else if (isSpending(r.kind)) s.spending -= r.total;
    else if (r.kind === "Investment") s.investment -= r.total;
  }
  return (
    [...byMonth.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      // Net stays income − spending (as on Home); investments move money, they don't spend it.
      .map((s) => ({ ...s, net: s.income - s.spending }))
  );
};

// ---------------------------------------------------------------------------
// Chart: income, spending and investment bars per month, on a single $ axis.
// Click (or Enter/Space on) a month to show its transactions below.

const CHART_HEIGHT = 220;
const MARGIN = { top: 20, right: 8, bottom: 24, left: 52 };
const BAR_MAX = 24; // px, bars never fill their slot
const BAR_GAP = 2; // px surface gap between a month's bars
const RADIUS = 4; // rounded data-end, square at the baseline

const SERIES = [
  { key: "income", label: "Income", color: "var(--color-income)" },
  { key: "spending", label: "Spending", color: "var(--color-spending)" },
  { key: "investment", label: "Investments", color: "var(--color-investment)" },
];

const IncomeSpendingChart = ({ data, selected, onSelect }) => {
  const [ref, width] = useWidth();
  const [hovered, setHovered] = useState(null);

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const { max, ticks } = niceScale(
    Math.max(...data.flatMap((d) => SERIES.map((s) => d[s.key]))),
  );
  const y = (v) => MARGIN.top + innerH - (Math.max(0, v) / max) * innerH;
  const band = data.length > 0 ? innerW / data.length : 0;
  // A month's bars take up to ~80% of its band, leaving air between months.
  const barW = Math.max(
    2,
    Math.min(
      BAR_MAX,
      (band - (SERIES.length - 1) * BAR_GAP) / (SERIES.length + 0.6),
    ),
  );
  const groupW = SERIES.length * barW + (SERIES.length - 1) * BAR_GAP;

  const tip = hovered && data.find((d) => d.month === hovered);
  const tipIndex = tip ? data.indexOf(tip) : -1;

  return (
    <div className="monthly__chart" ref={ref}>
      <ul className="monthly__legend">
        {SERIES.map((s) => (
          <li key={s.key}>
            <span className="monthly__swatch" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>

      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT}
          role="img"
          aria-label="Income, spending and investments by month"
        >
          {/* Gridlines + y labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                className={t === 0 ? "monthly__baseline" : "monthly__grid"}
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text
                className="monthly__axis"
                x={MARGIN.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
              >
                {compact.format(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const x0 = MARGIN.left + i * band;
            const groupX = x0 + (band - groupW) / 2;
            const isSelected = d.month === selected;
            return (
              <g key={d.month}>
                {isSelected && (
                  <rect
                    className="monthly__band--selected"
                    x={x0 + 1}
                    y={MARGIN.top - 16}
                    width={band - 2}
                    height={innerH + 16}
                    rx={RADIUS}
                  />
                )}
                {SERIES.map((s, j) => {
                  const value = d[s.key];
                  const bx = groupX + j * (barW + BAR_GAP);
                  // No value labels on the bars: three side by side would collide. The
                  // selected month's values are in the totals under the chart, and every
                  // month's are in the tooltip.
                  return (
                    <path
                      key={s.key}
                      d={barPath(bx, y(value), barW, y(0))}
                      fill={s.color}
                    />
                  );
                })}
                <text
                  className={`monthly__axis${isSelected ? " monthly__axis--selected" : ""}`}
                  x={x0 + band / 2}
                  y={CHART_HEIGHT - 6}
                  textAnchor="middle"
                >
                  {formatMonth(d.month, "short")}
                </text>
                {/* Whole month band is the hit target: bigger than the bars. */}
                <rect
                  className="monthly__hit"
                  x={x0}
                  y={MARGIN.top - 16}
                  width={band}
                  height={innerH + 16 + MARGIN.bottom}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`${formatMonth(d.month, "long")}: ${SERIES.map((s) => `${s.label.toLowerCase()} ${dollars.format(d[s.key])}`).join(", ")}`}
                  onPointerEnter={() => setHovered(d.month)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(d.month)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSelect(d.month)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(d.month);
                    }
                  }}
                />
              </g>
            );
          })}
        </svg>
      )}

      {tip && (
        <div
          className="monthly__tooltip"
          style={{
            left: Math.min(MARGIN.left + (tipIndex + 0.5) * band, width - 90),
            top: MARGIN.top + 24,
          }}
        >
          <div className="monthly__tooltip-title">
            {formatMonth(tip.month, "long")}
          </div>
          {SERIES.map((s) => (
            <div key={s.key} className="monthly__tooltip-row">
              <span
                className="monthly__tooltip-key"
                style={{ background: s.color }}
              />
              <strong>{cents.format(tip[s.key])}</strong>
              <span>{s.label}</span>
            </div>
          ))}
          <div className="monthly__tooltip-row">
            <span className="monthly__tooltip-key monthly__tooltip-key--none" />
            <strong className={signClass(tip.net)}>
              {formatSigned(tip.net, cents)}
            </strong>
            <span>Net</span>
          </div>
        </div>
      )}
    </div>
  );
};

/** Column from baseline up to `top`, rounded at the top only. */
const barPath = (x, top, w, baseline) => {
  const h = baseline - top;
  if (h <= 0) return "";
  const r = Math.min(RADIUS, h, w / 2);
  return [
    `M${x},${baseline}`,
    `V${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `H${x + w - r}`,
    `Q${x + w},${top} ${x + w},${top + r}`,
    `V${baseline}`,
    "Z",
  ].join(" ");
};

/** Round axis max and ~4 evenly spaced ticks (1/2/5 × 10^n steps). */
const niceScale = (rawMax) => {
  if (!(rawMax > 0)) return { max: 1, ticks: [0, 1] };
  const roughStep = rawMax / 4;
  const pow = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= roughStep);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = [];
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(t);
  return { max, ticks };
};

// ---------------------------------------------------------------------------
// Transactions for the selected month. Categories are read-only here: they come
// from the merchant, which you change on the Merchants page.

const MonthTransactions = ({ month, current }) => {
  const transactions = useQuery({
    queryKey: monthKey(month),
    queryFn: () => getMonthTransactions(month),
  });
  // Kept when switching months. Default matches the backend order: newest first.
  const [sort, setSort] = useState({ column: "date", dir: "desc" });

  if (transactions.isPending) {
    return (
      <Section title="Transactions">
        <Status>Loading…</Status>
      </Section>
    );
  }
  if (transactions.isError) {
    return (
      <Section title="Transactions">
        <Status error>
          Couldn't load transactions: {String(transactions.error)}
        </Status>
      </Section>
    );
  }
  if (transactions.data.length === 0) {
    return (
      <Section title="Transactions">
        <Status>No transactions in {formatMonth(month, "long")}.</Status>
      </Section>
    );
  }

  return (
    <>
      <PieGrid>
        <Section title="Where the income went">
          <IncomePie {...current} />
        </Section>
        <Section title="Spending by merchant">
          <MerchantPie transactions={transactions.data} month={month} />
        </Section>
      </PieGrid>

      <Section
        title="Transactions"
        hint={
          <span>
            Categories come from each merchant. To change one, use the{" "}
            <Link to="/merchants">Merchants page</Link>.
          </span>
        }
      >
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader
                columns={SORT_COLUMNS}
                column="date"
                sort={sort}
                onSort={setSort}
              />
              <th scope="col">Description</th>
              <SortHeader
                columns={SORT_COLUMNS}
                column="amount"
                sort={sort}
                onSort={setSort}
                className="num"
              />
              <SortHeader
                columns={SORT_COLUMNS}
                column="category"
                sort={sort}
                onSort={setSort}
              />
            </tr>
          </thead>
          <tbody>
            {sortRows(transactions.data, SORT_COLUMNS, sort, newestFirst).map(
              (t) => (
                <tr key={t.id}>
                  <td className="monthly__date">{formatDay(t.date)}</td>
                  <td className="monthly__desc">
                    <div className="monthly__merchant">
                      {t.merchant ?? t.description}
                    </div>
                    <div className="monthly__raw" title={t.description}>
                      {t.description}
                    </div>
                  </td>
                  <td className={`num ${signClass(t.amount)}`}>
                    {formatSigned(t.amount, cents)}
                  </td>
                  <td className="monthly__category">
                    {t.category ?? (
                      <span className="monthly__uncategorized">
                        Uncategorized
                      </span>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </Section>
    </>
  );
};

// Sortable columns (see Sort.jsx). First click: newest dates, biggest money-out
// (most negative amount), and categories A–Z with uncategorized last.
const SORT_COLUMNS = {
  date: {
    label: "Date",
    first: "desc",
    compare: (a, b) => a.date.localeCompare(b.date),
  },
  amount: {
    label: "Amount",
    first: "asc",
    compare: (a, b) => a.amount - b.amount,
  },
  category: {
    label: "Category",
    first: "asc",
    compare: (a, b) => a.category.localeCompare(b.category),
    isEmpty: (t) => t.category == null,
  },
};

// Rows that compare equal keep newest first.
const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;

/**
 * The month's income split into Spending, Investments and what was Left over
 * (income − spending − investments), so the slices add up to the income. In a month
 * where spending and investments exceed income there's nothing left to slice, so the
 * pie shows the money that went out instead and the headline says by how much.
 */
const IncomePie = ({ month, income, spending, investment }) => {
  const leftOver = income - spending - investment;
  const overspent = Math.round(leftOver) < 0;
  const slices = [
    { label: "Spending", color: "var(--color-spending)", value: spending },
    {
      label: "Investments",
      color: "var(--color-investment)",
      value: investment,
    },
    ...(overspent
      ? []
      : [
          { label: "Left over", color: "var(--color-income)", value: leftOver },
        ]),
  ].filter((s) => s.value > 0);

  return (
    <>
      {overspent ? (
        <PieHeadline
          label="Overspent"
          value={dollars.format(-leftOver)}
          valueClass="monthly__negative"
          note={`more out than the ${dollars.format(income)} earned`}
        />
      ) : (
        <PieHeadline
          label="Left over"
          value={dollars.format(leftOver)}
          valueClass={
            Math.round(leftOver) > 0 ? "monthly__positive" : undefined
          }
          note={`of ${dollars.format(income)} earned`}
        />
      )}
      {slices.length > 0 ? (
        <PieChart
          slices={slices}
          caption={
            overspent
              ? `${formatMonth(month, "long")} · money out`
              : formatMonth(month, "long")
          }
          label={overspent ? "Money out" : "Where the income went"}
          showTotal={false}
        />
      ) : (
        <Status>No income or spending this month.</Status>
      )}
    </>
  );
};

// Pie colors in fixed order (biggest merchant first), validated for colorblind
// separation between neighboring slices; "Other" is a neutral gray.
const PIE_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--color-pie-${n})`);
const PIE_TOP = PIE_COLORS.length;

/**
 * The month's spending (expense + uncategorized, refunds netted) per merchant:
 * the top 5 as slices, the rest folded into "Other".
 */
const MerchantPie = ({ transactions, month }) => {
  const byMerchant = new Map();
  for (const t of transactions) {
    if (!isSpending(t.kind)) continue;
    const name = t.merchant ?? t.description;
    byMerchant.set(name, (byMerchant.get(name) ?? 0) - t.amount);
  }
  const ranked = [...byMerchant]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return <Status>No spending this month.</Status>;
  }

  // Folding a single leftover merchant into "Other" would just hide its name.
  const top = ranked.length === PIE_TOP + 1 ? ranked : ranked.slice(0, PIE_TOP);
  const rest = ranked.slice(top.length);
  const slices = top.map(([label, value], i) => ({
    label,
    value,
    color: PIE_COLORS[i] ?? "var(--color-pie-other)",
  }));
  if (rest.length > 0) {
    slices.push({
      label: `Other (${rest.length} merchants)`,
      value: rest.reduce((sum, [, value]) => sum + value, 0),
      color: "var(--color-pie-other)",
    });
  }
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);
  return (
    <>
      <PieHeadline
        label="Spending"
        value={dollars.format(total)}
        note={`across ${ranked.length} merchant${ranked.length === 1 ? "" : "s"}`}
      />
      <PieChart
        slices={slices}
        caption={formatMonth(month, "long")}
        label="Spending by merchant"
        showTotal={false}
      />
    </>
  );
};

// ---------------------------------------------------------------------------

// Sign from the rounded amount, so "$0" is never colored.
const signClass = (v) => {
  const s = Math.sign(Math.round(v));
  return s > 0 ? "monthly__positive" : s < 0 ? "monthly__negative" : "";
};

const formatSigned = (v, format = dollars) =>
  (Math.round(v) > 0 ? "+" : "") + format.format(v);

// "2026-09" -> "Sep" / "September 2026"
const formatMonth = (month, style) => {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 1, 1);
  return style === "long"
    ? date.toLocaleString("en-US", { month: "long", year: "numeric" })
    : date.toLocaleString("en-US", { month: "short" });
};

// "2026-09-05" -> "Sep 5"
const formatDay = (date) => {
  const [year, m, d] = date.split("-").map(Number);
  return new Date(year, m - 1, d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
};
