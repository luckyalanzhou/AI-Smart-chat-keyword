import type { Mood, ReplyProfile } from "./reply-profile.js"
import { defaultReplyProfile, generateFallbackReplies, normalizeReplyProfile } from "./reply-profile.js"

export type Gender = ReplyProfile["gender"]
export type { Mood }
export interface Profile extends ReplyProfile {}

export const defaultProfile: Profile = defaultReplyProfile
export const normalizeProfile = normalizeReplyProfile
export function generateReplies(sentence: string, profile: Profile): string[] {
  return generateFallbackReplies(sentence, profile)
}
