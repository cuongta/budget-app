/**
 * Click-to-sort table headers, shared by the Monthly, Merchants and Categories tables.
 *
 * `columns` describes each sortable column:
 *   { label, first: "asc" | "desc", compare: (a, b) => number, isEmpty?: (row) => bool }
 * `first` is the direction used when the column is first clicked; clicking the
 * active column flips it. Rows where `isEmpty` is true (e.g. no category) always
 * sort last, in either direction.
 * `sort` is `{ column, dir }`, kept in the page's state.
 */

/** A sorted copy of `rows`; `tieBreak` orders rows that compare equal. */
export const sortRows = (rows, columns, { column, dir }, tieBreak) => {
  const { compare, isEmpty } = columns[column];
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (isEmpty && isEmpty(a) !== isEmpty(b)) return isEmpty(a) ? 1 : -1;
    return sign * compare(a, b) || (tieBreak ? tieBreak(a, b) : 0);
  });
};

export const SortHeader = ({ columns, column, sort, onSort, className }) => {
  const { label, first } = columns[column];
  const active = sort.column === column;
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={`sort-header${active ? " sort-header--active" : ""}`}
        onClick={() =>
          onSort(
            active
              ? { column, dir: sort.dir === "asc" ? "desc" : "asc" }
              : { column, dir: first },
          )
        }
      >
        {label}
        <span className="sort-header__arrow" aria-hidden="true">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </button>
    </th>
  );
};
