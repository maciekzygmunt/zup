import {
  keepPreviousData,
  QueryCache,
  QueryClient,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { AccessType } from "@zup/shared"
import { ApiError, api, parseResponse } from "./api.ts"

export const pageSize = 50

export const queryClient = new QueryClient({
  // An expired session sends the owner back to login, then here again.
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.assign(`/login?redirect=${encodeURIComponent(here)}`)
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
})

// Everything under "sites" changes together when a site changes.
export const keys = {
  sites: ["sites"] as const,
  list: (q: string, access: AccessType | undefined) => ["sites", "list", { q, access }] as const,
  detail: (slug: string) => ["sites", "detail", slug] as const,
  stats: ["sites", "stats"] as const,
}

export const infoQuery = queryOptions({
  queryKey: ["info"],
  queryFn: () => parseResponse(api.info.$get()),
  staleTime: Number.POSITIVE_INFINITY,
})

export const setupQuery = queryOptions({
  queryKey: ["setup"],
  queryFn: () => parseResponse(api.setup.$get()),
})

export const useInfo = () => useQuery(infoQuery).data

// `keepPrevious` keeps the old results visible while a new search loads.
export const useSites = (
  q: string,
  access: AccessType | undefined,
  { keepPrevious = false } = {},
) =>
  useInfiniteQuery({
    queryKey: keys.list(q, access),
    queryFn: ({ pageParam }) =>
      parseResponse(
        api.sites.$get({
          query: {
            q: q || undefined,
            access,
            limit: String(pageSize),
            offset: String(pageParam),
          },
        }),
      ),
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.sites.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })

export const useSite = (slug: string) =>
  useQuery({
    queryKey: keys.detail(slug),
    queryFn: () => parseResponse(api.sites[":slug"].$get({ param: { slug } })),
  })

export const useStats = () =>
  useQuery({ queryKey: keys.stats, queryFn: () => parseResponse(api.stats.$get()) })

export function useInvalidateSites() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: keys.sites })
}
