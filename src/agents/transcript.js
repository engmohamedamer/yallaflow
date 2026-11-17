// The chat transcript of one checkout (PF-0165): what the agent chat shows, kept so that a
// long reply, a page reload or a console restart never loses the conversation.
//
// - In memory: the newest events, with consecutive streamed chunks of one reply merged into
//   one event. A long reply is one entry, so it can never push the question above it out.
// - On disk: `.yallaflow/local/agent-chat/transcript.jsonl` (git-ignored, readable only by
//   this user), one event per line, secret-looking values redacted before they are written.
//   The file is rotated once at MAX_BYTES (one older file is kept), so the saved history is
//   bounded: that limit is told to the reader, never hidden. Rotation happens only where an
//   entry starts, so neither file begins or ends in the middle of a message.
// - Saving can be turned off (the developer's preference, `saving()`): later entries stay in
//   memory only and what is already saved is kept until it is cleared. The choice is made
//   when an entry starts, so a reply is saved whole or not at all, never half.
// - clear() deletes this checkout's saved files (only its two known files) and the memory.
// - Redaction is a safety net for recognizable secret shapes, not a guarantee.
// - Every event gets `n`, a number that only grows for this checkout, also across console
//   restarts. The page uses it to load older events (`before`) and to never show one twice.
//
// Nothing is written until an agent event happens: opening or reading the chat creates no file.
import { rename, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { inLocalDir, safeAppendFile, safeRemove } from './local-files.js';
import { redactSecrets } from '../security/redact.js';

export const TRANSCRIPT_FILE = 'transcript.jsonl';
export const TRANSCRIPT_OLDER_FILE = 'transcript.1.jsonl';
export const TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;
export const MEMORY_EVENTS = 400;
const MERGEABLE = Object.freeze(['message.delta', 'thought.delta']);
const FLUSH_MS = 800;
// A file this much above MAX_BYTES (one enormous reply) is still read; beyond it, the page is told.
const READ_FACTOR = 8;

const lastN = (event) => event.endN ?? event.n;

// Appends an event to a merged list: a streamed chunk extends the chunk before it.
export function mergeEvent(list, event) {
  const last = list.at(-1);
  if (last && MERGEABLE.includes(event.type) && last.type === event.type && !last.restored === !event.restored) {
    last.text = `${last.text ?? ''}${event.text ?? ''}`;
    last.endN = lastN(event);
    return last;
  }
  const copy = { ...event };
  list.push(copy);
  return copy;
}

function parseLines(text) {
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      // A line that is not one of our events (a cut-off last line, an edited file) is skipped.
      if (event && typeof event === 'object' && typeof event.type === 'string' && Number.isSafeInteger(event.n)) events.push(event);
    } catch { /* skipped */ }
  }
  return events;
}

export class Transcript {
  // dirFor: async () => the checkout's private agent-chat folder (created on first write).
  // readDir: async () => the same folder, or null when it does not exist (never creates it).
  constructor({ dirFor, readDir, saving = () => true, maxBytes = TRANSCRIPT_MAX_BYTES, memoryEvents = MEMORY_EVENTS, flushMs = FLUSH_MS } = {}) {
    this.dirFor = dirFor;
    this.saving = saving;
    this.readDir = readDir;
    this.maxBytes = maxBytes;
    this.memoryEvents = memoryEvents;
    this.flushMs = flushMs;
    this.events = []; // merged, newest last
    this.last = 0;
    this.loaded = null; // the one load of the saved history
    this.earliestOnDisk = null;
    this.pending = null; // a merged chunk not written yet
    this.timer = null;
    this.chain = Promise.resolve();
    this.bytes = null;
    this.writeError = null;
    this.runStart = null;
    this.journaling = false; // whether the entry being written now is saved
    this.pendingContinues = false; // the pending chunk continues an entry already partly saved
    this.readError = null;
  }

  // Numbers the event (it is the object that is broadcast) and keeps it.
  add(event) {
    // Growing across restarts without reading the file first: never below the clock.
    this.last = Math.max(this.last + 1, Date.now() * 1000);
    event.n = this.last;
    this.runStart ??= event.n; // everything below it was saved by an earlier console run
    const kept = mergeEvent(this.events, event);
    const starts = kept.n === event.n; // a new entry, not a chunk added to the one before
    if (this.events.length > this.memoryEvents) this.events.splice(0, this.events.length - this.memoryEvents);
    if (starts) this.journaling = Boolean(this.dirFor) && this.saving() !== false;
    if (this.journaling) this.journal(event, starts);
    return event;
  }

  journal(event, starts = true) {
    if (MERGEABLE.includes(event.type)) {
      if (this.pending && this.pending.type === event.type) { this.pending.text += event.text ?? ''; this.pending.endN = event.n; }
      else { this.flushPending(); this.pending = { ...event }; this.pendingContinues = !starts; }
      if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; this.flushPending(); }, this.flushMs); this.timer.unref?.(); }
      return;
    }
    this.flushPending();
    this.write(event);
  }

  flushPending() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending) return;
    const event = this.pending;
    this.pending = null;
    this.write(event, this.pendingContinues);
  }

  // continues: the line adds to an entry whose start is already saved, so the file is not
  // rotated before it (that would split one message across the retention limit).
  write(event, continues = false) {
    const line = `${JSON.stringify(event, (_key, value) => (typeof value === 'string' ? redactSecrets(value) : value))}\n`;
    this.chain = this.chain.then(async () => {
      const dir = await this.dirFor();
      if (this.bytes === null) this.bytes = await inLocalDir(dir, async (base) => (await stat(path.join(base, TRANSCRIPT_FILE)).catch(() => ({ size: 0 }))).size);
      if (!continues && this.bytes + line.length > this.maxBytes && this.bytes > 0) {
        // One older file is kept; what was in the file before it is the declared limit.
        await inLocalDir(dir, (base) => rename(path.join(base, TRANSCRIPT_FILE), path.join(base, TRANSCRIPT_OLDER_FILE)));
        this.bytes = 0;
        this.earliestOnDisk = null;
      }
      await safeAppendFile(dir, TRANSCRIPT_FILE, line);
      this.bytes += Buffer.byteLength(line);
      this.writeError = null;
    }).catch((error) => {
      // The conversation continues in memory; the page is told that saving failed.
      this.writeError = String(error.message ?? error).slice(0, 200);
    });
  }

  // Everything accepted so far is on disk (or its failure recorded).
  async flush() {
    this.flushPending();
    await this.chain;
  }

  async readDisk() {
    const dir = this.readDir ? await this.readDir().catch(() => null) : null;
    if (!dir) return [];
    const readOne = (name) => inLocalDir(dir, async (base) => {
      let handle;
      try {
        handle = await open(path.join(base, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1) return '';
        if (info.size > this.maxBytes * READ_FACTOR) { this.readError = `${name} is larger than ${Math.round((this.maxBytes * READ_FACTOR) / 1048576)} MB and was not read.`; return ''; }
        return await handle.readFile('utf8');
      } catch {
        return '';
      } finally {
        await handle?.close();
      }
    }).catch(() => '');
    const events = [...parseLines(await readOne(TRANSCRIPT_OLDER_FILE)), ...parseLines(await readOne(TRANSCRIPT_FILE))];
    events.sort((a, b) => a.n - b.n);
    return events;
  }

  // Once per console run: the saved history comes back into memory, marked `restored` (a
  // restored permission request is history, never an open request).
  load() {
    this.loaded ??= (async () => {
      const saved = await this.readDisk();
      if (!saved.length) return;
      this.earliestOnDisk = saved[0].n;
      const live = this.events.splice(0);
      const firstLive = live[0]?.n ?? Infinity;
      const merged = [];
      for (const event of saved) if (lastN(event) < firstLive) mergeEvent(merged, { ...event, restored: true });
      this.events.push(...merged.slice(-this.memoryEvents), ...live);
      if (this.events.length > this.memoryEvents) this.events.splice(0, this.events.length - this.memoryEvents);
      this.last = Math.max(this.last, lastN(saved.at(-1)));
    })().catch(() => {});
    return this.loaded;
  }

  // The newest `limit` events and whether older ones exist (in memory or saved).
  async latest(limit = 200) {
    await this.load();
    const events = this.events.slice(-limit);
    const first = events[0]?.n ?? null;
    const earliest = Math.min(this.events[0]?.n ?? Infinity, this.earliestOnDisk ?? Infinity);
    return { events, hasOlder: first !== null && earliest < first, saved: Boolean(this.dirFor) && this.saving() !== false, ...(this.writeError ? { saveError: this.writeError } : {}), ...(this.readError ? { readError: this.readError } : {}) };
  }

  // Events before `before`, oldest first: from memory when it reaches that far, else from disk.
  async older(before, limit = 100) {
    await this.load();
    await this.flush();
    const inMemory = this.events.filter((event) => lastN(event) < before);
    // Memory answers only when it holds more than the page asked for; at its edge the saved
    // file decides, so "no older messages" is never said while older ones are saved.
    const memoryReaches = inMemory.length > limit;
    let pool = inMemory;
    if (!memoryReaches) {
      const merged = [];
      for (const event of await this.readDisk()) if (lastN(event) < before) mergeEvent(merged, this.runStart && event.n >= this.runStart ? event : { ...event, restored: true });
      if (merged.length >= inMemory.length) pool = merged;
    }
    const events = pool.slice(-limit);
    return { events, hasOlder: pool.length > events.length };
  }

  // Deletes this checkout's saved conversation (its two files, nothing else) and empties the
  // memory. Writes accepted before it finish first; a reply still arriving is not saved
  // half: saving resumes with the next entry. Event numbers keep growing.
  async clear() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
    this.journaling = false;
    this.events.splice(0); // the bridge holds this same list
    this.loaded = Promise.resolve(); // nothing saved comes back after a clear
    let failure = null;
    const removal = this.chain.then(async () => {
      const dir = this.readDir ? await this.readDir() : null;
      if (dir) for (const name of [TRANSCRIPT_FILE, TRANSCRIPT_OLDER_FILE]) await safeRemove(dir, name);
      this.bytes = null;
      this.earliestOnDisk = null;
      this.writeError = null;
      this.readError = null;
    }).catch((error) => { failure = error; });
    this.chain = removal;
    await removal;
    if (failure) throw Object.assign(new Error(`The saved conversation could not be deleted: ${String(failure.message ?? failure).slice(0, 200)}`), { status: 500, code: 'CHAT_CLEAR_FAILED' });
    return { cleared: true };
  }
}
