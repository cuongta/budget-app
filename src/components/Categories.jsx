import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  KINDS,
  createCategory,
  deleteCategory,
  getCategories,
  renameCategory,
} from "../lib/db";
import { Page, Section, Status } from "./Page";
import { SortHeader, sortRows } from "./Sort";
import "./Categories.css";

export const Categories = () => {
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });

  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: ({ name, kind }) => createCategory(name, kind),
    // Merchants and Monthly read the same cache entry, so their dropdowns update too.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }) => renameCategory(id, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });

  const remove = useMutation({
    mutationFn: ({ id }) => deleteCategory(id),
    // Deleting uncategorizes the category's merchants and transactions, so refresh
    // those too. Each key is invalidated separately: one array is one (nested) key.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  // Only one row is in rename mode at a time.
  const [editingId, setEditingId] = useState(null);
  // Default: grouped by type in KINDS order, names A–Z within each group.
  const [sort, setSort] = useState({ column: "type", dir: "asc" });

  const all = categories.data ?? [];

  return (
    <Page
      title="Categories"
      subtitle={categories.isSuccess && `${all.length} categories`}
    >
      <Section
        title="Add a category"
        hint="New categories show up in the Merchants and Monthly dropdowns right away."
      >
        <NewCategoryForm create={create} />
      </Section>
      {categories.isPending ? (
        <Status>Loading…</Status>
      ) : categories.isError ? (
        <Status error>
          Couldn't load categories: {String(categories.error)}
        </Status>
      ) : all.length === 0 ? (
        <Status>No categories yet.</Status>
      ) : (
        <Section title="All categories">
          {rename.isError && (
            <Status error>Couldn't rename: {String(rename.error)}</Status>
          )}
          {remove.isError && (
            <Status error>Couldn't delete: {String(remove.error)}</Status>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader columns={COLUMNS} column="name" sort={sort} onSort={setSort} />
                <SortHeader columns={COLUMNS} column="type" sort={sort} onSort={setSort} />
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sortRows(all, COLUMNS, sort, byName).map((c) => (
                <CategoryRow
                  key={c.id}
                  category={c}
                  editing={editingId === c.id}
                  onEdit={() => {
                    rename.reset();
                    setEditingId(c.id);
                  }}
                  onCancel={() => setEditingId(null)}
                  rename={rename}
                  remove={remove}
                  onRenamed={() => setEditingId(null)}
                />
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </Page>
  );
};

// Sortable columns (see Sort.jsx). Type sorts in KINDS order, not alphabetically.
const COLUMNS = {
  name: { label: "Name", first: "asc", compare: (a, b) => byName(a, b) },
  type: {
    label: "Type",
    first: "asc",
    compare: (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind),
  },
};

// Name A–Z; also orders rows of the same type.
const byName = (a, b) => a.name.localeCompare(b.name);

// One table row: shows the name with Rename/Delete, or an inline rename form.
const CategoryRow = ({
  category,
  editing,
  onEdit,
  onCancel,
  rename,
  remove,
  onRenamed,
}) => {
  const renaming = rename.isPending && rename.variables?.id === category.id;
  const deleting = remove.isPending && remove.variables?.id === category.id;

  const confirmDelete = async () => {
    // Native confirmation, like Settings; nothing is deleted unless you click "Delete".
    const confirmed = await ask(
      `Delete the category "${category.name}"? This can't be undone.`,
      {
        title: "Delete category?",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
    if (confirmed) remove.mutate({ id: category.id });
  };

  return (
    <tr>
      <td>
        {editing ? (
          <RenameForm
            category={category}
            pending={renaming}
            onSave={(name) =>
              rename.mutate({ id: category.id, name }, { onSuccess: onRenamed })
            }
            onCancel={onCancel}
          />
        ) : (
          category.name
        )}
      </td>
      <td className="categories__kind">{category.kind}</td>
      <td className="categories__actions">
        {!editing && (
          <>
            <button onClick={onEdit} disabled={deleting}>
              Rename
            </button>
            <button
              className="button--danger"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete…"}
            </button>
          </>
        )}
      </td>
    </tr>
  );
};

// Enter saves, Escape cancels. Save is disabled until the name actually changes.
const RenameForm = ({ category, pending, onSave, onCancel }) => {
  const [name, setName] = useState(category.name);
  const trimmed = name.trim();
  const changed = trimmed !== "" && trimmed !== category.name;

  return (
    <form
      className="categories__rename"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) onSave(trimmed);
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        disabled={pending}
        autoFocus
      />
      <button type="submit" disabled={pending || !changed}>
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} disabled={pending}>
        Cancel
      </button>
    </form>
  );
};

const NewCategoryForm = ({ create }) => {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(KINDS[0]);

  const submit = (e) => {
    e.preventDefault(); // a form submit would otherwise reload the page
    create.mutate(
      { name: name.trim(), kind },
      { onSuccess: () => setName("") },
    );
  };

  return (
    <form className="categories__form" onSubmit={submit}>
      <input
        type="text"
        placeholder="Name, e.g. Pets"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          create.reset(); // clear the last error/success once you start typing again
        }}
        disabled={create.isPending}
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        disabled={create.isPending}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="button--primary"
        disabled={create.isPending || name.trim() === ""}
      >
        {create.isPending ? "Adding…" : "Add"}
      </button>
      {create.isError && <Status error>{String(create.error)}</Status>}
      {create.isSuccess && <Status>Added {create.data.name}.</Status>}
    </form>
  );
};
