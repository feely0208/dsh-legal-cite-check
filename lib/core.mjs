/**
 * dsh-legal-cite-check · 引用核验引擎（纯 Node，零外部依赖）
 *
 * 只做机器能核验的事：
 *   《法名》第 N 条   → 失效对照 / 条号越界 / 条文重排 / 未生效 / 未收录
 *   法释〔年〕N 号    → 是否被新解释取代
 *   案号              → 只识别格式，一律「需人工核验」
 *
 * 原则：只对自己索引里的事实负责。查不到说查不到，绝不把「没查到」标成「通过」。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');
const INDEX_FILE = join(DATA, 'statutes-index.json');
const CURATED_FILE = join(DATA, 'statutes.json');

const TEXT_EXT = new Set(['.md', '.txt', '.markdown', '.text', '.docx', '.pdf']);
import { readText } from './readtext.mjs';
const MAX_ARTICLE = 5000; // 全量索引里个别条数是内部编码（如 408001），超过这个值视为不可用

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS = { 十: 10, 百: 100, 千: 1000 };
const NUM_CHARS = '0-9一二三四五六七八九十百千零〇两';

/** 中文 / 阿拉伯数字条号 → 整数；无法解析返回 null */
export function cnToInt(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  let section = 0;
  let num = 0;
  for (const ch of s) {
    if (ch in CN_DIGITS) num = CN_DIGITS[ch];
    else if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch];
      if (num === 0) num = 1;
      section += num * unit;
      num = 0;
    } else return null;
  }
  const total = section + num;
  return total || null;
}

/** 法名归一化：去空白、全称前缀、最高院「关于」前缀 */
export function normName(name) {
  return String(name ?? '')
    .trim()
    .replace(/[\s\u3000]/g, '')
    .replace(/〈/g, '《')
    .replace(/〉/g, '》')
    .replace(/^中华人民共和国/, '')
    .replace(/^最高(?:人民)?(?:法院|人民检察院)关于/, '')
    .replace(/^关于/, '');
}

const RE_CITE = new RegExp(`《([^》\\n]{2,80})》\\s*第\\s*([${NUM_CHARS}]{1,8})\\s*条`, 'g');
const RE_BARE = new RegExp(`第\\s*([${NUM_CHARS}]{1,8})\\s*条`, 'g');
const RE_LAWNAME = /《([^》\n]{2,80})》/g;
const RE_DOCNO = /法释\s*[〔[(（]\s*(\d{4})\s*[〕\])）]\s*(\d+)\s*号/g;
const RE_CASE = /[（(]\s*(\d{4})\s*[）)]\s*([\u4e00-\u9fa5]{1,8}\d{0,4})\s*(民初|民终|民再|民申|执异|执恢|执保|执|刑初|刑终|刑申|行初|行终|行赔|行申|破申|破|财保)\s*(\d+)\s*号/g;

/** 逐行抽取四类引用（含行内错配保护：裸条号只在同一行续接前一个法名） */
export function extractCitations(text) {
  const items = [];
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const ln = i + 1;
    const covered = [];
    let lineLaw = null;
    for (const m of line.matchAll(RE_CITE)) {
      items.push({
        line: ln, kind: '法条', raw: m[0], name: m[1],
        article: cnToInt(m[2]), start: m.index, end: m.index + m[0].length,
      });
      covered.push([m.index, m.index + m[0].length]);
      lineLaw = m[1];
    }
    for (const m of line.matchAll(RE_BARE)) {
      if (covered.some(([a, b]) => a <= m.index && m.index < b)) continue;
      if (!lineLaw) continue;
      items.push({
        line: ln, kind: '法条(续)', raw: m[0], name: lineLaw,
        article: cnToInt(m[1]), start: m.index, end: m.index + m[0].length,
      });
    }
    for (const m of line.matchAll(RE_DOCNO)) {
      items.push({
        line: ln, kind: '司法解释文号', raw: m[0],
        doc_no: `法释〔${m[1]}〕${m[2]}号`,
        start: m.index, end: m.index + m[0].length,
      });
    }
    for (const m of line.matchAll(RE_CASE)) {
      items.push({ line: ln, kind: '案号', raw: m[0], start: m.index, end: m.index + m[0].length });
    }
  });
  return items;
}

let cachedIndex = null;

/** 载入随包索引：精编对照（失效/重排/别名）+ 全量条文数 */
export function loadIndex() {
  if (cachedIndex) return cachedIndex;
  const curated = JSON.parse(readFileSync(CURATED_FILE, 'utf8'));
  let corpus = { laws: [] };
  try { corpus = JSON.parse(readFileSync(INDEX_FILE, 'utf8')); } catch { /* 全量索引可选 */ }

  const laws = new Map();
  const put = (key, item) => { if (key && !laws.has(key)) laws.set(key, item); };

  for (const item of curated.laws || []) {
    const entry = {
      name: item.name,
      article_count: Number.isFinite(Number(item.article_count)) && Number(item.article_count) > 0
        ? Number(item.article_count) : null,
      status: item.status || 'effective',
      effective_from: item.effective_from || '',
      note: item.note || '',
    };
    put(normName(item.name), entry);
    for (const a of item.aliases || []) put(normName(a), entry);
  }

  for (const item of corpus.laws || []) {
    const title = String(item.title || '').trim();
    const key = normName(title);
    if (!key) continue;
    const raw = Number(item.articleCount);
    const count = Number.isFinite(raw) && raw > 0 && raw <= MAX_ARTICLE ? raw : null;
    const existing = laws.get(key);
    if (existing) {
      // 精编没写条数时，才用全量索引的条数补；有明确条数的以精编为准
      if (!existing.article_count && count) existing.article_count = count;
      if (!existing.effective_from && item.effectiveDate) existing.effective_from = item.effectiveDate;
      if (!existing.status && item.status) existing.status = item.status;
      continue;
    }
    const entry = {
      name: title, article_count: count,
      status: item.status === 'pending' ? 'pending' : 'effective',
      effective_from: item.effectiveDate || '',
    };
    put(key, entry);
  }

  const superseded = new Map();
  for (const item of curated.superseded_laws || []) {
    const entry = {
      name: item.name, replaced_by: item.replaced_by,
      invalid_since: item.invalid_since || '', note: item.note || '',
    };
    for (const k of [item.name, ...(item.aliases || [])]) {
      const key = normName(k);
      if (key && !superseded.has(key)) superseded.set(key, entry);
    }
  }

  const docs = new Map();
  for (const item of curated.superseded_docs || []) {
    docs.set(String(item.doc_no).replace(/\s/g, ''), item);
  }

  const renumbered = new Map();
  for (const item of curated.renumbered_laws || []) renumbered.set(normName(item.name), item);

  cachedIndex = {
    laws, superseded, docs, renumbered,
    checked: curated.checked || '',
    lawCount: corpus.count || (corpus.laws || []).length,
  };
  return cachedIndex;
}

const SEV_ORDER = { material: 0, warn: 1, info: 2, ok: 3 };

/** 就地判定一条引用 */
export function judge(item, idx) {
  if (item.kind === '案号') {
    item.status = 'UNVERIFIED';
    item.severity = 'info';
    item.note = '案号无法离线核验真伪；请在中国裁判文书网或法院系统核对是否存在';
    return item;
  }

  if (item.kind === '司法解释文号') {
    const hit = idx.docs.get(item.doc_no.replace(/\s/g, ''));
    if (hit) {
      item.status = 'OUTDATED';
      item.severity = 'material';
      item.note = `${hit.invalid_since} 起已被 ${hit.replaced_by} 取代，应改引新解释`;
    } else {
      item.status = 'UNVERIFIED';
      item.severity = 'info';
      item.note = '索引未收录该文号；请到最高人民法院官网核对文号与现行有效性';
    }
    return item;
  }

  const key = normName(item.name);
  const old = idx.superseded.get(key);
  if (old) {
    item.status = 'OUTDATED';
    item.severity = 'material';
    item.note = `${old.invalid_since || '已'} 起已被《${old.replaced_by}》取代` +
      (old.note ? '，' + old.note : '');
    return item;
  }

  const law = idx.laws.get(key);
  if (!law) {
    item.status = 'UNKNOWN';
    item.severity = 'warn';
    item.note = '法名不在离线索引内；可能是简称、地方性法规或已失效文件，需人工核验';
    return item;
  }

  const art = item.article;
  const count = law.article_count;
  if (art === 0) {
    item.status = 'OUT_OF_RANGE';
    item.severity = 'material';
    item.note = '条号不可能是 0';
    return item;
  }
  if (art !== null && count && art > count) {
    item.status = 'OUT_OF_RANGE';
    item.severity = 'material';
    item.note = `《${law.name}》共 ${count} 条，第 ${art} 条超出条文总数`;
    return item;
  }
  if (law.status === 'pending') {
    item.status = 'PENDING';
    item.severity = 'warn';
    item.note = '该法已公布但尚未生效（施行日 ' + (law.effective_from || '待核') + '），引用前确认案件适用时点';
    return item;
  }
  const renum = idx.renumbered.get(normName(law.name));
  if (renum) {
    item.status = 'RENUMBERED';
    item.severity = 'warn';
    item.note = renum.note || '条文序号有调整，引用前请核对现行文本';
    return item;
  }
  item.status = 'OK';
  item.severity = 'ok';
  item.note = count
    ? `法名与条号在索引内（共 ${count} 条）`
    : '法名在索引内；该法条数未收录，条号未做越界判断';
  return item;
}

/** 只写了法名、没带条号的失效法律也要提示（例：根据《合同法》……） */
function addBareLawNames(text, items, idx) {
  const anchored = new Set(items.filter((i) => i.kind.startsWith('法条')).map((i) => `${i.line}:${i.start}`));
  String(text).split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(RE_LAWNAME)) {
      if (anchored.has(`${i + 1}:${m.index}`)) continue;
      if (items.some((it) => it.line === i + 1 && it.start === m.index && it.kind !== '法条(续)')) continue;
      const key = normName(m[1]);
      if (!idx.superseded.has(key)) continue;
      items.push({ line: i + 1, kind: '法律名称', raw: m[0], name: m[1], article: null, start: m.index, end: m.index + m[0].length });
    }
  });
}

function collectFiles(root) {
  if (!existsSync(root)) return { error: '路径不存在：' + root };
  const st = statSync(root);
  if (st.isFile()) {
    if (!TEXT_EXT.has(extname(root).toLowerCase())) return { error: '只支持 .docx/.pdf/.md/.txt：' + root };
    return { files: [root] };
  }
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) walk(full);
      else if (TEXT_EXT.has(extname(full).toLowerCase())) files.push(full);
    }
  };
  walk(root);
  return { files };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildCsv(rows) {
  const cols = ['文件', '行号', '类型', '原文', '状态', '级别', '说明'];
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push([r.file, r.line, r.kind, r.raw, r.status, r.severity, r.note].map(csvCell).join(','));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

const STATUS_LABEL = {
  OK: '通过', OUTDATED: '失效', OUT_OF_RANGE: '越界', UNKNOWN: '未收录',
  RENUMBERED: '重排', PENDING: '未生效', UNVERIFIED: '人工核验',
};

export function buildReport(rows, idx, generatedAt) {
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const material = rows.filter((r) => r.severity === 'material');
  const warn = rows.filter((r) => r.severity === 'warn');

  const out = ['# 引用核验报告', ''];
  out.push(`- 核验时间：${generatedAt}`);
  out.push(`- 索引版本：${idx.checked || '未标注'}（离线，不联网）`);
  if (idx.lawCount) out.push(`- 覆盖范围：${idx.lawCount} 部现行/待生效法规（chinese-law-corpus, CC0）`);
  out.push(`- 引用总数：${rows.length}`);
  out.push('', '| 状态 | 数量 |', '|---|---|');
  for (const k of ['OK', 'RENUMBERED', 'OUTDATED', 'OUT_OF_RANGE', 'UNKNOWN', 'UNVERIFIED', 'PENDING']) {
    if (counts[k]) out.push(`| ${k}（${STATUS_LABEL[k]}） | ${counts[k]} |`);
  }
  out.push('');

  if (material.length) {
    out.push('## 一、必须处理（material）', '');
    for (const r of material) out.push(`- **${r.file}:${r.line}** \`${r.raw}\` — ${r.status}：${r.note}`);
    out.push('');
  }
  if (warn.length) {
    out.push('## 二、需要人工核验', '');
    for (const r of warn) out.push(`- ${r.file}:${r.line} \`${r.raw}\` — ${r.status}：${r.note}`);
    out.push('');
  }

  out.push('## 三、逐条明细', '', '| 文件 | 行 | 引用 | 状态 | 说明 |', '|---|---|---|---|---|');
  for (const r of rows) {
    out.push(`| ${r.file} | ${r.line} | \`${r.raw.replace(/\|/g, '\\|')}\` | ${r.status} | ${r.note.replace(/\|/g, '\\|')} |`);
  }
  out.push('');
  out.push('> 本报告只对离线索引负责。索引未收录 ≠ 引用正确；索引内「通过」≠「适用」。');
  out.push('> 正式提交前仍须由承办律师核对国家法律法规数据库（flk.npc.gov.cn）原文。');
  return out.join('\n') + '\n';
}

function nowText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const DEMO_TEXT = `# 民事起诉状（内置样例）

原告：张某。被告：李某。

根据《中华人民共和国合同法》第一百零七条，被告应当承担违约责任。
根据《民法典》第五百七十七条，当事人一方不履行合同义务的，应当承担违约责任。
另参照《民法典》第一千三百条关于诉讼时效的规定（条号故意写错，用于测试越界）。

劳动争议部分：依据《最高人民法院关于审理劳动争议案件适用法律若干问题的解释》法释〔2001〕14号第十三条，
以及《劳动合同法》第八十七条。

类案参考：（2026）浙0302民初1234号民事判决书。
`;

/**
 * 主入口。
 * @param {{input?:string, out?:string, strict?:boolean, demo?:boolean}} opts
 */
export async function run(opts = {}) {
  const idx = loadIndex();
  const demo = opts.demo === true || opts.demo === 'true';
  const raw = String(opts.input || '').trim();
  if (!demo && !raw) return { ok: false, text: '请选择或填写要核验的文书（.docx/.pdf/.md/.txt）' };

  const rows = [];
  let outDir;
  try {
    if (demo) {
      const items = extractCitations(DEMO_TEXT);
      addBareLawNames(DEMO_TEXT, items, idx);
      for (const it of items) {
        judge(it, idx);
        it.file = '样例文书.md';
        rows.push(it);
      }
      outDir = opts.out ? String(opts.out) : join(process.cwd(), '引用核验-样例');
    } else {
      if (!existsSync(raw)) return { ok: false, text: '路径不存在：' + raw };
      const st = statSync(raw);
      const { files, error } = collectFiles(raw);
      if (error) return { ok: false, text: error };
      if (!files.length) return { ok: false, text: '目录里没有可读文书（.docx/.pdf/.md/.txt）：' + raw };
      for (const file of files) {
        let text = '';
        try { text = (await readText(file)) || ''; }
        catch (e) { return { ok: false, text: `读取失败：${file}（${e?.message || e}）` }; }
        const items = extractCitations(text);
        addBareLawNames(text, items, idx);
        for (const it of items) {
          judge(it, idx);
          it.file = basename(file);
          it.path = file;
          rows.push(it);
        }
      }
      outDir = opts.out && String(opts.out).trim()
        ? String(opts.out).trim()
        : join(st.isFile() ? dirname(raw) : raw, '引用核验');
    }
  } catch (e) {
    return { ok: false, text: '核验失败：' + (e?.message || String(e)) };
  }

  rows.sort((a, b) =>
    String(a.file).localeCompare(String(b.file)) ||
    a.line - b.line ||
    (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));

  try { mkdirSync(outDir, { recursive: true }); }
  catch (e) { return { ok: false, text: `无法创建输出目录：${outDir}（${e?.message || e}）` }; }

  const generatedAt = nowText();
  const csvPath = join(outDir, 'citations.csv');
  const mdPath = join(outDir, 'citations.md');
  try {
    writeFileSync(csvPath, buildCsv(rows), 'utf8');
    writeFileSync(mdPath, buildReport(rows, idx, generatedAt), 'utf8');
  } catch (e) {
    return { ok: false, text: `写入结果失败：${e?.message || e}` };
  }

  const count = (s) => rows.filter((r) => r.status === s).length;
  const summary = {
    total: rows.length,
    ok: count('OK'),
    outdated: count('OUTDATED'),
    outOfRange: count('OUT_OF_RANGE'),
    pending: count('PENDING') + count('UNKNOWN') + count('UNVERIFIED') + count('RENUMBERED'),
    material: rows.filter((r) => r.severity === 'material').length,
    warn: rows.filter((r) => r.severity === 'warn').length,
  };
  const issues = rows.filter((r) => r.severity !== 'ok').slice(0, 20).map((r) => ({
    file: r.file, line: r.line, raw: r.raw, status: r.status, note: r.note,
  }));

  const lines = [];
  lines.push(`引用核验：共 ${summary.total} 处引用 → ${outDir}`);
  lines.push(`  通过 ${summary.ok} · 失效 ${summary.outdated} · 越界 ${summary.outOfRange} · 待核验 ${summary.pending}`);
  lines.push(`  必须处理 ${summary.material} 处；需人工核验 ${summary.warn} 处`);
  const material = rows.filter((r) => r.severity === 'material');
  for (const r of material.slice(0, 10)) {
    lines.push(`  ✗ ${r.file}:${r.line} ${r.raw} — ${r.status}：${r.note}`);
  }
  lines.push('');
  lines.push('产物：citations.csv、citations.md');
  lines.push('说明：只对离线索引负责；索引内通过 ≠ 该条适用于本案，正式提交前须核对官方原文。');

  return {
    ok: true,
    text: lines.join('\n'),
    summary,
    issues,
    outputs: { dir: outDir, csv: csvPath, md: mdPath },
    rows,
    version: idx.checked,
  };
}

/** 供 CLI --json 使用：不把整份 rows 的 note 字段截断，只去掉内部字段 */
export async function runJson(opts) {
  const r = await run(opts);
  if (!r.ok) return r;
  return {
    ok: true,
    summary: r.summary,
    issues: r.issues,
    outputs: r.outputs,
    index: r.version,
    citations: r.rows.map((x) => ({
      file: x.file, line: x.line, kind: x.kind, raw: x.raw,
      name: x.name || '', article: x.article ?? null,
      status: x.status, severity: x.severity, note: x.note,
    })),
  };
}
