import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { BoardStore, type Board, type TierInput } from './board.js'
import { fail } from './schema.js'

const DAY = 86400000
/** A single process/replica owns the database. Mutation callbacks must be synchronous. */
export class SqliteStore extends BoardStore {
  private db: DatabaseSync
  private pending?: Map<string, Board>
  constructor(path: string, private now = Date.now) {
    super()
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA max_page_count=65536;
      CREATE TABLE IF NOT EXISTS boards(id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(token TEXT PRIMARY KEY, board TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, data BLOB NOT NULL, mime TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS boards_expiry ON boards(expires);
      CREATE INDEX IF NOT EXISTS artifacts_expiry ON artifacts(expires);`)
  }
  override create(title: string, tiers?: TierInput[]): Board {
    const board = super.create(title, tiers)
    this.boards.delete(board.id)
    board.id = randomBytes(32).toString('hex')
    return board
  }
  override get(id: string): Board {
    if (!/^[a-f0-9]{64}$/.test(id)) return fail('Board not found or expired. Create a new board.')
    const cached = this.pending?.get(id)
    if (cached) return cached
    const row = this.db.prepare('SELECT data FROM boards WHERE id=? AND expires>?').get(id, this.now())
    if (!row) return fail('Board not found or expired. Create a new board.')
    const board = JSON.parse(row.data as string) as Board
    this.pending?.set(id, board)
    return board
  }
  override save(board: Board): void {
    const data = JSON.stringify(board)
    if (Buffer.byteLength(data) > 512 * 1024) fail("Board size limit exceeded; shorten labels or image URLs.")
    this.db.prepare('INSERT INTO boards VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, expires=excluded.expires')
      .run(board.id, data, this.now() + 7 * DAY)
  }
  override transaction<T>(fn: () => T): T {
    if (this.pending) throw Error('Nested transaction')
    this.db.exec('BEGIN IMMEDIATE')
    this.pending = new Map()
    try {
      const result = fn()
      if (result instanceof Promise) throw Error('Mutation must be synchronous')
      for (const board of this.pending.values()) this.save(board)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally { this.pending = undefined }
  }
  artifact(boardId: string, data: Buffer, mime: string): string {
    this.get(boardId)
    const token = randomBytes(32).toString('hex')
    this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?)').run(token, boardId, data, mime, this.now() + DAY)
    return token
  }
  download(token: string): { data: Buffer; mime: string } | undefined {
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined
    const row = this.db.prepare('SELECT a.data,a.mime FROM artifacts a JOIN boards b ON b.id=a.board WHERE a.token=? AND a.expires>? AND b.expires>?').get(token, this.now(), this.now())
    return row ? { data: Buffer.from(row.data as Uint8Array), mime: row.mime as string } : undefined
  }
  cleanup(): void {
    this.db.prepare('DELETE FROM artifacts WHERE expires<=?').run(this.now())
    this.db.prepare('DELETE FROM boards WHERE expires<=?').run(this.now())
  }
  backup(path: string): void {
    // VACUUM INTO creates a consistent standalone copy including committed WAL contents.
    this.db.prepare('VACUUM INTO ?').run(path)
  }
  close(): void { this.db.close() }
}
