export type ReasoningEffort = "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
export type ReasoningProvider = "OpenAI" | "DeepSeek" | "通义千问" | "Google Gemini" | string
export function getReasoningEffortChoices(provider: ReasoningProvider, model: string): Array<{ value: ReasoningEffort; label: string }>
export function supportsReasoningEffort(provider: ReasoningProvider, model: string): boolean
export function buildReasoningOptions(provider: ReasoningProvider, model: string, effort: ReasoningEffort | string): {
  chatCompletions: Record<string, string>
  responses: Record<string, { effort: string }>
  geminiGeneration: Record<string, { thinkingLevel: string }>
}
export function isOpenAIReasoningModel(provider: ReasoningProvider, model: string): boolean
