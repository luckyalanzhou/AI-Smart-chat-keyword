export type Mood = "普通" | "开心" | "忙碌" | "疲惫" | "低落" | "烦躁"
export type CommunicationStyle = "自然" | "内敛" | "健谈" | "慢热" | "直率"
export type ExpressionStyle = "自然" | "温柔" | "活泼" | "简洁" | "幽默" | "成熟稳重" | "俏皮"
export type RelationshipContext = "不指定" | "普通朋友" | "暧昧/约会" | "相亲了解" | "伴侣" | "工作关系"
export interface ReplyProfile {
  gender: "女" | "男" | "不透露"
  age: number
  mood: Mood
  communicationStyle: CommunicationStyle
  tone: ExpressionStyle
  relationship: RelationshipContext
}
export const moods: Mood[]
export const communicationStyles: CommunicationStyle[]
export const expressionStyles: ExpressionStyle[]
export const relationshipContexts: RelationshipContext[]
export const defaultReplyProfile: ReplyProfile
export function normalizeReplyProfile(value: unknown): ReplyProfile
export function buildReplyProfileInstruction(value: unknown): string
export function generateFallbackReplies(sentence: string, profile: unknown): string[]
