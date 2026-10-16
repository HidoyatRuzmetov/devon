type FixtureContainer = {
  getId(): string
  getLabels(): Record<string, string>
  stop(options?: { timeout?: number; remove?: boolean; removeVolumes?: boolean }): Promise<unknown>
}

type RuntimeClient = {
  container: {
    getById(id: string): {
      inspect(options: { abortSignal: AbortSignal }): Promise<{
        Id: string
        Config: { Labels: Record<string, string> | null }
        State: { Running: boolean }
      }>
      remove(options: { force: boolean; v: boolean; abortSignal: AbortSignal }): Promise<unknown>
    }
  }
}

export function stopTestContainer(
  fixture: FixtureContainer,
  getRuntimeClient: () => Promise<RuntimeClient>,
): Promise<void>
export function cleanupFixtures(...steps: Array<() => Promise<unknown>>): Promise<void>
