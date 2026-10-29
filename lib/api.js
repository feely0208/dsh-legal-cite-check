/** dsh-legal-cite-check · 宿主出口（面板后端） */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { run } from './core.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = '/dsh-legal-cite-check';
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version || ''; }
  catch { return ''; }
})();

const 回 = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};
const 读体 = async (req) => {
  const chunks = [];
  for await (const x of req) chunks.push(x);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
};

export function registerApi(ctx) {
  const handler = async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      if (u.pathname === `${ROUTE}/api/info`) {
        return 回(res, 200, { ok: true, version: VERSION });
      }
      if (u.pathname === `${ROUTE}/api/run` && req.method === 'POST') {
        const body = await 读体(req);
        const r = run({ input: body.input, out: body.out, demo: body.demo });
        // 面板不需要整份 rows，避免响应过大
        const payload = r.ok
          ? { ok: true, text: r.text, summary: r.summary, issues: r.issues, outputs: r.outputs, indexVersion: r.version }
          : { ok: false, text: r.text };
        return 回(res, 200, payload);
      }
      return 回(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      return 回(res, 500, { ok: false, text: e?.message || String(e) });
    }
  };
  ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler });
}
