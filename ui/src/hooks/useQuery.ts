/**
 * Minimal data-fetching hooks — useQuery and useMutation.
 *
 * Matches the TanStack Query pattern used by Paperclip UI.
 * In production, swap these out for @tanstack/react-query.
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface QueryOptions<T> {
  queryKey: string[];
  queryFn: () => Promise<T>;
  enabled?: boolean;
  refetchInterval?: number;
  onSuccess?: (data: T) => void;
  onError?: (err: Error) => void;
}

interface QueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface MutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData) => void;
  onError?: (err: Error) => void;
}

interface MutationResult<TData, TVariables> {
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isPending: boolean;
  error: Error | null;
  data: TData | undefined;
}

// ── useQuery ───────────────────────────────────────────────────────────────

export function useQuery<T>(options: QueryOptions<T>): QueryResult<T> {
  const {
    queryKey,
    queryFn,
    enabled = true,
    refetchInterval = 0,
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    queryFn()
      .then((result) => {
        setData(result);
        setError(null);
        onSuccess?.(result);
      })
      .catch((err: Error) => {
        setError(err);
        onError?.(err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [queryKey, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Set up polling
  useEffect(() => {
    if (refetchInterval > 0 && enabled) {
      intervalRef.current = setInterval(fetchData, refetchInterval);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [refetchInterval, enabled, fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

// ── useMutation ────────────────────────────────────────────────────────────

export function useMutation<TData, TVariables = void>(
  options: MutationOptions<TData, TVariables>,
): MutationResult<TData, TVariables> {
  const { mutationFn, onSuccess, onError } = options;
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TData | undefined>(undefined);

  const mutate = useCallback(
    (variables: TVariables) => {
      setIsPending(true);
      setError(null);
      mutationFn(variables)
        .then((result) => {
          setData(result);
          onSuccess?.(result);
        })
        .catch((err: Error) => {
          setError(err);
          onError?.(err);
        })
        .finally(() => {
          setIsPending(false);
        });
    },
    [mutationFn, onSuccess, onError],
  );

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      setIsPending(true);
      setError(null);
      try {
        const result = await mutationFn(variables);
        setData(result);
        onSuccess?.(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.(error);
        throw error;
      } finally {
        setIsPending(false);
      }
    },
    [mutationFn, onSuccess, onError],
  );

  return { mutate, mutateAsync, isPending, error, data };
}
