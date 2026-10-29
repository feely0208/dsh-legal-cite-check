/** 读文本：支持 .md/.txt/.markdown/.docx/.pdf（docx 用 mammoth，pdf 用 unpdf） */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export const READABLE = ['.md', '.txt', '.markdown', '.docx', '.pdf'];

export async function readText(path) {
  const ext = extname(path).toLowerCase();
  try {
    if (['.md', '.txt', '.markdown'].includes(ext)) return readFileSync(path, 'utf8');
    if (ext === '.docx') {
      const mammoth = (await import('mammoth')).default;
      const r = await mammoth.extractRawText({ buffer: readFileSync(path) });
      return r.value || '';
    }
    if (ext === '.pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(readFileSync(path)));
      const r = await extractText(doc, { mergePages: true });
      return String(r.text || '');
    }
  } catch (e) {
    return null;
  }
  return null;
}
