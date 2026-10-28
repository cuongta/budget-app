import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

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

      <Section title="About">
        <Updates />
      </Section>
    </Page>
  );
};

// The `version` in tauri.conf.json, which CI sets from the release tag; local
// builds show the version committed there.
const AppVersion = () => {
  const version = useQuery({
    queryKey: ["app-version"],
    queryFn: getVersion,
    staleTime: Infinity, // can't change while the app is running
  });
  return (
    <p className="settings__version">
      Version {version.data ?? "…"}
    </p>
  );
};

/**
 * "Check for updates" → "Install and restart". The updater reads latest.json from
 * the newest GitHub release (endpoint in tauri.conf.json), and only installs an
 * update whose signature matches the public key built into the app.
 */
const Updates = () => {
  // Bytes downloaded so far / total (total is null when the server doesn't say).
  const [progress, setProgress] = useState(null);

  // Resolves to an Update, or null when this is already the newest version.
  const lookup = useMutation({ mutationFn: () => check() });

  const install = useMutation({
    mutationFn: async (update) => {
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setProgress({ downloaded: 0, total: event.data.contentLength ?? null });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress((p) => ({ ...p, downloaded }));
        }
      });
      await relaunch(); // the new version takes over from here
    },
  });

  const update = lookup.data;
  const busy = lookup.isPending || install.isPending;

  return (
    <>
      <div className="settings__row">
        <AppVersion />
        {update ? (
          <button
            className="button--primary"
            onClick={() => install.mutate(update)}
            disabled={busy}
          >
            {install.isPending ? "Installing…" : `Install ${update.version} and restart`}
          </button>
        ) : (
          <button onClick={() => lookup.mutate()} disabled={busy}>
            {lookup.isPending ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>

      {lookup.isError && (
        <Status error>Couldn't check for updates: {String(lookup.error)}</Status>
      )}
      {lookup.isSuccess && !update && <Status>You're on the latest version.</Status>}
      {update && !install.isPending && !install.isError && (
        <Status>Version {update.version} is available.</Status>
      )}
      {install.isPending && progress && <Status>{formatProgress(progress)}</Status>}
      {install.isError && <Status error>Couldn't install the update: {String(install.error)}</Status>}
    </>
  );
};

const formatProgress = ({ downloaded, total }) => {
  const mb = (bytes) => (bytes / 1_000_000).toFixed(1);
  if (!total) return `Downloading… ${mb(downloaded)} MB`;
  if (downloaded >= total) return "Installing…";
  return `Downloading… ${Math.round((downloaded / total) * 100)}%`;
};
