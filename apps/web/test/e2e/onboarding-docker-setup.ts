import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// A loopback address is insufficient proof of ownership. Refuse unrelated local services too.
export default async function verifyDockerReview() {
  const docker = (args: string[]) => {
    const result = spawnSync('docker', args, {
      encoding: 'utf8',
      timeout: 15_000,
    })
    if (result.status !== 0) throw new Error('Start the owned Docker review stack before testing')
    return result.stdout.trim()
  }
  const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
  for (const value of [endpoint, process.env['DOCKER_HOST']].filter(Boolean)) {
    if (!/^(?:npipe:\/{2,4}\.\/pipe\/|unix:\/\/\/)/.test(value!))
      throw new Error('Docker browser review refuses remote endpoints')
  }
  const receipt = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '.tmp/devon_qa_onboarding_docker/docker-receipt.json'),
      'utf8',
    ),
  ) as {
    url: string
    project: string
    images: { service: string; image: string }[]
  }
  if (receipt.url !== 'http://127.0.0.1:48942' || receipt.project !== 'devon-onboarding-review')
    throw new Error('Incorrect review ownership receipt')
  for (const service of ['api', 'web', 'gateway']) {
    const actual = JSON.parse(
      docker([
        'container',
        'inspect',
        '--format',
        '{"image":{{json .Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"ports":{{json .NetworkSettings.Ports}}}',
        `devon-onboarding-review-${service}-1`,
      ]),
    ) as {
      image: string
      project: string
      ports: Record<string, { HostIp: string; HostPort: string }[] | null>
    }
    if (actual.project !== receipt.project) throw new Error('Foreign Docker review service')
    if (
      service !== 'gateway' &&
      receipt.images.find((image) => image.service === service)?.image !== actual.image
    )
      throw new Error('Running Docker image differs from reviewed image receipt')
    if (service === 'gateway') {
      const binding = actual.ports['8080/tcp']
      if (
        binding?.length !== 1 ||
        binding[0]?.HostIp !== '127.0.0.1' ||
        binding[0]?.HostPort !== '48942'
      )
        throw new Error('Review gateway must use its owned loopback port')
    }
  }
  const health = await fetch(`${receipt.url}/readyz`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!health.ok) throw new Error(`Docker review not ready: ${health.status}`)
}
