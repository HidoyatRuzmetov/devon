// Public surface of the realtime layer. Feature code imports from here, never from `client.ts`
// directly -- the same "one barrel" convention `@devon/db` and `@devon/ui` already follow, so the
// singleton's internals stay swappable.
export {
  ensureRealtimeConnection,
  publishToCanvas,
  realtimeChannels,
  realtimeStatus,
  resetRealtime,
  type PresenceMember,
  type RealtimeMessage,
  type RealtimeStatus,
} from './client.js'

export {
  useBoardSignals,
  useChannel,
  useIsLive,
  usePresence,
  useRealtimeBridge,
  useRealtimeChannels,
  useRealtimeStatus,
  useSignalWhile,
  type EphemeralSignal,
} from './hooks.js'

export {
  fetchPresence,
  fetchRealtimeConfig,
  sendBoardSignal,
  type BoardSignalKind,
  type PresencePerson,
  type RealtimeConfig,
} from './api.js'

export {
  useCardSignalSource,
  useCardSignals,
  type CardSignal,
} from './signals-store.js'
