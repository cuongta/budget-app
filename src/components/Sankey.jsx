import { useState } from "react";

import { useWidth } from "../hooks/useWidth";
import "./Sankey.css";

const NODE_W = 10;
const NODE_GAP = 14; // vertical space between nodes in a column; room for a label
const LABEL_W = 200; // space right of the last column for its labels
const ROW_H = 24; // the chart grows taller when a column has many nodes
const MIN_HEIGHT = 320;

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

/**
 * Flow diagram: money moving left to right through columns of nodes, each band as
 * thick as the amount it carries.
 * `nodes` are [{ id, label, color, column }] (column 0 is the left edge);
 * `links` are [{ source, target, value }] by node id, with value > 0, always to a
 * later column. A node's size is the larger of what flows in and what flows out.
 * Every node is labeled with its amount, so nothing depends on hover or color;
 * hovering a node highlights its flows, and hovering a band names it.
 * `total` is what percentages in the hover text are a share of.
 */
export const Sankey = ({ nodes, links, label, format, total }) => {
  const [ref, width] = useWidth();
  const [hovered, setHovered] = useState(null);
  const layout = width > 0 ? layoutSankey(nodes, links, width) : null;

  const touches = (l) =>
    hovered && (l.source.id === hovered || l.target.id === hovered);

  return (
    <div className="sankey" ref={ref}>
      {layout && (
        <svg width={width} height={layout.height} role="group" aria-label={label}>
          <g>
            {layout.links.map((l) => (
              <path
                key={`${l.source.id}->${l.target.id}`}
                className={`sankey__link${touches(l) ? " sankey__link--active" : hovered ? " sankey__link--dim" : ""}`}
                d={linkPath(l)}
                fill={l.source.column === 0 ? l.source.color : l.target.color}
              >
                <title>
                  {`${l.source.label} → ${l.target.label}: ${format(l.value)}`}
                </title>
              </path>
            ))}
          </g>
          {layout.nodes.map((n) => (
            <g
              key={n.id}
              className="sankey__node"
              tabIndex={0}
              onPointerEnter={() => setHovered(n.id)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(n.id)}
              onBlur={() => setHovered(null)}
            >
              <rect
                x={n.x}
                y={n.y0}
                width={NODE_W}
                height={Math.max(1, n.y1 - n.y0)}
                rx={2}
                fill={n.color}
              />
              <text
                className="sankey__label"
                x={n.x + NODE_W + 6}
                y={(n.y0 + n.y1) / 2}
                dy="0.32em"
              >
                {n.label}
                <tspan className="sankey__amount"> {format(n.value)}</tspan>
              </text>
              <title>
                {`${n.label}: ${format(n.value)}${total > 0 ? ` (${percent.format(n.value / total)})` : ""}`}
              </title>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
};

/**
 * Positions nodes (x, y0, y1) and links (sy0/sy1 at the source, ty0/ty1 at the
 * target) for the given width. Columns are spread evenly and centered vertically;
 * one px-per-dollar scale is shared so band thickness compares across the chart.
 */
const layoutSankey = (nodeList, linkList, width) => {
  const nodes = nodeList.map((n) => ({ ...n, in: 0, out: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = linkList.map((l) => ({
    ...l,
    source: byId.get(l.source),
    target: byId.get(l.target),
  }));
  for (const l of links) {
    l.source.out += l.value;
    l.target.in += l.value;
  }
  for (const n of nodes) n.value = Math.max(n.in, n.out);

  const columnCount = Math.max(...nodes.map((n) => n.column)) + 1;
  const columns = Array.from({ length: columnCount }, (_, c) =>
    nodes.filter((n) => n.column === c),
  );
  const height = Math.max(
    MIN_HEIGHT,
    Math.max(...columns.map((c) => c.length)) * ROW_H,
  );

  const sumOf = (column) => column.reduce((s, n) => s + n.value, 0);
  const scale = Math.min(
    ...columns
      .filter((c) => sumOf(c) > 0)
      .map((c) => (height - (c.length - 1) * NODE_GAP) / sumOf(c)),
  );

  const step =
    columnCount > 1 ? (width - LABEL_W - NODE_W) / (columnCount - 1) : 0;
  columns.forEach((column, c) => {
    const used = sumOf(column) * scale + (column.length - 1) * NODE_GAP;
    let y = (height - used) / 2;
    for (const n of column) {
      n.x = c * step;
      n.y0 = y;
      n.y1 = y + n.value * scale;
      y = n.y1 + NODE_GAP;
    }
  });

  // Stack each node's bands in the order of the nodes at their other end, so
  // bands don't cross more than they have to.
  for (const n of nodes) {
    let sy = n.y0;
    for (const l of links
      .filter((l) => l.source === n)
      .sort((a, b) => a.target.y0 - b.target.y0)) {
      l.sy0 = sy;
      sy += l.value * scale;
      l.sy1 = sy;
    }
    let ty = n.y0;
    for (const l of links
      .filter((l) => l.target === n)
      .sort((a, b) => a.source.y0 - b.source.y0)) {
      l.ty0 = ty;
      ty += l.value * scale;
      l.ty1 = ty;
    }
  }

  return { nodes, links, height };
};

/** A band from the right edge of its source node to the left edge of its target. */
const linkPath = (l) => {
  const x0 = l.source.x + NODE_W;
  const x1 = l.target.x;
  const xm = (x0 + x1) / 2;
  return `M${x0},${l.sy0} C${xm},${l.sy0} ${xm},${l.ty0} ${x1},${l.ty0} L${x1},${l.ty1} C${xm},${l.ty1} ${xm},${l.sy1} ${x0},${l.sy1} Z`;
};
