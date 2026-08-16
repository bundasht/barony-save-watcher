import type { BaronyHistoryApi } from '../../shared/types'

declare global {
  interface Window { baronyHistory: BaronyHistoryApi }
}

export {}
