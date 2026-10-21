export type QuickMessage = { id: string; text: string; answer?: string; scene?: string }
export type MessageCategory = { id: string; title: string; enabled: boolean; messages: QuickMessage[] }
export type MessageLibrary = { version: 1; defaultCategoryId: string; soundEnabled: boolean; categories: MessageCategory[] }
export type LibraryChange =
  | { type: "preferences"; defaultCategoryId?: string; soundEnabled?: boolean }
  | { type: "category.add"; title: string }
  | { type: "category.update"; categoryId: string; title?: string; enabled?: boolean }
  | { type: "category.remove"; categoryId: string }
  | { type: "message.save"; categoryId: string; id?: string; text: string; answer?: string; scene?: string }
  | { type: "message.remove"; categoryId: string; id: string }
export type MessagePage = {
  categories: MessageCategory[]; categoryId: string; title: string
  messages: QuickMessage[]; index: number; pageCount: number; total: number
}
export const LIBRARY_STORAGE_KEY: string
export const PAGE_SIZE: number
export function loadLibrary(value: unknown): MessageLibrary
export function editLibrary(library: MessageLibrary, change: LibraryChange): MessageLibrary
export function getMessagePage(library: MessageLibrary, categoryId?: string, pageIndex?: number): MessagePage
export function drawNextMessage(messages: QuickMessage[], state?: { remaining?: string[]; lastId?: string }, random?: () => number): { message: QuickMessage | null; state: { remaining: string[]; lastId: string } }
export function canReplaceInsertedMessage(previous: { text: string; after: string | null } | null, context: { before: string | null; after: string | null; selected?: string | null } | null): boolean
