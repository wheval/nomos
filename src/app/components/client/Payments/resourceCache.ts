"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// A minimal stale-while-revalidate cache for the console's GET endpoints.
//
// Every console page renders ConsoleShell *and* a panel, and both call the
// same hooks — so without sharing, one page load fires each request twice
// and every navigation refetches from scratch behind a blank screen. The
// store is keyed by URL-ish string, deduplicates in-flight requests, and
// notifies every subscriber when an entry lands, so N components asking for
// the same data cost one request and repaint together.
//
// Cached data renders immediately on the next mount while a revalidation
// runs in the background: navigating between Transactions, Payouts and
// Payment Links is then instant instead of ~250ms of empty state each time.

type Entry<T> = { data?: T; error?: string };

const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  const set = listeners.get(key);
  if (set) for (const listener of set) listener();
}

function subscribe(key: string, onChange: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onChange);
  return () => {
    set.delete(onChange);
    if (set.size === 0) listeners.delete(key);
  };
}

// Run `fetcher` for `key`, collapsing concurrent callers onto one request.
// Rejections are recorded on the entry rather than thrown, so callers never
// need their own catch and a failed load can't surface as an unhandled
// rejection.
export function loadResource<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<void>;

  const run = fetcher()
    .then((data) => {
      cache.set(key, { data });
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      // Keep any previously-good data visible; surface the error alongside.
      cache.set(key, { ...(cache.get(key) ?? {}), error: message || "Request failed." });
    })
    .finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
      emit(key);
    });

  inflight.set(key, run);
  return run;
}

// Drop an entry so the next read refetches — used after a mutation that
// invalidates it (creating a link, taking a payout).
export function invalidateResource(key: string) {
  cache.delete(key);
  emit(key);
}

const EMPTY: Entry<never> = {};

/**
 * Subscribe to `key`, fetching it if absent and revalidating in the
 * background if already cached. A null key means "not ready yet" (no wallet,
 * no session) and performs no work.
 */
export function useResource<T>(key: string | null, fetcher: () => Promise<T>) {
  // The fetcher closes over props that change every render; keep the latest
  // without making it an effect dependency, or we would refetch each render.
  // Declared before the loading effect so it is already current when that
  // one runs on the same commit.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const entry = useSyncExternalStore(
    useCallback((onChange: () => void) => (key ? subscribe(key, onChange) : () => {}), [key]),
    useCallback(() => (key ? (cache.get(key) as Entry<T> | undefined) ?? EMPTY : EMPTY), [key]),
    useCallback(() => EMPTY, []),
  );

  useEffect(() => {
    if (!key) return;
    void loadResource(key, () => fetcherRef.current());
  }, [key]);

  const refresh = useCallback(() => {
    if (!key) return;
    inflight.delete(key);
    void loadResource(key, () => fetcherRef.current());
  }, [key]);

  return { data: entry.data as T | undefined, error: entry.error, refresh };
}
