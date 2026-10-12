import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError, isNetworkError } from './api-client';

/** Server errors (5xx) surface as a toast; network errors render the No connection screen in place. */
export function createQueryClient(onServerError: (message: string) => void): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (e) => {
        if (e instanceof ApiError && e.status >= 500) onServerError(e.message);
      },
    }),
    defaultOptions: {
      queries: {
        retry: (count, e) => !isNetworkError(e) && !(e instanceof ApiError) && count < 1,
        staleTime: 30_000,
      },
    },
  });
}
