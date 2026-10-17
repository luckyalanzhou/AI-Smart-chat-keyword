const LABELS = {
  auto: "自动",
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
}

export function getReasoningEffortChoices(provider, model) {
  const value = String(model || "").trim().toLowerCase()
  let values = []

  if (provider === "OpenAI") {
    if (/^gpt-5-pro(?:[.-]|$)/.test(value)) values = ["high"]
    else if (/^gpt-5\.1-codex-max(?:[.-]|$)/.test(value)) values = ["none", "low", "medium", "high", "xhigh"]
    else if (/^gpt-5\.1(?:[.-]|$)/.test(value)) values = ["none", "low", "medium", "high"]
    else if (/^gpt-5\.[2-9](?:[.-]|$)/.test(value)) values = ["none", "low", "medium", "high", "xhigh"]
    else if (/^(?:gpt-5(?:[.-]|$)|o[1-9](?:[.-]|$))/.test(value)) values = ["low", "medium", "high"]
  } else if (provider === "DeepSeek" && /^deepseek-(?:v4(?:[.-]|$)|flash$)/.test(value)) {
    values = ["low", "high", "max"]
  } else if (provider === "通义千问" && /^qwen3\.8(?:[.-]|$)/.test(value)) {
    values = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
  } else if (provider === "Google Gemini") {
    if (/^gemini-3\.8-flash(?:[.-]|$)/.test(value) || /^gemini-4-argon(?:[.-]|$)/.test(value)) values = ["low", "medium", "high"]
    else if (/^gemini-3\.1-pro(?:[.-]|$)/.test(value) || /^gemini-3-pro(?:[.-]|$)/.test(value)) values = ["low", "high"]
    else if (/^gemini-3\.1-flash-lite-image(?:[.-]|$)/.test(value)) values = ["minimal", "high"]
    else if (/^gemini-(?:3\.6-flash|3\.1-flash-lite|3-flash)(?:[.-]|$)/.test(value)) values = ["minimal", "low", "medium", "high"]
  }

  return values.length ? [{ value: "auto", label: LABELS.auto }, ...values.map((effort) => ({ value: effort, label: LABELS[effort] }))] : []
}

export function supportsReasoningEffort(provider, model) {
  return getReasoningEffortChoices(provider, model).length > 1
}

export function buildReasoningOptions(provider, model, effort) {
  const choices = getReasoningEffortChoices(provider, model)
  if (effort === "auto" || !choices.some((choice) => choice.value === effort)) {
    return { chatCompletions: {}, responses: {}, geminiGeneration: {} }
  }

  if (provider === "Google Gemini") {
    return { chatCompletions: {}, responses: {}, geminiGeneration: { thinkingConfig: { thinkingLevel: effort } } }
  }

  if (provider === "DeepSeek") {
    return { chatCompletions: { reasoning_effort: effort }, responses: {}, geminiGeneration: {} }
  }

  return {
    chatCompletions: { reasoning_effort: effort },
    responses: { reasoning: { effort } },
    geminiGeneration: {},
  }
}

export function isOpenAIReasoningModel(provider, model) {
  return provider === "OpenAI" && supportsReasoningEffort(provider, model)
}
