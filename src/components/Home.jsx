import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Link } from "react-router";

import {
  getMonthlyCategoryTotals,
  getMonthlyMerchantTotals,
  getUncategorizedMerchantCount,
  importCsv,
} from "../lib/db";
import { MerchantPie } from "./MerchantPie";
import { MoneyFlow } from "./MoneyFlow";
import { PieChart, PieGrid, PieHeadline } from "./PieChart";
import { Page, Status } from "./Page";
import "./Home.css";

// Under ["transactions", ...] so anything that invalidates ["transactions"]
// (imports, merchant category changes) refreshes this view too.
const MONTHLY_KEY = ["transactions", "monthly-totals"];
const MERCHANT_TOTALS_KEY = ["transactions", "monthly-merchant-totals"]; // shared with Monthly

// The last N months with data are shown; older ones scroll off. The period
// picker can instead show one calendar year (every month of it that has data)
const MAX_MONTHS = 12;
const LAST_MONTHS = "last";

// Strongest cell color (% of the shading hue). Capped so the normal text color
// stays readable (>= 4.5:1) on every cell in light and dark mode.
const MAX_SHADE = 65;

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const cents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const Home = () => {
  const queryClient = useQueryClient();
  const totals = useQuery({
    queryKey: MONTHLY_KEY,
    queryFn: getMonthlyCategoryTotals,
  });

  const importStatement = useMutation({
    mutationFn: importStatements,
    // Refresh even if some files failed: the others may have added rows.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
    },
  });

  // Under ["merchants", ...] so imports, resets and category changes refresh it.
  const uncategorized = useQuery({
    queryKey: ["merchants", "uncategorized-count"],
    queryFn: getUncategorizedMerchantCount,
  });

  // LAST_MONTHS or a year ("2026"). Falls back to LAST_MONTHS if that year's data is gone (e.g. after a reset)
  const [range, setRange] = useState(LAST_MONTHS);
  const years = [...new Set((totals.data ?? []).map((r) => r.month.slice(0, 4)))].sort().reverse();
  const period = years.includes(range) ? range : LAST_MONTHS;

  return (
    <Page
      title="Overview"
      actions={
        <>
          {years.length > 0 && (
            <select value={period} onChange={(e) => setRange(e.target.value)} aria-label="Period">
              <option value={LAST_MONTHS}>Last {MAX_MONTHS} months</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          <button
            className="button--primary"
            onClick={() => importStatement.mutate()}
            disabled={importStatement.isPending}
          >
            {importStatement.isPending ? "Importing…" : "Import statements…"}
          </button>
        </>
      }
    >
      <ImportResult mutation={importStatement} />
      <UncategorizedNotice count={uncategorized.data} />

      {totals.isPending ? (
        <Status>Loading…</Status>
      ) : totals.isError ? (
        <Status error>Couldn't load totals: {String(totals.error)}</Status>
      ) : totals.data.length === 0 ? (
        <Status>No transactions yet. Use "Import statements…" to add your bank CSV exports.</Status>
      ) : (
        <MonthlyTables rows={totals.data} range={period} />
      )}
    </Page>
  );
};

/**
 * Lets you pick one or more CSV exports in the native Open panel, then imports them
 * one at a time. Resolves to null if the panel was cancelled, otherwise
 * { files, inserted, total, failures: [{ file, error }] }; one bad file doesn't
 * stop the others.
 */
const importStatements = async () => {
  const picked = await open({
    title: "Import bank statements",
    multiple: true,
    directory: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!picked) return null;
  const paths = Array.isArray(picked) ? picked : [picked];

  const result = { files: paths.length, inserted: 0, total: 0, failures: [] };
  for (const path of paths) {
    try {
      const [inserted, total] = await importCsv(path);
      result.inserted += inserted;
      result.total += total;
    } catch (error) {
      result.failures.push({
        file: path.split("/").pop(),
        error: String(error),
      });
    }
  }
  return result;
};

const ImportResult = ({ mutation }) => {
  if (mutation.isError) {
    return <Status error>Import failed: {String(mutation.error)}</Status>;
  }
  if (!mutation.isSuccess || mutation.data === null) return null; // nothing picked
  const { files, inserted, total, failures } = mutation.data;
  const imported = files - failures.length;
  return (
    <>
      {imported > 0 && (
        <Status>
          Imported {inserted} new transaction{inserted === 1 ? "" : "s"}
          {total > inserted && ` (${total - inserted} already imported)`}
          {files > 1 && ` from ${imported} file${imported === 1 ? "" : "s"}`}.
        </Status>
      )}
      {failures.map((f) => (
        <Status key={f.file} error>
          Couldn't import {f.file}: {f.error}
        </Status>
      ))}
    </>
  );
};

// Gentle nudge, not an error. Uncategorized transactions are counted as spending
// (isSpending below), so an uncategorized paycheck or transfer skews the totals.
// Hidden when everything is categorized.
const UncategorizedNotice = ({ count }) => {
  if (!count) return null;
  return (
    <p className="home__notice">
      {count} merchant{count === 1 ? " isn't" : "s aren't"} categorized yet. Until{" "}
      {count === 1 ? "it is" : "they are"}, {count === 1 ? "its" : "their"} transactions count as
      spending, so these totals may be off. <Link to="/merchants">Categorize merchants</Link>
    </p>
  );
};

// Uncategorized transactions count as spending until they're categorized.
const isSpending = (row) => row.kind === "Expense" || row.kind === null;
const isIncome = (row) => row.kind === "Income";

const MonthlyTables = ({ rows, range }) => {
  const allMonths = [...new Set(rows.map((r) => r.month))].sort();
  const months =
    range === LAST_MONTHS
      ? allMonths.slice(-MAX_MONTHS)
      : allMonths.filter((m) => m.startsWith(`${range}-`));
  const inRange = rows.filter((r) => months.includes(r.month));
  const monthTotal = (month, predicate, sign) =>
    inRange
      .filter((r) => r.month === month && predicate(r))
      .reduce((sum, r) => sum + sign * r.total, 0);
  // The bank records spending as negative; both tables show positive amounts.
  const spent = (m) => monthTotal(m, isSpending, -1);
  const earned = (m) => monthTotal(m, isIncome, 1);
  const movedTo = (kind) => (m) => monthTotal(m, (r) => r.kind === kind, -1);

  const period = `${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])}`;

  return (
    <>
      <KpiTiles months={months} earned={earned} spent={spent} period={period} />

      <PieGrid>
        <section className="page__section">
          <h2 className="page__section-title">Spending by merchant</h2>
          <PeriodMerchantPie months={months} period={period} />
        </section>

        <section className="page__section">
          <h2 className="page__section-title">Income vs spending</h2>
          <NetPie
            income={sumMonths(months, earned)}
            spending={sumMonths(months, spent)}
            period={period}
          />
        </section>
      </PieGrid>

      <section className="page__section">
        <h2 className="page__section-title">Income and expenses</h2>
        <p className="page__hint">
          Where your income went, {period}. Hover a category to highlight its flow.
        </p>
        <MoneyFlow rows={inRange} />
      </section>

      <CategoryHeatTable
        title="Spending by category"
        hint="Darker cells mean more spent. Refunds reduce a category's total."
        rows={inRange.filter(isSpending)}
        months={months}
        sign={-1}
        totalLabel="Total spending"
        colorVar="--color-spending"
      />

      <section className="page__section">
        <h2 className="page__section-title">Monthly summary</h2>
        <div className="home__scroll">
          <table className="home__table">
            <thead>
              <tr>
                <th scope="col" />
                <MonthHeaders months={months} />
              </tr>
            </thead>
            <tbody>
              <SummaryRow label="Income" months={months} value={earned} />
              <SummaryRow label="Spending" months={months} value={spent} />
              <SummaryRow
                label="Net (income − spending)"
                months={months}
                value={(m) => earned(m) - spent(m)}
                strong
                signed
              />
              <SummaryRow
                label="To investments"
                months={months}
                value={movedTo("Investment")}
                muted
              />
              <SummaryRow label="Transfers" months={months} value={movedTo("Transfer")} muted />
            </tbody>
          </table>
        </div>
        <p className="page__hint">
          Investments and transfers move money between your own accounts, so they're not counted as
          spending.
        </p>
      </section>
    </>
  );
};

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

/**
 * Headline numbers for the shown months, each with its month-by-month trend.
 * Totals match the Total column of the Monthly summary table below.
 */
const KpiTiles = ({ months, earned, spent, period }) => {
  const income = sumMonths(months, earned);
  const spending = sumMonths(months, spent);
  const net = income - spending;
  const sign = Math.sign(Math.round(net));
  const perMonth = (v) => `${dollars.format(v / months.length)} / month`;
  return (
    <dl className="home__kpis" aria-label={`Totals, ${period}`}>
      <Kpi
        label="Income"
        value={dollars.format(income)}
        note={perMonth(income)}
        trend={months.map(earned)}
        color="var(--color-income)"
      />
      <Kpi
        label="Spending"
        value={dollars.format(spending)}
        note={perMonth(spending)}
        trend={months.map(spent)}
        color="var(--color-spending)"
      />
      <Kpi
        label="Net"
        value={`${sign > 0 ? "+" : ""}${dollars.format(net)}`}
        valueClass={sign > 0 ? "home__positive" : sign < 0 ? "home__negative" : undefined}
        note={
          sign > 0 ? "earned more than spent" : sign < 0 ? "spent more than earned" : "broke even"
        }
        trend={months.map((m) => earned(m) - spent(m))}
        color="var(--color-muted)"
      />
      <Kpi
        label="Savings rate"
        value={income > 0 ? percent.format(net / income) : "–"}
        valueClass={sign < 0 ? "home__negative" : undefined}
        note="of income kept"
      />
    </dl>
  );
};

const Kpi = ({ label, value, valueClass, note, trend, color }) => (
  <div className="home__kpi">
    <dt className="home__kpi-label">{label}</dt>
    <dd className={`home__kpi-value${valueClass ? ` ${valueClass}` : ""}`}>{value}</dd>
    <dd className="home__kpi-note">{note}</dd>
    {trend && trend.length > 1 && (
      <dd className="home__kpi-trend" aria-hidden="true">
        <Sparkline values={trend} color={color} />
      </dd>
    )}
  </div>
);

/**
 * Trend line across the tile, oldest month on the left. Decorative: the exact
 * numbers are in the Monthly summary table. A hairline marks $0 when the line
 * crosses it (e.g. net going negative).
 */
const Sparkline = ({ values, color }) => {
  const W = 100;
  const H = 28;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const y = (v) => (max === min ? H / 2 : H - 2 - ((v - min) / (max - min)) * (H - 4));
  const points = values.map((v, i) => `${(i / (values.length - 1)) * W},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="home__spark">
      {min < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="home__spark-zero" />}
      <polygon points={`0,${y(0)} ${points} ${W},${y(0)}`} fill={color} opacity={0.1} />
      <polyline points={points} fill="none" stroke={color} />
    </svg>
  );
};

const sumMonths = (months, value) => months.reduce((sum, m) => sum + value(m), 0);

/**
 * Spending (expense + uncategorized, refunds netted) per merchant over the shown
 * months; same definition as the Spending tile and the Monthly merchant pie.
 */
const PeriodMerchantPie = ({ months, period }) => {
  const totals = useQuery({
    queryKey: MERCHANT_TOTALS_KEY,
    queryFn: getMonthlyMerchantTotals,
  });
  if (totals.isPending) return <Status>Loading…</Status>;
  if (totals.isError) {
    return <Status error>Couldn't load merchants: {String(totals.error)}</Status>;
  }

  const inRange = new Set(months);
  const spent = new Map();
  for (const r of totals.data) {
    if (!inRange.has(r.month) || !isSpending(r)) continue;
    spent.set(r.merchant, (spent.get(r.merchant) ?? 0) - r.total);
  }
  return (
    <MerchantPie
      spent={spent}
      caption={period}
      empty={<p className="page__hint">No spending in this period.</p>}
    />
  );
};

/**
 * Net for the period as the headline (matches the Net row's Total), with income and
 * spending as two slices so it's clear which side is bigger.
 */
const NetPie = ({ income, spending, period }) => {
  const net = income - spending;
  const sign = Math.sign(Math.round(net));
  const slices = [
    { label: "Income", color: "var(--color-income)", value: income },
    { label: "Spending", color: "var(--color-spending)", value: spending },
  ].filter((s) => s.value > 0);
  return (
    <>
      <PieHeadline
        label="Net"
        value={`${sign > 0 ? "+" : ""}${dollars.format(net)}`}
        valueClass={sign > 0 ? "home__positive" : sign < 0 ? "home__negative" : undefined}
        note={
          sign > 0 ? "earned more than spent" : sign < 0 ? "spent more than earned" : "broke even"
        }
      />
      {slices.length > 0 && (
        <PieChart slices={slices} caption={period} label="Income vs spending" showTotal={false} />
      )}
    </>
  );
};

/**
 * Categories × months, each cell shaded by its amount (one hue, darker = more).
 * `sign` turns the bank's signed totals into the positive amounts shown
 * (-1 for spending, 1 for income). `colorVar` names the shading color token.
 */
const CategoryHeatTable = ({ title, hint, rows, months, sign, totalLabel, colorVar }) => {
  // category -> month -> amount
  const byCategory = new Map();
  for (const r of rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, new Map());
    byCategory.get(r.category).set(r.month, sign * r.total);
  }
  const sumOf = (byMonth) => [...byMonth.values()].reduce((a, b) => a + b, 0);
  // Biggest categories first; Uncategorized always last so it stands out as a to-do.
  const categories = [...byCategory.keys()].sort((a, b) =>
    a === "Uncategorized"
      ? 1
      : b === "Uncategorized"
        ? -1
        : sumOf(byCategory.get(b)) - sumOf(byCategory.get(a)),
  );
  const monthSum = (m) => categories.reduce((sum, c) => sum + (byCategory.get(c).get(m) ?? 0), 0);

  // Shading scale: the largest single category-month is the darkest cell.
  const max = Math.max(0, ...[...byCategory.values()].flatMap((byMonth) => [...byMonth.values()]));

  return (
    <section className="page__section" style={{ "--heat": `var(${colorVar})` }}>
      <h2 className="page__section-title">{title}</h2>
      {categories.length === 0 ? (
        <p className="page__hint">Nothing in this period.</p>
      ) : (
        <>
          <p className="page__hint">
            {hint}
            <span className="home__scale" aria-hidden="true">
              <span>$0</span>
              <span className="home__scale-bar" />
              <span>{dollars.format(max)}</span>
            </span>
          </p>
          <div className="home__scroll">
            <table className="home__table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <MonthHeaders months={months} />
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const byMonth = byCategory.get(category);
                  return (
                    <tr key={category}>
                      <th scope="row">{category}</th>
                      {months.map((m) => (
                        <HeatCell
                          key={m}
                          value={byMonth.get(m)}
                          max={max}
                          label={`${category}, ${formatMonth(m)}`}
                        />
                      ))}
                      <td className="home__num home__strong">{dollars.format(sumOf(byMonth))}</td>
                    </tr>
                  );
                })}
              </tbody>
              {categories.length > 1 && (
                <tfoot>
                  <tr>
                    <th scope="row">{totalLabel}</th>
                    {months.map((m) => (
                      <td key={m} className="home__num home__strong">
                        {dollars.format(monthSum(m))}
                      </td>
                    ))}
                    <td className="home__num home__strong">
                      {dollars.format(months.reduce((sum, m) => sum + monthSum(m), 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </section>
  );
};

// Month columns plus the trailing Total column, shared by every table.
const MonthHeaders = ({ months }) => (
  <>
    {months.map((m) => (
      <th key={m} scope="col" className="home__num">
        {formatMonth(m)}
      </th>
    ))}
    <th scope="col" className="home__num">
      Total
    </th>
  </>
);

const HeatCell = ({ value, max, label }) => {
  if (value === undefined) {
    return <td className="home__num home__empty">–</td>;
  }
  // 0..1; a net negative (e.g. refunds exceeding spending) gets no shading.
  const t = max > 0 ? Math.max(0, value) / max : 0;
  return (
    <td
      className="home__num home__heat"
      style={{ "--t": `${Math.round(t * MAX_SHADE)}%` }}
      title={`${label}: ${cents.format(value)}`}
    >
      {dollars.format(value)}
    </td>
  );
};

// `signed` rows show a +/− sign and are green when positive, red when negative.
// The sign is shown too, so the meaning doesn't rely on color alone.
const SummaryRow = ({ label, months, value, strong, muted, signed }) => {
  const values = months.map(value);
  const total = values.reduce((a, b) => a + b, 0);
  // Rounded like the displayed amount, so "$0" is never colored.
  const sign = (v) => Math.sign(Math.round(v));
  const format = (v) => (signed && sign(v) > 0 ? "+" : "") + dollars.format(v);
  const cls = (v) =>
    [
      "home__num",
      strong && "home__strong",
      muted && "home__muted",
      signed && sign(v) > 0 && "home__positive",
      signed && sign(v) < 0 && "home__negative",
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <tr>
      <th scope="row" className={muted ? "home__muted" : undefined}>
        {label}
      </th>
      {values.map((v, i) => (
        <td key={months[i]} className={cls(v)}>
          {format(v)}
        </td>
      ))}
      <td className={`${cls(total)} home__strong`}>{format(total)}</td>
    </tr>
  );
};

// "2026-09" -> "Sep 2026"
const formatMonth = (month) => {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
};
