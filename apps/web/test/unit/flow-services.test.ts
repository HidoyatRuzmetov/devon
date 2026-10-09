import { describe, expect, it } from 'vitest'
import { assertLocalDockerEndpoint, assertOwnedFlowService } from '../e2e/flow-services.js'

describe('owned local QA service guards', () => {
  it.each(['npipe:////./pipe/dockerDesktopLinuxEngine', 'unix:///var/run/docker.sock'])(
    'accepts a local endpoint: %s',
    (endpoint) => expect(() => assertLocalDockerEndpoint(endpoint)).not.toThrow(),
  )
  it.each([
    'tcp://127.0.0.1:2375',
    'ssh://remote.example',
    'npipe:////remote-host/pipe/docker_engine',
    'unix://remote-host/docker.sock',
  ])('refuses a remote or ambiguous Docker endpoint: %s', (endpoint) => {
    expect(() => assertLocalDockerEndpoint(endpoint)).toThrow()
  })
  const expected = {
    id: 'a'.repeat(64),
    name: 'flow-devon_flow_e2e_realtime-abcdef012345-centrifugo',
    namespace: 'devon_flow_e2e_realtime',
    run: 'abcdef012345',
  }
  const actual = {
    id: expected.id,
    name: `/${expected.name}`,
    labels: { 'devon.qa.namespace': expected.namespace, 'devon.qa.run': expected.run },
  }
  it('accepts an immutable id and matching namespace/run labels', () => {
    expect(() => assertOwnedFlowService(expected, actual)).not.toThrow()
  })
  it.each([
    { ...actual, id: 'b'.repeat(64) },
    { ...actual, name: 'devon-centrifugo' },
    { ...actual, labels: { ...actual.labels, 'devon.qa.run': 'another-run' } },
    { ...actual, labels: { ...actual.labels, 'devon.qa.namespace': 'devon' } },
  ])('refuses cleanup when any ownership evidence differs', (other) => {
    expect(() => assertOwnedFlowService(expected, other)).toThrow()
  })
  it.each(['--force', '', '../foreign-service'])('refuses CLI/path-like ids: %s', (id) => {
    expect(() => assertOwnedFlowService({ ...expected, id }, { ...actual, id })).toThrow()
  })
})
