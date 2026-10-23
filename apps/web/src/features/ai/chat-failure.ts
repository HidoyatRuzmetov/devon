export function chatFailure(code: string | null) {
  const keys: Record<string, string> = {
    context_limit: 'overviewChat.errors.contextLimit',
    budget_exceeded: 'overviewChat.errors.budget',
    feature_disabled: 'overviewChat.errors.disabled',
    provider_unavailable: 'overviewChat.errors.unavailable',
    provider_failed: 'overviewChat.errors.unavailable',
    empty_response: 'assistantActions.emptyResponse',
    timeout: 'overviewChat.errors.timeout',
    interrupted: 'overviewChat.errors.interrupted',
  }
  return {
    key: keys[code ?? ''] ?? 'overviewChat.failed',
    retryable: !['context_limit', 'budget_exceeded', 'feature_disabled'].includes(code ?? ''),
    newConversation: code === 'context_limit',
  }
}
