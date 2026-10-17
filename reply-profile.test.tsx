const assert = require("node:assert/strict")
const {
  defaultReplyProfile,
  normalizeReplyProfile,
  buildReplyProfileInstruction,
  generateFallbackReplies,
} = require("./reply-profile.js")

const legacy = normalizeReplyProfile({
  gender: "男", age: 28, mood: "相亲", personality: "内向", tone: "土味情话",
})
assert.deepEqual(legacy, {
  gender: "男", age: 28, mood: "普通", communicationStyle: "内敛", tone: "俏皮", relationship: "相亲了解",
})
assert.deepEqual(normalizeReplyProfile({ mood: "难过", personality: "外向", tone: "成熟" }), {
  ...defaultReplyProfile, mood: "低落", communicationStyle: "健谈", tone: "成熟稳重",
})

const categories = {
  mood: "忙碌", communicationStyle: "内敛", tone: "简洁", relationship: "工作关系",
}
const instructions = buildReplyProfileInstruction(categories)
for (const term of ["忙碌", "简短回应", "内敛", "少主动追问", "简洁", "工作关系", "专业"]) {
  assert.ok(instructions.includes(term), `profile instructions should include behavior for ${term}`)
}

const vulnerable = generateFallbackReplies("我今天特别难过", {
  mood: "开心", tone: "活泼", relationship: "工作关系",
})
assert.ok(vulnerable.every((reply) => !/[！!]/.test(reply)), "sensitive content should override playful emphasis")
assert.ok(vulnerable.every((reply) => !reply.includes("抱抱")), "work context should avoid intimate wording")

const concise = generateFallbackReplies("你今天怎么样？", {
  mood: "普通", communicationStyle: "内敛", tone: "简洁", relationship: "普通朋友",
})
assert.equal(concise.length, 3)
assert.ok(concise.every((reply) => reply.length <= 18), "concise/introverted preference should shorten fallback replies")

const dating = generateFallbackReplies("最近周末喜欢做什么？", {
  relationship: "相亲了解", communicationStyle: "慢热", tone: "自然",
})
assert.ok(dating[2].includes("慢慢多了解"), "blind-date context should be explicitly reflected in fallback")

console.log("Reply profile tests passed (5 cases)")
