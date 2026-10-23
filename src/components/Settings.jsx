import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";

import { resetData } from "../lib/db";
import { Page, Section, Status } from "./Page";
import "./Settings.css";

export const Settings = () => {
  const queryClient = useQueryClient();
  const [includeMerchants, setIncludeMerchants] = useState(false);

  const reset = useMutation({
    mutationFn: async () => {
      // Native confirmation; nothing is deleted unless you click "Delete".
      const confirmed = await ask(
        includeMerchants
          ? "This deletes every imported transaction and every merchant with its category. Your category list is kept. This can't be undone."
          : "This deletes every imported transaction. Merchants keep their categories, so a re-import is categorized automatically. This can't be undone.",
        { title: "Delete all transactions?", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" },
      );
      return confirmed ? resetData(includeMerchants) : null;
    },
    onSuccess: (summary) => {
      if (!summary) return;
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
    },
  });

  return (
    <Page title="Settings">
      <Section
        title="Start over"
        hint="Remove imported data so you can import your statements again from scratch."
      >
        <div className="settings__row">
          <label className="settings__check">
            <input
              type="checkbox"
              checked={includeMerchants}
              onChange={(e) => setIncludeMerchants(e.target.checked)}
            />
            Also forget merchants and their categories
          </label>
          <button
            className="button--danger"
            onClick={() => reset.mutate()}
            disabled={reset.isPending}
          >
            {reset.isPending ? "Deleting…" : "Delete all transactions…"}
          </button>
        </div>

        {reset.isError && <Status error>Couldn't reset: {String(reset.error)}</Status>}
        {reset.isSuccess && reset.data && (
          <Status>
            Deleted {reset.data.transactions} transaction{reset.data.transactions === 1 ? "" : "s"}
            {reset.data.merchants > 0 &&
              ` and ${reset.data.merchants} merchant${reset.data.merchants === 1 ? "" : "s"}`}
            .
          </Status>
        )}
      </Section>
    </Page>
  );
};
