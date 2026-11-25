import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import { updateOnboarding, type ProgressUpdate } from './api.js'

function useOnboardingState() {
  const me = useMeQuery().data
  const qc = useQueryClient()
  const key = ['onboarding', me?.user.id, me?.activeDepartmentId]
  const enabled = Boolean(me?.activeDepartmentId && me?.user.role !== 'super_admin')
  const query = useQuery({
    queryKey: key,
    queryFn: () => updateOnboarding(me!.csrfToken),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  })
  const mutation = useMutation({
    mutationFn: (update: ProgressUpdate) => updateOnboarding(me!.csrfToken, update),
    onSuccess: (data) => {
      qc.setQueryData(key, data)
      if (me?.onboardingRequired !== data.required) void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['work'] })
    },
  })
  const [playing, setPlaying] = React.useState(false)
  const [step, setStep] = React.useState(0)
  const [replay, setReplay] = React.useState(false)
  const owner = `${me?.user.id}:${me?.activeDepartmentId}`
  const autoStarted = React.useRef('')
  React.useEffect(() => {
    setPlaying(false)
    autoStarted.current = ''
  }, [owner])
  React.useEffect(() => {
    const run = query.data?.run
    if (
      run &&
      !query.data?.required &&
      !run.tourCompleted &&
      !run.paused &&
      autoStarted.current !== owner
    ) {
      autoStarted.current = owner
      setStep(run.tourStep)
      setReplay(false)
      setPlaying(true)
    }
  }, [query.data, owner])
  React.useEffect(() => {
    if (query.data && me?.onboardingRequired !== query.data.required)
      void qc.invalidateQueries({ queryKey: ['me'] })
  }, [query.data, me?.onboardingRequired, qc])
  return {
    query,
    mutation,
    enabled,
    playing,
    setPlaying,
    step,
    setStep,
    replay,
    start: (chapterStep = 0, asReplay = true) => {
      setReplay(asReplay)
      setStep(chapterStep)
      setPlaying(true)
    },
  }
}
const OnboardingContext = React.createContext<ReturnType<typeof useOnboardingState> | null>(null)
export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  return (
    <OnboardingContext.Provider value={useOnboardingState()}>{children}</OnboardingContext.Provider>
  )
}
export function useOnboarding() {
  const value = React.useContext(OnboardingContext)
  if (!value) throw new Error('OnboardingProvider missing')
  return value
}

export function useOptionalOnboarding() {
  return React.useContext(OnboardingContext)
}
