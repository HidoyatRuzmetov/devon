import { apiClient } from '../../lib/api-client.js'
import { personalOverviewSchema, type PersonalOverview } from './types.js'
export const fetchPersonalOverview = (): Promise<PersonalOverview> =>
  apiClient.get('/api/v1/analytics/personal', personalOverviewSchema)
