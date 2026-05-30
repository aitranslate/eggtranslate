// 句末标点字符
const TERMINAL_PUNCTUATION = new Set([
  '.', '!', '?', '。', '！', '？', '｡', '．',
  '…', '‥', '‼', '⁇', '⁈', '⁉',
  '؟', '۔', '።', '။', '।', '॥',
]);

// 尾部闭合字符（检测前先剥离）
const TRAILING_CLOSERS = new Set([
  '"', "'", ')', ']', '}', '“', '‘',
  '）', '】', '｝', '〉', '》', '」', '』', '〕', '〗', '〙', '〛',
]);

// 缩写白名单（小写）
const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'mx.', 'dr.', 'prof.', 'rev.', 'hon.', 'fr.',
  'pres.', 'gov.', 'sen.', 'rep.', 'amb.', 'sr.', 'jr.', 'esq.',
  'capt.', 'cmdr.', 'col.', 'gen.', 'lt.', 'maj.', 'sgt.', 'adm.',
  'st.', 'mt.', 'ave.', 'blvd.', 'rd.', 'ln.', 'ct.', 'pl.', 'no.',
  'vs.', 'etc.', 'al.', 'cf.', 'fig.', 'figs.', 'ed.', 'eds.',
  'vol.', 'vols.', 'ch.', 'pp.', 'dept.', 'univ.', 'assn.', 'assoc.',
  'e.g.', 'i.e.', 'a.m.', 'p.m.',
  'u.s.', 'u.k.', 'u.n.', 'e.u.', 'd.c.', 'n.y.', 'n.y.c.', 'l.a.',
  'inc.', 'ltd.', 'co.', 'corp.', 'bros.', 'llc.', 'plc.',
  'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.',
]);

export function shouldSplitAfterTerminal(wordText: string): boolean {
  // 剥离尾部闭合字符
  let stripped = wordText;
  while (stripped.length > 0 && TRAILING_CLOSERS.has(stripped[stripped.length - 1])) {
    stripped = stripped.slice(0, -1);
  }

  if (stripped.length === 0) return false;

  const lastChar = stripped[stripped.length - 1];
  if (!TERMINAL_PUNCTUATION.has(lastChar)) return false;

  // 排除缩写
  const lower = stripped.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return false;

  // 排除单字母首字母（A.）
  if (stripped.length === 2 && /^[a-zA-Z]\.$/.test(stripped)) return false;

  // 排除多点缩写（Ph.D. U.S.A.）
  const dotCount = (stripped.match(/\./g) || []).length;
  if (dotCount >= 2) {
    const parts = stripped.split('.');
    if (parts.every(p => p.length <= 3 && /^[a-zA-Z]*$/.test(p))) return false;
  }

  // 排除小数（3.14）
  if (/^\d+\.\d+$/.test(stripped)) return false;

  return true;
}
