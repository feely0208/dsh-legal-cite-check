#!/bin/bash
# dsh-legal-cite-check · 真行为验证
# 覆盖：失效法条 / 越界条号 / 正常条号不误报 / 案号待核 / --strict / 产物结构
set -uo pipefail
export PATH="/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo ""; echo "  $(node -p "require('./package.json').name") · 引用核验验证"
echo "  ────────────────────────────────────────────────"

TMP=$(mktemp -d) || { echo "无法创建临时目录"; exit 1; }
trap 'rm -rf "$TMP"' EXIT
CLI="bin/cli.mjs"

# 一次核验，落 JSON 供断言复用
node "$CLI" tests/fixtures/case-01.md --out "$TMP/out" --json > "$TMP/r.json" 2>"$TMP/err"
E=$?
[ "$E" = "0" ] && ok "正常核验 exit 0" || { bad "核验失败 exit $E：$(head -3 "$TMP/err")"; cat "$TMP/r.json" | head -5; }

J="$TMP/r.json"
q(){ node -e "
const r=JSON.parse(require('fs').readFileSync('$J','utf8'));
$1
"; }

# 1) 失效法条必须被抓到
q "const h=r.citations.find(x=>x.raw.includes('合同法')&&x.raw.includes('一百零七'));
if(!h||h.status!=='OUTDATED'){console.error('没抓到失效法条',h);process.exit(1)}
if(!h.note.includes('民法典')){console.error('未给出 replaced_by',h.note);process.exit(1)}" \
  && ok "失效法条被抓到（合同法第一百零七条 → OUTDATED / 指向民法典）" || bad "失效法条未被抓到"

# 2) 越界条号必须被抓到
q "const h=r.citations.find(x=>x.raw.includes('第一千三百条'));
if(!h||h.status!=='OUT_OF_RANGE'){console.error('没抓到越界',h);process.exit(1)}
if(!/1260/.test(h.note)){console.error('未写条文总数',h.note);process.exit(1)}" \
  && ok "越界条号被抓到（民法典第1300条 → OUT_OF_RANGE / 共1260条）" || bad "越界条号未被抓到"

# 3) 正常条号不得误报
q "const h=r.citations.find(x=>x.raw.includes('第五百七十七条'));
if(!h){console.error('没抽到正常条号');process.exit(1)}
if(h.status!=='OK'||h.severity!=='ok'){console.error('正常条号被误报',h);process.exit(1)}" \
  && ok "正常条号不误报（民法典第五百七十七条 → OK）" || bad "正常条号被误报"

# 4) 案号只标待核，不标通过
q "const h=r.citations.find(x=>x.kind==='案号');
if(!h||h.status!=='UNVERIFIED'){console.error('案号未标待核',h);process.exit(1)}" \
  && ok "案号标 UNVERIFIED（不假装核过）" || bad "案号处理不正确"

# 5) 汇总口径 + 产物
q "const s=r.summary;
if(s.outdated<1||s.outOfRange<1||s.ok<1){console.error('汇总不对',s);process.exit(1)}
if(s.material!==s.outdated+s.outOfRange){console.error('material 计数不对',s);process.exit(1)}" \
  && ok "汇总口径正确（失效/越界/通过分开计数）" || bad "汇总口径错误"

for f in citations.csv citations.md; do
  [ -s "$TMP/out/$f" ] && ok "生成非空 $f" || bad "缺少 $f"
done
head -c 3 "$TMP/out/citations.csv" | grep -q $'\xef\xbb\xbf' && ok "citations.csv 带 UTF-8 BOM（Excel 可直接开）" || bad "CSV 缺 BOM"
grep -q "索引内「通过」≠「适用」" "$TMP/out/citations.md" && ok "报告保留「通过 ≠ 适用」声明" || bad "报告缺边界声明"
grep -q "必须处理" "$TMP/out/citations.md" && ok "报告列出「必须处理」章节" || bad "报告缺必须处理章节"

# 6) --strict：有 material 时 exit 1；干净文件 exit 0
node "$CLI" tests/fixtures/case-01.md --out "$TMP/s1" --strict >/dev/null 2>&1
[ "$?" = "1" ] && ok "--strict 有必须处理项 → exit 1" || bad "--strict 未返回 1"
printf '依据《民法典》第五百七十七条，被告应承担违约责任。\n' > "$TMP/clean.md"
node "$CLI" "$TMP/clean.md" --out "$TMP/s2" --strict >/dev/null 2>&1
[ "$?" = "0" ] && ok "--strict 干净文书 → exit 0" || bad "--strict 误报（干净文书非 0）"

# 7) --demo + 错误处理
node "$CLI" --demo --out "$TMP/demo" >/dev/null 2>&1
[ -s "$TMP/demo/citations.csv" ] && ok "--demo 用内置样例出结果" || bad "--demo 失败"
node "$CLI" /nonexistent-xyz.md >/dev/null 2>&1
[ "$?" = "2" ] && ok "路径不存在 → exit 2" || bad "不存在路径应 exit 2"
mkdir -p "$TMP/empty"
node "$CLI" "$TMP/empty" >/dev/null 2>&1
[ "$?" = "2" ] && ok "目录无 .md/.txt → exit 2" || bad "空目录应 exit 2"

echo ""
echo "  ────────────────────────────────────────────────"
echo "  通过 $PASS · 失败 $FAIL"; echo ""
[ "$FAIL" -eq 0 ] || exit 1
