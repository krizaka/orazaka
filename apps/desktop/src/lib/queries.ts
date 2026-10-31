import { defineKeys, keepPreviousData, queryOptions } from "@krizaka/query";
import { api, codeApi, githubApi } from "./api";

/** Keys of the snapshot (settings, shared folders, probe) and of the file browser. */
export const snapshotKeys = defineKeys("snapshot", {});
export const filesKeys = defineKeys("files", {
  list: (dir: string) => [dir],
  preview: (path: string) => [path],
});

export const snapshotQuery = () =>
  queryOptions({ queryKey: snapshotKeys.all, queryFn: () => api.snapshot(), retry: false, throwOnError: false });

/** A directory listing, keyed by the directory: a stale answer for another directory is never shown. */
export const listingQuery = (dir: string | null) =>
  queryOptions({
    queryKey: filesKeys.list(dir ?? ""),
    queryFn: () => api.listDir(dir as string),
    enabled: dir !== null,
    staleTime: 0,
    retry: false,
    throwOnError: false,
    placeholderData: keepPreviousData,
  });

/** A file preview, keyed by the selected path: click A then B quickly and B's answer is the one shown. */
export const previewQuery = (path: string | null) =>
  queryOptions({
    queryKey: filesKeys.preview(path ?? ""),
    queryFn: () => api.preview(path as string),
    enabled: path !== null,
    staleTime: 0,
    retry: false,
    throwOnError: false,
  });

/** The checks of the open repository: suggestions, confirmations, and whether the next run needs an approval. */
export const githubKeys = defineKeys("github", { status: () => ["status"] });
/** Polled while a sign-in waits for the person to approve in the browser. */
export const githubStatusQuery = (waiting = false) =>
  queryOptions({ queryKey: githubKeys.status(), queryFn: () => githubApi.status(), staleTime: 0, retry: false, throwOnError: false, refetchInterval: waiting ? 3000 : false });
export const codeKeys = defineKeys("code", { checks: () => ["checks"] });
export const checksQuery = () =>
  queryOptions({ queryKey: codeKeys.checks(), queryFn: () => codeApi.checks(), staleTime: 0, retry: false, throwOnError: false });
