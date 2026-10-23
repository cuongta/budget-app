import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { KINDS, getCategories, getMerchants, setMerchantCategory } from "../lib/db";
import { Page, Section, Status } from "./Page";
import { SortHeader, sortRows } from "./Sort";
import "./Merchants.css";

export const Merchants = () => {
  const queryClient = useQueryClient();
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);
  // Default matches the backend order: merchants with the most transactions first.
  const [sort, setSort] = useState({ column: "transactions", dir: "desc" });

  const merchants = useQuery({
    queryKey: ["merchants"],
    queryFn: getMerchants,
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });

  const update = useMutation({
    mutationFn: ({ merchantId, categoryId }) =>
      setMerchantCategory(merchantId, categoryId),
    // Show the new category right away instead of waiting for the save and refetch.
    onMutate: async ({ merchantId, categoryId }) => {
      await queryClient.cancelQueries({ queryKey: ["merchants"] });
      const previous = queryClient.getQueryData(["merchants"]);
      queryClient.setQueryData(["merchants"], (rows) =>
        rows?.map((m) =>
          m.id === merchantId
            ? { ...m, category_id: categoryId, source: "user" }
            : m,
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(["merchants"], context?.previous);
    },
    // Merchant changes also recategorize transactions, so refresh both lists.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const all = merchants.data ?? [];
  const uncategorizedCount = all.filter((m) => m.category_id == null).length;
  const shown = uncategorizedOnly
    ? all.filter((m) => m.category_id == null)
    : all;
  const ready = merchants.isSuccess && categories.isSuccess;
  const columns = sortColumns(categories.data ?? []);

  return (
    <Page
      title="Merchants"
      subtitle={
        ready && `${all.length} merchants · ${uncategorizedCount} uncategorized`
      }
      actions={
        <label className="merchants__filter">
          <input
            type="checkbox"
            checked={uncategorizedOnly}
            onChange={(e) => setUncategorizedOnly(e.target.checked)}
          />
          Uncategorized only
        </label>
      }
    >
      {merchants.isPending || categories.isPending ? (
        <Status>Loading…</Status>
      ) : merchants.isError || categories.isError ? (
        <Status error>
          Couldn't load merchants: {String(merchants.error ?? categories.error)}
        </Status>
      ) : all.length === 0 ? (
        <Status>No merchants yet. Import a statement on the Home page.</Status>
      ) : (
        <Section hint="Choosing a category applies it to every transaction from that merchant.">
          {update.isError && (
            <Status error>Couldn't save: {String(update.error)}</Status>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader columns={columns} column="merchant" sort={sort} onSort={setSort} />
                <SortHeader
                  columns={columns}
                  column="transactions"
                  sort={sort}
                  onSort={setSort}
                  className="num"
                />
                <SortHeader columns={columns} column="category" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {sortRows(shown, columns, sort, byKey).map((m) => {
                const saving =
                  update.isPending && update.variables?.merchantId === m.id;
                return (
                  <tr key={m.id}>
                    <td className="merchants__key">{m.key}</td>
                    <td className="num">{m.transaction_count}</td>
                    <td>
                      <CategorySelect
                        categories={categories.data}
                        value={m.category_id}
                        disabled={saving}
                        onChange={(categoryId) =>
                          update.mutate({ merchantId: m.id, categoryId })
                        }
                      />
                      {m.source === "llm" && (
                        <span className="badge" title="Suggested by the local model">
                          auto
                        </span>
                      )}
                      {saving && <span className="saving">Saving…</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}
    </Page>
  );
};

// Sortable columns (see Sort.jsx). First click: names A–Z, most transactions first,
// and categories A–Z with uncategorized merchants last. Category names come from
// the categories list, since merchants only carry the category id.
const sortColumns = (categories) => {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return {
    merchant: { label: "Merchant", first: "asc", compare: byKey },
    transactions: {
      label: "Transactions",
      first: "desc",
      compare: (a, b) => a.transaction_count - b.transaction_count,
    },
    category: {
      label: "Category",
      first: "asc",
      compare: (a, b) => (names.get(a.category_id) ?? "").localeCompare(names.get(b.category_id) ?? ""),
      isEmpty: (m) => m.category_id == null,
    },
  };
};

// Merchant name A–Z; also orders rows that compare equal in the other columns.
const byKey = (a, b) => a.key.localeCompare(b.key);

// Categories grouped by kind. Merchants can't be set back to "uncategorized"
// (the backend takes a category id), so that option only shows while it applies.
const CategorySelect = ({ categories, value, disabled, onChange }) => (
  <select
    className="merchants__select"
    value={value ?? ""}
    disabled={disabled}
    onChange={(e) => onChange(Number(e.target.value))}
  >
    {value == null && (
      <option value="" disabled>
        Choose a category…
      </option>
    )}
    {KINDS.map((kind) => {
      const group = categories.filter((c) => c.kind === kind);
      return (
        group.length > 0 && (
          <optgroup key={kind} label={kind}>
            {group.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )
      );
    })}
  </select>
);
