import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { DepartmentFeatureScreen } from '../../src/lib/department-feature-screen.js'

const state = vi.hoisted(() => ({
  enabled: false,
  loading: false,
  error: false,
  allowed: true,
  role: 'head',
  retry: vi.fn(),
  navigate: vi.fn(),
  mount: vi.fn(),
}))
vi.mock('../../src/lib/features.js', () => ({
  useFeatures: () => ({
    features: { workload: state.enabled },
    isLoading: state.loading,
    isError: state.error,
    retry: state.retry,
  }),
}))
vi.mock('../../src/lib/can.js', () => ({ useCan: () => ({ allowed: state.allowed }) }))
vi.mock('../../src/lib/session.js', () => ({
  useDepartment: () => ({ department: { role: state.role } }),
}))
vi.mock('../../src/lib/router.js', () => ({ navigate: state.navigate }))
function PrivateScreen() {
  state.mount()
  return <div>Private workload</div>
}
function show() {
  return render(
    <DepartmentFeatureScreen feature="workload" action="work.workload.read">
      <PrivateScreen />
    </DepartmentFeatureScreen>,
  )
}
beforeEach(() => {
  Object.assign(state, {
    enabled: false,
    loading: false,
    error: false,
    allowed: true,
    role: 'head',
  })
  vi.clearAllMocks()
  setLocale('en')
})
describe('department feature screen', () => {
  it('explains disabled features and links heads to settings without mounting the API screen', () => {
    show()
    expect(screen.getByText('This feature is turned off')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(state.navigate).toHaveBeenCalledWith('/department?tab=general#features')
    expect(state.mount).not.toHaveBeenCalled()
  })
  it('does not offer settings to a member', () => {
    state.role = 'member'
    show()
    expect(screen.getByText('Ask your department head to enable this feature.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('keeps the private screen unmounted while settings load', () => {
    state.loading = true
    show()
    expect(state.mount).not.toHaveBeenCalled()
    expect(screen.queryByText('This feature is turned off')).not.toBeInTheDocument()
  })
  it('offers retry instead of claiming the feature is off when settings fail', () => {
    state.error = true
    show()
    fireEvent.click(screen.getByRole('button'))
    expect(state.retry).toHaveBeenCalledOnce()
    expect(state.mount).not.toHaveBeenCalled()
  })
  it('does not mount an enabled feature for a forbidden visitor', () => {
    state.enabled = true
    state.allowed = false
    show()
    expect(state.mount).not.toHaveBeenCalled()
  })
  it('mounts the feature only once it is enabled and permitted', () => {
    state.enabled = true
    show()
    expect(screen.getByText('Private workload')).toBeInTheDocument()
  })
})
