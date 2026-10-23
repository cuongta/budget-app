import { useState } from "react";

import "./PieChart.css";

const SIZE = 180;

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/**
 * Pie with a legend table (amount + share per slice, and a total) beside it.
 * `slices` are [{ label, value, color }] with value > 0, in drawing order
 * (clockwise from 12 o'clock). Keep it to ~6 slices; fold the rest into "Other".
 * Hovering or focusing a slice dims the others and bolds its legend row; the legend
 * shows every value, so nothing depends on hover or on color alone.
 * `showTotal={false}` drops the Total row when the slices don't add up to anything
 * meaningful (e.g. income vs spending).
 */
export const PieChart = ({ slices, caption, label, showTotal = true }) => {
  const [hovered, setHovered] = useState(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!(total > 0)) return null;

  const r = SIZE / 2;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const start = angle;
    angle += (s.value / total) * 2 * Math.PI;
    return { ...s, path: slicePath(r, start, angle), share: s.value / total };
  });

  return (
    <div className="pie">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`${-r} ${-r} ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${label}${caption ? `, ${caption}` : ""}: ${arcs
          .map((a) => `${a.label} ${percent.format(a.share)}`)
          .join(", ")}`}
      >
        {arcs.map((a) => (
          <path
            key={a.label}
            className={`pie__slice${hovered && hovered !== a.label ? " pie__slice--dim" : ""}`}
            d={a.path}
            fill={a.color}
            tabIndex={0}
            aria-label={`${a.label}: ${cents.format(a.value)}, ${percent.format(a.share)}`}
            onPointerEnter={() => setHovered(a.label)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(a.label)}
            onBlur={() => setHovered(null)}
          />
        ))}
      </svg>

      <table className="pie__legend">
        {caption && <caption>{caption}</caption>}
        <tbody>
          {arcs.map((a) => (
            <tr key={a.label} className={hovered === a.label ? "pie__row--active" : undefined}>
              <th scope="row">
                <span className="pie__swatch" style={{ background: a.color }} />
                {a.label}
              </th>
              <td className="pie__num">{dollars.format(a.value)}</td>
              <td className="pie__num pie__share">{percent.format(a.share)}</td>
            </tr>
          ))}
          {showTotal && (
            <tr className="pie__total">
              <th scope="row">Total</th>
              <td className="pie__num">{dollars.format(total)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

/** Big number above a pie (e.g. total money out, net), so pies side by side line up. */
export const PieHeadline = ({ label, value, valueClass, note }) => (
  <p className="pie-headline">
    <span className="pie-headline__label">{label}</span>
    <span className={`pie-headline__value${valueClass ? ` ${valueClass}` : ""}`}>{value}</span>
    <span className="pie-headline__label">{note}</span>
  </p>
);

/** Pies in equal columns side by side, stacked when the window is narrow. */
export const PieGrid = ({ children }) => <div className="pie-grid">{children}</div>;

/** Pie slice from the center between two angles (radians, clockwise from +x). */
const slicePath = (r, start, end) => {
  // A full circle can't be drawn as one arc; use two half arcs.
  if (end - start >= 2 * Math.PI - 1e-9) {
    return `M${-r},0 A${r},${r} 0 1 1 ${r},0 A${r},${r} 0 1 1 ${-r},0 Z`;
  }
  const point = (a) => `${r * Math.cos(a)},${r * Math.sin(a)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return `M0,0 L${point(start)} A${r},${r} 0 ${large} 1 ${point(end)} Z`;
};
