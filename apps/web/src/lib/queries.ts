import {
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

// Everything under "sites" changes together when a deployment or alias changes.
export const keys = {
  sites: ["sites"] as const,
  list: (q: string, access: AccessType | undefined) => ["sites", "list", { q, access }] as const,
  detail: (id: string) => ["sites", "detail", id] as const,
  aliases: ["sites", "aliases"] as const,
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

export const useDeployments = (q: string, access: AccessType | undefined) =>
  useInfiniteQuery({
    queryKey: keys.list(q, access),
    queryFn: ({ pageParam }) =>
      parseResponse(
        api.deployments.$get({
          query: {
            q: q || undefined,
            access,
            limit: String(pageSize),
            offset: String(pageParam),
          },
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.deployments.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })

export const useDeployment = (id: string) =>
  useQuery({
    queryKey: keys.detail(id),
    queryFn: () => parseResponse(api.deployments[":id"].$get({ param: { id } })),
  })

export const useAliases = () =>
  useQuery({
    queryKey: keys.aliases,
    queryFn: async () => (await parseResponse(api.aliases.$get())).aliases,
  })

export const useStats = () =>
  useQuery({ queryKey: keys.stats, queryFn: () => parseResponse(api.stats.$get()) })

export function useInvalidateSites() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: keys.sites })
}
