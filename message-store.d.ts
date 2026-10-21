import type { LibraryChange, MessageLibrary, MessagePage } from "./quick-messages.js"
export type DatabasePage = Omit<MessagePage, "categories"> & {
  categories: { id: string; title: string; enabled: boolean; count: number }[]
  soundEnabled: boolean
}
export type MessageStore = {
  readLibrary(): Promise<MessageLibrary>
  readPage(categoryId?: string, pageIndex?: number): Promise<DatabasePage>
  change(change: LibraryChange): Promise<MessageLibrary>
}
export const DATABASE_NAME: string
export function openLocalMessageStore(): Promise<MessageStore>
export function openMessageStore(db: {
  execute(sql: string, args?: unknown[]): Promise<void>
  fetchAll(sql: string, args?: unknown[]): Promise<Record<string, any>[]>
  transaction(steps: { sql: string; args?: unknown[] }[], options?: { kind?: string }): Promise<void>
}, legacy?: unknown, catalog?: MessageLibrary["categories"], catalogVersion?: number): Promise<MessageStore>
