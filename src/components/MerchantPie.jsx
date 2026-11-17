import { PieChart, PieHeadline } from "./PieChart";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Pie colors in fixed order (biggest merchant first), validated for colorblind
// separation between neighboring slices; "Other" is a neutral gray.
const PIE_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--color-pie-${n})`);
const PIE_TOP = PIE_COLORS.length;

/**
 * Spending per merchant: the top 5 as slices, the rest folded into "Other".
 * `spent` maps merchant name -> amount spent (positive; refunds already netted).
 * Merchants that net to <= 0 are left out. `empty` is shown when nothing was spent.
 */
export const MerchantPie = ({ spent, caption, empty }) => {
  const ranked = [...spent]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return empty;

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
        caption={caption}
        label="Spending by merchant"
        showTotal={false}
      />
    </>
  );
};
