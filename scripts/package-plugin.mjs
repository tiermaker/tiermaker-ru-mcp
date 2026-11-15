import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { crc32 } from 'node:zlib'
// Store-only ZIP: reproducible contents, zero metadata timestamps, no external archiver.
const root = resolve('distribution/chatgpt')
const entries = []
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else entries.push([relative(root, path).replaceAll('\\', '/'), readFileSync(path)])
  }
}
walk(root)
entries.push(['skills/tiermaker/SKILL.md', readFileSync('skills/tiermaker/SKILL.md')])
const local = [], central = []
let offset = 0
for (const [name, data] of entries) {
  const filename = Buffer.from(name), crc = crc32(data)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4)
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26)
  const record = Buffer.alloc(46)
  record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6)
  record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42)
  local.push(header, filename, data); central.push(record, filename)
  offset += header.length + filename.length + data.length
}
const directory = Buffer.concat(central), end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
mkdirSync('artifacts', { recursive:true })
writeFileSync('artifacts/tiermaker-ru-plugin.zip', Buffer.concat([...local, directory, end]))
console.log(`artifacts/tiermaker-ru-plugin.zip (${entries.length} files)`)
