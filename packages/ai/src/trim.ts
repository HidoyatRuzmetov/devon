// History trimming (TECH-SPEC §8: "history trimmed to fit 256k"). No feature in this codebase keeps
// a long multi-turn conversation today (every feature is one preview call), but the gateway's `run()`
// always trims before sending -- so a future feature that does accumulate turns (a chat-style "ask
// with citations" in EPIC-016) gets this for free instead of learning the hard way why it is needed.
//
// Token counting here is an estimate, not a real tokenizer (GLM's tokenizer is not vendored into this
// repo, and the API does not expose one) -- ~4 characters/token is the same rough-and-ready heuristic
// OpenAI's own docs use for English; `charsPerToken` is a parameter precisely so a caller with better
// information (or a test asserting exact boundaries) can override it.
import type { ChatMessage } from './types.js'

export const DEFAULT_CHARS_PER_TOKEN = 4

export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / charsPerToken)
}

function messageTokens(message: ChatMessage, charsPerToken: number): number {
  let tokens = estimateTokens(message.content ?? '', charsPerToken) + 4 // per-message overhead, OpenAI-style
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      tokens +=
        estimateTokens(call.name, charsPerToken) + estimateTokens(call.argumentsJson, charsPerToken)
    }
  }
  return tokens
}

/**
 * Keeps the leading system message (if any, always kept in full) plus as many of the most recent
 * remaining messages as fit under `budgetTokens`, dropping the oldest first. Never splits a message
 * in half -- a message that alone exceeds the budget is truncated on its `content` field instead of
 * being silently dropped whole, so a caller always gets at least the *shape* of the most recent turn.
 */
export function trimHistory(
  messages: readonly ChatMessage[],
  budgetTokens: number,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
): ChatMessage[] {
  if (messages.length === 0) return []

  const system = messages[0]?.role === 'system' ? messages[0] : null
  const rest = system ? messages.slice(1) : messages.slice()

  let remaining = budgetTokens - (system ? messageTokens(system, charsPerToken) : 0)
  const kept: ChatMessage[] = []

  for (let i = rest.length - 1; i >= 0; i--) {
    const message = rest[i]!
    const cost = messageTokens(message, charsPerToken)
    if (cost <= remaining) {
      kept.unshift(message)
      remaining -= cost
      continue
    }
    // Doesn't fit whole. If it's the most recent message and nothing else has been kept yet, truncate
    // its content to what fits rather than dropping the newest turn entirely.
    if (kept.length === 0 && remaining > 8) {
      const maxChars = Math.max(0, (remaining - 4) * charsPerToken)
      kept.unshift({ ...message, content: (message.content ?? '').slice(0, maxChars) })
    }
    break
  }

  return system ? [system, ...kept] : kept
}
