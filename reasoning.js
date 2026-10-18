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
    const snapshot = "(?:-\\d{4}-\\d{2}-\\d{2})?$"
    if (new RegExp(`^gpt-6(?:-astra|\\.1-sol)${snapshot}`).test(value)) values = ["low", "medium", "high", "xhigh", "max"]
    else if (new RegExp(`^gpt-6-(?:sol|luna)${snapshot}`).test(value)) values = ["none", "low", "medium", "high", "xhigh", "max"]
    else if (new RegExp(`^gpt-5\\.6(?:-(?:sol|terra|luna))?${snapshot}`).test(value)) values = ["none", "low", "medium", "high", "xhigh", "max"]
    else if (new RegExp(`^gpt-5\\.5-pro${snapshot}`).test(value)) values = ["medium", "high", "xhigh"]
    else if (new RegExp(`^gpt-5\\.4-pro${snapshot}`).test(value)) values = ["medium", "high", "xhigh"]
    else if (new RegExp(`^gpt-5\\.5${snapshot}`).test(value)) values = ["none", "low", "medium", "high", "xhigh"]
    else if (new RegExp(`^gpt-5\\.4(?:-mini)?${snapshot}`).test(value)) values = ["none", "low", "medium", "high", "xhigh"]
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
