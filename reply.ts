export type Gender = "女" | "男" | "不透露"
export type Mood = "开心" | "忙碌" | "疲惫" | "难过" | "生气" | "暧昧" | "相亲" | "普通"

export interface Profile {
  gender: Gender
  age: number
  mood: Mood
  tone: "温柔" | "活泼" | "成熟" | "简洁" | "土味情话" | "连环屁"
}

export const defaultProfile: Profile = {
  gender: "不透露",
  age: 25,
  mood: "普通",
  tone: "温柔",
}

export function generateReplies(sentence: string, profile: Profile): string[] {
  const s = sentence.trim()
  const ageHint = profile.age < 20 ? "呀" : profile.age > 35 ? "呢" : "呀"
  const end = profile.tone === "简洁" ? "" : ageHint
  if (!s) return ["嗯嗯，收到啦", "好的，我知道了", "你继续说"]
  if (/[?？]|吗$|怎么|为什么|能不能|可以吗/.test(s)) {
    return [`我想想${end}`, `可以呀，具体是怎么安排的${end}`, `你的意思是……对吗？`]
  }
  if (/累|疲惫|加班|忙|睡|困/.test(s)) {
    return [`辛苦啦，忙完记得好好休息${end}`, "抱抱，别把自己累坏了", "你先忙，晚点再聊也可以"]
  }
  if (/难过|伤心|委屈|失望|不开心/.test(s)) {
    return ["怎么啦，我在听", "先抱抱你，别一个人憋着", "如果你愿意，可以和我说说"]
  }
  if (/哈哈|开心|好玩|成功|喜欢/.test(s)) {
    return [`听起来很不错${end}！`, "哈哈，那我也替你开心", "这也太棒了，和我多讲一点"]
  }
  if (/生气|烦|讨厌|无语/.test(s)) {
    return ["先消消气，慢慢说", "听着确实挺让人生气的", "我站你这边，想怎么处理？"]
  }
  if (/吃|饭|饿/.test(s)) return ["好呀，记得按时吃饭", "你想吃什么？", "先去吃点东西吧"]
  if (profile.mood === "忙碌") return ["我现在有点忙，晚点认真回你", "收到，我忙完找你", "先记下啦，等我一下"]
  if (profile.mood === "疲惫") return ["我有点累，晚点再聊好吗", "收到啦，我先缓一会儿", "今天状态一般，但我有在看"]
  if (profile.mood === "相亲") return ["和你聊天感觉挺舒服的，你平时周末喜欢做什么？", "这个话题挺有意思的，我也想听听你的想法", "我们可以慢慢了解，不用太有压力"]
  if (profile.tone === "土味情话") return ["你一开口，我这边的心就自动联网了", "你是Wi-Fi吗？我一靠近你就有感觉", "我本来想回三个字，后来发现是我想你"]
  if (profile.tone === "连环屁") return ["哈哈哈哈你说得对但我先笑为敬", "不是吧不是吧，这都被你发现了", "等一下让我组织语言，算了不组织了"]
  if (profile.tone === "成熟") return ["我理解你的意思，我们可以再具体聊聊", "收到，我会认真考虑", "这件事可以稳妥一点处理"]
  if (profile.tone === "温柔") return ["好哒，我看到啦", "嗯嗯，慢慢来就好", "谢谢你和我说这些"]
  if (profile.tone === "活泼") return [`好哇好哇${end}！`, "哈哈收到，安排上了", "没问题，冲呀！"]
  return ["嗯嗯，收到啦", "好呀，我知道了", "可以的，继续说说看"]
}
