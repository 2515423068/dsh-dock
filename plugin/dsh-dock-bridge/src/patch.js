/**
 * cordis.patch.yml surgery for the "DSH Dock" plugin-management card.
 *
 * The patch file is user-owned YAML, so edits are conservative line surgery
 * over a strictly recognized subset: comments, the `[]` empty-list
 * placeholder, `- insert:` items, and entry blocks shaped like
 *
 *   - insert:
 *       - id: some-id
 *         name: ./node_modules/some-pkg/src/index.js
 *         inject: [tools]
 *         config:
 *           baseUrl: http://127.0.0.1:7940
 *
 * A document containing anything else parses best-effort for reads but is
 * refused for writes (`recognized: false`), so the card can never corrupt
 * YAML it does not understand. Every write goes out through tmp+rename
 * (design R1: partial writes must never reach the live watcher).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PATCH_FILE = 'cordis.patch.yml'

/** Serialize one scalar: plain when unambiguous, single-quoted otherwise. */
function scalar(value) {
  if (/^[A-Za-z0-9_][A-Za-z0-9._~:/-]*$/.test(value) && !/^(?:true|false|null|yes|no|on|off|~)$/i.test(value) && !/^\d/.test(value)) {
    return value
  }
  return `'${value.replaceAll("'", "''")}'`
}

/** Parse a written scalar back (single/double quotes, booleans, plain). */
function parseScalar(raw) {
  const value = raw.trim()
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replaceAll("''", "'")
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replaceAll('\\"', '"')
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  return value
}

/** Split a flow sequence `[a, b]` into parsed scalars; anything else → undefined. */
function parseFlowArray(raw) {
  const value = raw.trim()
  if (!value.startsWith('[') || !value.endsWith(']')) return undefined
  const inner = value.slice(1, -1).trim()
  if (inner.length === 0) return []
  return inner.split(',').map(part => parseScalar(part))
}

const KEY_PATTERN = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/
const indentOf = line => line.length - line.trimStart().length

/**
 * Parse the patch document into entry blocks.
 * @param text - raw file text, or `null` for a missing file.
 * @returns `{ recognized, entries, emptyList, convention }`; `entries[i]`
 *   carries `{ id, name, inject, disabled, config, start, end, contentIndent }`
 *   where `end` is exclusive. `convention.entryIndent` is the document's entry
 *   indentation (canonical 4 for new files); `convention.singleIndent` is
 *   false when entries use inconsistent indentation (writes refused).
 */
export function parsePatch(text) {
  const lines = text === null ? [] : text.split('\n')
  const emptyList = lines.some(line => line.trim() === '[]')
  const entries = []
  let sawInsert = false
  let recognized = true

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue
    if (line.trim() === '[]') continue
    const item = line.match(/^(\s*)- (.*)$/)
    if (item === null) {
      recognized = false
      continue
    }
    const indent = item[1].length
    const content = item[2]
    if (indent === 0 && content === 'insert:') {
      sawInsert = true
      continue
    }
    // Entry item: `- id: ...` / `- name: ...`, nested under an insert item
    // (or at top level as a plain override row — parsed with the same shape).
    if (content.match(/^(id|name):/) === null) {
      recognized = false
      continue
    }
    const entryIndent = indent
    const contentIndent = entryIndent + 2
    const entry = { start: index, end: lines.length, contentIndent }
    // The entry's own `- id:` / `- name:` starts the block; its value lives
    // on the same line as the `- ` item marker.
    const startKey = content.match(/^(id|name):(.*)$/)
    if (startKey !== null && startKey[1] === 'id') entry.id = parseScalar(startKey[2])
    else if (startKey !== null && startKey[1] === 'name') entry.name = parseScalar(startKey[2])
    let inConfig = false
    let cursor = index + 1
    for (; cursor < lines.length; cursor++) {
      const body = lines[cursor]
      if (body.trim().length === 0 || body.trim().startsWith('#')) continue
      if (indentOf(body) < contentIndent) break
      const keyMatch = body.trim().match(KEY_PATTERN)
      if (keyMatch === null) {
        recognized = false
        continue
      }
      if (indentOf(body) === contentIndent) {
        inConfig = false
        const value = keyMatch[2] ?? ''
        if (keyMatch[1] === 'id') entry.id = parseScalar(value)
        else if (keyMatch[1] === 'name') entry.name = parseScalar(value)
        else if (keyMatch[1] === 'disabled') entry.disabled = parseScalar(value) === true
        else if (keyMatch[1] === 'inject') entry.inject = parseFlowArray(value)
        else if (keyMatch[1] === 'config' && value.length === 0) inConfig = true
        else if (value.length === 0) inConfig = false
        else recognized = false
      } else if (inConfig && indentOf(body) === contentIndent + 2) {
        entry.config = { ...entry.config, [keyMatch[1]]: parseScalar(keyMatch[2] ?? '') }
      } else {
        recognized = false
      }
    }
    entry.end = cursor
    entries.push(entry)
    index = cursor - 1
  }

  return {
    recognized,
    entries,
    emptyList,
    convention: {
      entryIndent: entries.length > 0 ? entries[0].contentIndent - 2 : 4,
      singleIndent: new Set(entries.map(entry => entry.contentIndent)).size <= 1,
      sawInsert,
    },
  }
}

/** Render one entry block in the canonical shape at the document's indentation. */
function renderEntryLines(entry, entryIndent) {
  const pad = ' '.repeat(entryIndent)
  const padBody = ' '.repeat(entryIndent + 2)
  const padConfig = ' '.repeat(entryIndent + 4)
  const lines = [`${pad}- id: ${scalar(entry.id)}`]
  lines.push(`${padBody}name: ${scalar(entry.name)}`)
  if (entry.inject !== undefined) lines.push(`${padBody}inject: [${entry.inject.map(item => scalar(item)).join(', ')}]`)
  if (entry.disabled === true) lines.push(`${padBody}disabled: true`)
  if (entry.config !== undefined) {
    lines.push(`${padBody}config:`)
    for (const [key, value] of Object.entries(entry.config)) {
      lines.push(`${padConfig}${key}: ${typeof value === 'boolean' ? String(value) : scalar(String(value))}`)
    }
  }
  return lines
}

/** Render one config child line. */
function renderConfigChild(padConfig, key, value) {
  return `${padConfig}${key}: ${typeof value === 'boolean' ? String(value) : scalar(String(value))}`
}

/** Read the patch file of one profile; a missing file reads as an empty document. */
export function readPatchText(profileDir) {
  try {
    return readFileSync(path.join(profileDir, PATCH_FILE), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/** Write the patch file atomically (tmp + rename). */
export function writePatchText(profileDir, text) {
  const file = path.join(profileDir, PATCH_FILE)
  mkdirSync(profileDir, { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(tmp, body)
  renameSync(tmp, file)
}

function assertWritable(parsed) {
  if (!parsed.recognized || !parsed.convention.singleIndent) {
    throw new Error('cordis.patch.yml 包含本工具无法安全改写的结构(自定义 YAML);请手动编辑该文件。')
  }
}

/** Package name a row's `name` points into (`./node_modules/<pkg>/...`). */
export function extractPackageName(name) {
  const match = String(name).match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  return match === null ? undefined : match[1]
}

function findEntry(parsed, ref) {
  return parsed.entries.find(entry => entry.id === ref)
    ?? parsed.entries.find(entry => entry.name !== undefined && extractPackageName(entry.name) === ref)
    ?? null
}

/**
 * Add an entry when neither its id nor its name is present yet. The block is
 * appended after the document body (trailing blanks dropped); an empty-list
 * `[]` placeholder is removed to keep the document a valid sequence.
 * @returns `{ text, changed, existed }`.
 */
export function upsertEntry(text, entry) {
  const parsed = parsePatch(text)
  assertWritable(parsed)
  const exists = parsed.entries.some(parsedEntry =>
    (entry.id !== undefined && parsedEntry.id === entry.id)
    || (entry.name !== undefined && parsedEntry.name === entry.name))
  if (exists) return { text, changed: false, existed: true }
  const rendered = renderEntryLines(entry, parsed.convention.entryIndent)
  let lines = text === null ? [] : text.split('\n')
  lines = lines.filter(line => line.trim() !== '[]')
  let last = lines.length - 1
  while (last >= 0 && lines[last].trim().length === 0) last--
  const next = [...lines.slice(0, last + 1), ...rendered, '']
  return { text: next.join('\n'), changed: true, existed: false }
}

/** Set (or clear) `disabled` on the entry addressed by id or package name. */
export function setEntryDisabled(text, ref, disabled) {
  const parsed = parsePatch(text)
  assertWritable(parsed)
  const entry = findEntry(parsed, ref)
  if (entry === null) return null
  const lines = text.split('\n')
  const wanted = `${' '.repeat(entry.contentIndent)}disabled: true`
  const index = lines.findIndex((line, i) =>
    i >= entry.start && i < entry.end && /^\s*disabled:/.test(line))
  let next
  if (disabled === true) {
    next = index >= 0
      ? [...lines.slice(0, index), wanted, ...lines.slice(index + 1)]
      : [...lines.slice(0, entry.start + 1), wanted, ...lines.slice(entry.start + 1)]
  } else if (index >= 0) {
    next = [...lines.slice(0, index), ...lines.slice(index + 1)]
  } else {
    return { text, changed: false }
  }
  return { text: next.join('\n'), changed: true }
}

/** Remove the entry addressed by id or package name. */
export function removeEntry(text, ref) {
  const parsed = parsePatch(text)
  assertWritable(parsed)
  const entry = findEntry(parsed, ref)
  if (entry === null) return null
  const lines = text.split('\n')
  const next = [...lines.slice(0, entry.start), ...lines.slice(entry.end)]
  return { text: next.join('\n'), changed: true }
}

/**
 * Merge config keys into the entry addressed by id or package name. Untouched
 * config child lines keep their exact original bytes; only the keys being set
 * are replaced (in place) or appended at the end of the config sub-mapping.
 */
export function setEntryConfig(text, ref, config) {
  const parsed = parsePatch(text)
  assertWritable(parsed)
  const entry = findEntry(parsed, ref)
  if (entry === null) return null
  const lines = text.split('\n')
  const padBody = ' '.repeat(entry.contentIndent)
  const padConfig = ' '.repeat(entry.contentIndent + 2)
  const configLine = lines.findIndex((line, i) =>
    i >= entry.start && i < entry.end && /^\s*config:\s*$/.test(line))
  const pending = new Map(Object.entries(config))
  let next
  if (configLine >= 0) {
    let childEnd = configLine + 1
    while (childEnd < entry.end) {
      const line = lines[childEnd]
      if (line.trim().length === 0 || line.trim().startsWith('#')) { childEnd++; continue }
      if (indentOf(line) >= entry.contentIndent + 2) childEnd++
      else break
    }
    const kept = []
    for (const line of lines.slice(configLine + 1, childEnd)) {
      const keyMatch = line.trim().match(KEY_PATTERN)
      if (keyMatch !== null && pending.has(keyMatch[1])) {
        kept.push(renderConfigChild(padConfig, keyMatch[1], pending.get(keyMatch[1])))
        pending.delete(keyMatch[1])
      } else {
        kept.push(line)
      }
    }
    for (const [key, value] of pending) kept.push(renderConfigChild(padConfig, key, value))
    next = [...lines.slice(0, configLine + 1), ...kept, ...lines.slice(childEnd)]
  } else {
    let insertAt = entry.end
    for (let i = entry.start + 1; i < entry.end; i++) {
      const line = lines[i]
      if (line.trim().length === 0 || line.trim().startsWith('#')) continue
      if (indentOf(line) === entry.contentIndent) insertAt = i + 1
    }
    const childLines = [...pending.entries()].map(([key, value]) => renderConfigChild(padConfig, key, value))
    next = [...lines.slice(0, insertAt), `${padBody}config:`, ...childLines, ...lines.slice(insertAt)]
  }
  return { text: next.join('\n'), changed: true }
}

/** All entries visible to the card, best-effort (works on unrecognized docs too). */
export function listEntries(text) {
  const parsed = parsePatch(text)
  return {
    recognized: parsed.recognized && parsed.convention.singleIndent,
    entries: parsed.entries.map(entry => ({
      id: entry.id,
      name: entry.name,
      pkg: entry.name === undefined ? undefined : extractPackageName(entry.name),
      disabled: entry.disabled === true,
    })),
  }
}
