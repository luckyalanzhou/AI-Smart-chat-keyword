export type QuickMessage = { id: string; text: string; answer?: string }
export type MessageCategory = { id: string; title: string; enabled: boolean; messages: QuickMessage[] }
export type MessageLibrary = { version: 1; defaultCategoryId: string; soundEnabled: boolean; categories: MessageCategory[] }
export type LibraryChange =
  | { type: "preferences"; defaultCategoryId?: string; soundEnabled?: boolean }
  | { type: "category.add"; title: string }
  | { type: "category.update"; categoryId: string; title?: string; enabled?: boolean }
  | { type: "category.remove"; categoryId: string }
  | { type: "message.save"; categoryId: string; id?: string; text: string; answer?: string }
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
