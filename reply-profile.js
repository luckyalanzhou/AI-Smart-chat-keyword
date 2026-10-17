const moods = ["普通", "开心", "忙碌", "疲惫", "低落", "烦躁"]
const communicationStyles = ["自然", "内敛", "健谈", "慢热", "直率"]
const expressionStyles = ["自然", "温柔", "活泼", "简洁", "幽默", "成熟稳重", "俏皮"]
const relationshipContexts = ["不指定", "普通朋友", "暧昧/约会", "相亲了解", "伴侣", "工作关系"]

const defaultReplyProfile = {
  gender: "不透露",
  age: 25,
  mood: "普通",
  communicationStyle: "健谈",
  tone: "自然",
  relationship: "不指定",
}

function normalizeReplyProfile(value) {
  const source = value && typeof value === "object" ? value : {}
  let mood = source.mood
  let relationship = source.relationship
  if (mood === "暧昧") { mood = "普通"; if (!relationship) relationship = "暧昧/约会" }
  if (mood === "相亲") { mood = "普通"; if (!relationship) relationship = "相亲了解" }
  if (mood === "难过") mood = "低落"
  if (mood === "生气") mood = "烦躁"

  let communicationStyle = source.communicationStyle
  if (!communicationStyle) {
    if (source.personality === "内向") communicationStyle = "内敛"
    else if (source.personality === "外向") communicationStyle = "健谈"
  }
  const toneMap = { 成熟: "成熟稳重", "土味情话": "俏皮", 连环屁: "幽默" }
  const tone = toneMap[source.tone] || source.tone
  const gender = ["女", "男", "不透露"].includes(source.gender) ? source.gender : defaultReplyProfile.gender
  const age = Number.isFinite(Number(source.age)) ? Math.max(1, Math.min(120, Math.round(Number(source.age)))) : defaultReplyProfile.age
  return {
    gender,
    age,
    mood: moods.includes(mood) ? mood : defaultReplyProfile.mood,
    communicationStyle: communicationStyles.includes(communicationStyle) ? communicationStyle : defaultReplyProfile.communicationStyle,
    tone: expressionStyles.includes(tone) ? tone : defaultReplyProfile.tone,
    relationship: relationshipContexts.includes(relationship) ? relationship : defaultReplyProfile.relationship,
  }
}

function buildReplyProfileInstruction(input) {
  const profile = normalizeReplyProfile(input)
  const instructions = {
    mood: {
      普通: "状态普通：自然回应，不额外添加情绪设定。",
      开心: "状态开心：可以稍微积极轻快，但不要无端夸张。",
      忙碌: "状态忙碌：优先简短回应；不要承诺稍后联系，除非用户明确表达过。",
      疲惫: "状态疲惫：语气放缓、减少铺陈，但仍认真回应对方。",
      低落: "状态低落：语气平和克制，不强行积极，也不把用户写成需要安慰对方。",
      烦躁: "状态烦躁：表达简洁直接，不迁怒、不升级冲突。",
    },
    communication: {
      自然: "沟通习惯自然：像日常聊天一样回应，不刻意增加追问。",
      内敛: "沟通习惯内敛：表达克制、简短，少主动追问，但不要显得冷漠。",
      健谈: "沟通习惯健谈：可多承接对方内容，必要时自然追问一个相关问题，不要连环提问。",
      慢热: "沟通习惯慢热：礼貌友好、逐步拉近距离，不突然亲密或过度热情。",
      直率: "沟通习惯直率：清楚表达重点，不绕弯、不刻薄。",
    },
    tone: {
      自然: "表达风格自然：优先贴合上下文，不额外添加明显表演感。",
      温柔: "表达风格温柔：措辞体贴柔和，但避免模板式安慰。",
      活泼: "表达风格活泼：节奏轻快、有精神，但不过度使用感叹词。",
      简洁: "表达风格简洁：删去铺垫，保留必要回应，不要短到答非所问。",
      幽默: "表达风格幽默：仅在话题合适时轻松一下；对方难过、冲突或严肃时不说笑。",
      成熟稳重: "表达风格成熟稳重：平和、清晰、有分寸，不说教。",
      俏皮: "表达风格俏皮：可轻松机灵，但不强行撩拨或使用油腻套路。",
    },
    relationship: {
      不指定: "关系语境不指定：不要推断恋爱、暧昧或其他身份，保持友好中性。",
      普通朋友: "关系语境为普通朋友：轻松平等，避免恋爱式称呼和暗示。",
      "暧昧/约会": "关系语境为暧昧/约会：可以适度亲近、表达兴趣，但尊重边界，不默认对方已接受关系。",
      相亲了解: "关系语境为相亲了解：礼貌真诚、循序渐进，可以表达了解意愿，不催促、不假装熟络。",
      伴侣: "关系语境为伴侣：可以亲密体贴，但不要编造共同经历、承诺或具体感受。",
      工作关系: "关系语境为工作关系：专业、清楚、礼貌，避免暧昧、过度随意或私密表达。",
    },
  }
  return `用户偏好（请逐项落实，不能只复述标签）：\n- 当前状态：${profile.mood}。${instructions.mood[profile.mood]}\n- 沟通习惯：${profile.communicationStyle}。${instructions.communication[profile.communicationStyle]}\n- 表达风格：${profile.tone}。${instructions.tone[profile.tone]}\n- 关系语境：${profile.relationship}。${instructions.relationship[profile.relationship]}\n性别与年龄仅作轻微措辞参考，不得据此套用刻板印象。若偏好之间或偏好与对方消息冲突，优先尊重对方消息的真实语境与边界；不得编造事实。`
}

function generateFallbackReplies(sentence, input) {
  const profile = normalizeReplyProfile(input)
  const s = String(sentence || "").trim()
  if (!s) return ["嗯？你还没说完", "我在听，继续说", "怎么啦？"]

  let replies
  if (/难过|伤心|委屈|失望|不开心|低落/.test(s)) replies = ["听起来你现在不太好受，我在听", "抱抱你，想说的话我陪你慢慢说", "这件事确实不容易，你愿意多讲一点吗"]
  else if (/生气|烦|讨厌|无语|冲突/.test(s)) replies = ["听起来这件事让你挺烦的", "我先听你说完，再一起想想怎么处理", "确实容易让人不舒服，你最在意的是哪一点？"]
  else if (/累|疲惫|加班|忙|睡|困/.test(s)) replies = ["辛苦了，先照顾好自己", "你先忙/休息，有空再聊", "听起来今天挺耗精力的"]
  else if (/[?？]|吗$|怎么|为什么|能不能|可以吗|啥意思|什么意思/.test(s)) replies = ["我明白你的问题了，我想想怎么回答", "可以，我们具体对一下细节", "你的重点是这个吗？"]
  else if (/哈哈|开心|好玩|成功|喜欢|绝了|牛/.test(s)) replies = ["听起来挺不错的，替你开心", "哈哈，这下有意思了", "不错呀，后来怎么样了？"]
  else if (/吃|饭|饿/.test(s)) replies = ["还没想好吃什么呢", "你今天想吃什么？", "记得按时吃饭"]
  else replies = ["嗯，我看到啦", "我明白你的意思了", "好呀，我们接着聊"]

  if (profile.mood === "忙碌") replies = replies.map((reply) => reply.length > 18 ? reply.slice(0, 18) : reply)
  if (profile.mood === "疲惫" || profile.communicationStyle === "内敛" || profile.tone === "简洁") replies = replies.map((reply) => reply.replace(/，.*$/, ""))
  if (profile.tone === "活泼" && !/难过|伤心|委屈|失望|不开心|生气|烦|冲突/.test(s)) replies = replies.map((reply) => `${reply.replace(/[。！!？?]$/, "")}！`)
  if (profile.tone === "俏皮" && !/难过|伤心|委屈|失望|不开心|生气|烦|冲突/.test(s)) replies[1] = "哈哈，这话我先记下了"
  if (profile.tone === "幽默" && !/难过|伤心|委屈|失望|不开心|生气|烦|冲突/.test(s)) replies[1] = "这话题我可以接着聊，先让我组织一下语言"
  if (profile.communicationStyle === "慢热" || ["不指定", "普通朋友", "工作关系"].includes(profile.relationship)) {
    replies = replies.map((reply) => reply.replace(/抱抱你，?/, "").replace(/替你开心/, "听起来不错").replace(/我们接着聊/, "可以继续聊"))
  }
  if (profile.relationship === "工作关系") replies = replies.map((reply) => reply.replace(/哈哈，/g, "明白，").replace(/呀[！。]?/g, "。"))
  if (profile.tone === "成熟稳重") replies[1] = "我理解你的意思，可以再具体一点吗？"
  const sensitiveTopic = /难过|伤心|委屈|失望|不开心|生气|烦|冲突|生病|事故|压力/.test(s)
  if (!sensitiveTopic && (profile.relationship === "暧昧/约会" || profile.relationship === "相亲了解")) replies[2] = profile.relationship === "相亲了解" ? "如果你愿意，我们可以慢慢多了解一些" : "我挺愿意继续了解你的想法"
  if (sensitiveTopic && profile.relationship === "伴侣") replies[2] = "我会认真听你说"
  else if (!sensitiveTopic && profile.relationship === "伴侣") replies[2] = "我愿意认真听你说"
  if (profile.communicationStyle === "健谈" && !sensitiveTopic && replies[2] === "好呀，我们接着聊") replies[2] = "好呀，你可以多和我说说"
  if (profile.communicationStyle === "直率" && !sensitiveTopic) replies[1] = "我直接说我的想法：我明白了"
  return replies
}

module.exports = {
  moods,
  communicationStyles,
  expressionStyles,
  relationshipContexts,
  defaultReplyProfile,
  normalizeReplyProfile,
  buildReplyProfileInstruction,
  generateFallbackReplies,
}
