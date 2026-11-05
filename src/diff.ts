import { DiffLine, FileDiff, Hunk } from './types';

/**
 * Parse `git diff` unified output (with a/ b/ prefixes) into structured file diffs.
 * Tolerates renames, mode changes, binary markers, quoted paths and missing ---/+++ headers.
 */
export function parseDiff(input: string): FileDiff[] {
  const files: FileDiff[] = [];
  // Accept CRLF-terminated output (Git for Windows, CRLF-checked-out .diff files): a trailing
  // \r would otherwise break header matching (`.` does not match \r) and leak into paths.
  // Content lines already drop a trailing \r below, so this is consistent with them.
  const lines = input.split(/\r?\n/);
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const finish = () => {
    if (file) {
      if (!file.oldPath && !file.newPath) {
        // Could not determine any path, drop it.
      } else {
        if (file.status === 'modified' && file.oldPath && file.newPath && file.oldPath !== file.newPath) {
          file.status = 'renamed';
        }
        files.push(file);
      }
    }
    file = null;
    hunk = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      finish();
      const [a, b] = splitGitHeader(line.slice('diff --git '.length));
      file = { oldPath: a, newPath: b, status: 'modified', binary: false, hunks: [] };
      continue;
    }
    if (!file) {
      // Support plain unified diffs without the `diff --git` line.
      if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ ')) {
        file = { oldPath: null, newPath: null, status: 'modified', binary: false, hunks: [] };
      } else {
        continue;
      }
    }
    const f: FileDiff = file;
    if (hunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '')) {
      const h: Hunk = hunk;
      const remainingOld = h.oldStart + h.oldLines - oldNo;
      const remainingNew = h.newStart + h.newLines - newNo;
      if (remainingOld <= 0 && remainingNew <= 0) {
        hunk = null; // hunk complete; fall through to header handling
      } else if (line.startsWith('+')) {
        h.lines.push(mk('+', line.slice(1), undefined, newNo++));
        continue;
      } else if (line.startsWith('-')) {
        h.lines.push(mk('-', line.slice(1), oldNo++, undefined));
        continue;
      } else {
        // context (a bare empty line is an empty context line)
        h.lines.push(mk(' ', line.slice(1), oldNo++, newNo++));
        continue;
      }
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      if (!m) continue;
      hunk = {
        oldStart: +m[1],
        oldLines: m[2] === undefined ? 1 : +m[2],
        newStart: +m[3],
        newLines: m[4] === undefined ? 1 : +m[4],
        header: m[5].trim(),
        lines: [],
      };
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      f.hunks.push(hunk);
      continue;
    }
    if (line.startsWith('new file mode')) { f.status = 'added'; f.oldPath = null; continue; }
    if (line.startsWith('deleted file mode')) { f.status = 'deleted'; f.newPath = null; continue; }
    if (line.startsWith('rename from ')) { f.oldPath = unquote(line.slice(12)); f.status = 'renamed'; continue; }
    if (line.startsWith('rename to ')) { f.newPath = unquote(line.slice(10)); f.status = 'renamed'; continue; }
    if (line.startsWith('similarity index ')) { f.similarity = parseInt(line.slice(17), 10); continue; }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) { f.binary = true; continue; }
    if (line.startsWith('--- ')) {
      const p = stripPrefix(unquote(line.slice(4).replace(/\t.*$/, '')));
      if (p === null) { f.oldPath = null; f.status = 'added'; } else f.oldPath = p;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = stripPrefix(unquote(line.slice(4).replace(/\t.*$/, '')));
      if (p === null) { f.newPath = null; f.status = 'deleted'; } else f.newPath = p;
      continue;
    }
  }
  finish();
  return files;
}

function mk(kind: DiffLine['kind'], text: string, oldNo?: number, newNo?: number): DiffLine {
  const l: DiffLine = { kind, text: text.replace(/\r$/, ''), code: '', codeStr: '', comment: '' };
  if (oldNo !== undefined) l.oldNo = oldNo;
  if (newNo !== undefined) l.newNo = newNo;
  return l;
}

function stripPrefix(p: string): string | null {
  if (p === '/dev/null') return null;
  if (/^[abciwo]\//.test(p)) return p.slice(2);
  return p;
}

/** Decode a git C-style quoted path ("a/foo\tbar"). */
export function unquote(p: string): string {
  p = p.trim();
  if (!(p.startsWith('"') && p.endsWith('"'))) return p;
  const body = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const n = body[++i];
    const map: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
    if (n in map) bytes.push(map[n]);
    else if (/[0-7]/.test(n)) { bytes.push(parseInt(body.slice(i, i + 3), 8)); i += 2; }
    else bytes.push(n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Split "a/x b/x" (possibly quoted) into [oldPath, newPath] without prefixes. */
function splitGitHeader(rest: string): [string | null, string | null] {
  if (rest.startsWith('"')) {
    const end = findQuoteEnd(rest, 0);
    const a = rest.slice(0, end + 1);
    const b = rest.slice(end + 2);
    return [stripPrefix(unquote(a)), stripPrefix(unquote(b))];
  }
  // Unquoted: the two halves are usually identical ("a/X b/X"); split at the midpoint.
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest[mid] === ' ') {
    const a = rest.slice(0, mid);
    const b = rest.slice(mid + 1);
    if (a.slice(2) === b.slice(2)) return [stripPrefix(a), stripPrefix(b)];
  }
  const idx = rest.indexOf(' b/');
  if (idx >= 0) return [stripPrefix(rest.slice(0, idx)), stripPrefix(unquote(rest.slice(idx + 1)))];
  return [null, null];
}

function findQuoteEnd(s: string, start: number): number {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '"') return i;
  }
  return s.length - 1;
}

/** Build a synthetic "added file" diff from full file content (used for untracked files). */
export function addedFileDiff(path: string, content: string): FileDiff {
  const text = content.endsWith('\n') ? content.slice(0, -1) : content;
  const rows = text.length ? text.split('\n') : [];
  return {
    oldPath: null,
    newPath: path,
    status: 'added',
    binary: false,
    hunks: rows.length
      ? [{
          oldStart: 0, oldLines: 0, newStart: 1, newLines: rows.length, header: '',
          lines: rows.map((t, i) => mk('+', t, undefined, i + 1)),
        }]
      : [],
  };
}

export function filePath(f: FileDiff): string {
  return (f.newPath ?? f.oldPath) as string;
}
