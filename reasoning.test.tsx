const assert = require("node:assert/strict")
const reasoning = require("./reasoning.js")

assert.equal(reasoning.supportsReasoningEffort("OpenAI", "gpt-5.6"), true)
assert.equal(reasoning.supportsReasoningEffort("OpenAI", "gpt-4o-mini"), false)
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-5.6").map(({ value }) => value), ["auto", "none", "low", "medium", "high", "xhigh", "max"])
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-5.6-terra-2026-02-16").map(({ value }) => value), ["auto", "none", "low", "medium", "high", "xhigh", "max"])
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-6-astra").map(({ value }) => value), ["auto", "low", "medium", "high", "xhigh", "max"])
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-6.1-sol").map(({ value }) => value), ["auto", "low", "medium", "high", "xhigh", "max"])
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-6-sol").map(({ value }) => value), ["auto", "none", "low", "medium", "high", "xhigh", "max"])
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-6-luna").map(({ value }) => value), ["auto", "none", "low", "medium", "high", "xhigh", "max"])
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-5.5-pro").map(({ value }) => value), ["auto", "medium", "high", "xhigh"])
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-5.4-pro").map(({ value }) => value), ["auto", "medium", "high", "xhigh"])
assert.deepEqual(reasoning.getReasoningEffortChoices("OpenAI", "gpt-5.4-mini").map(({ value }) => value), ["auto", "none", "low", "medium", "high", "xhigh"])
for (const model of [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-pro",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.3-codex",
  "gpt-5.4-nano",
  "gpt-5.4-cyber",
  "gpt-5.5-codex",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
  "o4-mini",
]) {
  assert.equal(reasoning.supportsReasoningEffort("OpenAI", model), false, `${model} should not expose reasoning controls`)
}
assert.equal(reasoning.supportsReasoningEffort("OpenAI", "gpt-5.6-experimental"), false)
assert.equal(reasoning.supportsReasoningEffort("OpenAI", "gpt-6-astra-preview"), false)
assert.equal(reasoning.supportsReasoningEffort("DeepSeek", "deepseek-v4-flash"), true)
assert.equal(reasoning.supportsReasoningEffort("DeepSeek", "deepseek-v3.2"), false)
assert.deepEqual(reasoning.getReasoningEffortChoices("DeepSeek", "deepseek-v4-flash").map(({ value }) => value), ["auto", "low", "high", "max"])
assert.equal(reasoning.supportsReasoningEffort("通义千问", "qwen3.8-max"), true)
assert.equal(reasoning.supportsReasoningEffort("通义千问", "qwen-turbo"), false)
assert.deepEqual(reasoning.getReasoningEffortChoices("通义千问", "qwen3.8-max").map(({ value }) => value), ["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"])
assert.equal(reasoning.supportsReasoningEffort("Google Gemini", "gemini-3.8-flash"), true)
assert.deepEqual(reasoning.getReasoningEffortChoices("Google Gemini", "gemini-3.8-flash").map(({ value }) => value), ["auto", "low", "medium", "high"])
assert.deepEqual(reasoning.getReasoningEffortChoices("Google Gemini", "gemini-3-pro").map(({ value }) => value), ["auto", "low", "high"])
assert.equal(reasoning.supportsReasoningEffort("Google Gemini", "gemini-2.5-flash"), false)
assert.equal(reasoning.supportsReasoningEffort("Google Gemini", "gemini-2.0-flash"), false)
assert.equal(reasoning.supportsReasoningEffort("自定义兼容接口", "gpt-5.6"), false)

assert.deepEqual(reasoning.buildReasoningOptions("OpenAI", "gpt-5.6", "medium"), {
  chatCompletions: { reasoning_effort: "medium" },
  responses: { reasoning: { effort: "medium" } },
  geminiGeneration: {},
})
assert.deepEqual(reasoning.buildReasoningOptions("DeepSeek", "deepseek-v4-flash", "max").chatCompletions, { reasoning_effort: "max" })
assert.deepEqual(reasoning.buildReasoningOptions("通义千问", "qwen3.8-max", "low").chatCompletions, { reasoning_effort: "low" })
assert.deepEqual(reasoning.buildReasoningOptions("Google Gemini", "gemini-3.8-flash", "high").geminiGeneration, { thinkingConfig: { thinkingLevel: "high" } })
assert.deepEqual(reasoning.buildReasoningOptions("OpenAI", "gpt-5.6", "auto"), { chatCompletions: {}, responses: {}, geminiGeneration: {} })
assert.deepEqual(reasoning.buildReasoningOptions("OpenAI", "gpt-6.1-sol", "high"), {
  chatCompletions: { reasoning_effort: "high" },
  responses: { reasoning: { effort: "high" } },
  geminiGeneration: {},
})

console.log("Reasoning effort tests passed.")
