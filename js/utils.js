/**
 * 沒人在乎牆軟體 (No1Care Wall) — 工具函式庫
 * 包含安全渲染、YouTube 解析、圖片壓縮、敏感詞過濾、多元匯出與零依賴 QR Code 繪製
 */

import { PROFANITY_WORDS } from './constants.js';

export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function applyProfanityFilter(text = '', enabled = false) {
  if (!enabled || !text) return text;
  const emojis = ['🌸', '🌈', '🐱', '✨', '🍀', '🧁'];
  let out = String(text);
  PROFANITY_WORDS.forEach((word, idx) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    out = out.replace(re, emojis[idx % emojis.length].repeat(2));
  });
  return out;
}

/**
 * Safe lightweight Markdown + auto-link formatter
 */
export function renderRichText(raw = '', filterProfanity = false) {
  const clean = applyProfanityFilter(raw, filterProfanity);
  let html = escapeHtml(clean);

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  // URLs -> clickable links
  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return html;
}

export function extractYouTubeId(url = '') {
  if (!url) return null;
  const match = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export function getDomain(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function getReactionScore(post, mode) {
  const r = post.reactions || {};
  switch (mode) {
    case 'like':
      return r.likes || 0;
    case 'vote':
      return (r.up || 0) - (r.down || 0);
    case 'star': {
      const list = Array.isArray(r.stars) ? r.stars : [];
      if (!list.length) return 0;
      return list.reduce((a, b) => a + b, 0) / list.length;
    }
    case 'grade':
      return Number(r.grade || 0);
    default:
      return 0;
  }
}

/**
 * Compress uploaded image file using HTML5 canvas so walls remain lightweight
 */
export function compressImageFile(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取圖片失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(String(reader.result));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportWallAsJson(wall) {
  const safeName = (wall.title || 'no1care-wall').replace(/[\\/:*?"<>|]/g, '_');
  downloadFile(
    `${safeName}.no1care.json`,
    JSON.stringify({ app: 'No1Care', version: 1, exportedAt: new Date().toISOString(), walls: [wall] }, null, 2),
    'application/json;charset=utf-8'
  );
}

export function exportWorkspaceAsJson(walls) {
  downloadFile(
    `no1care-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ app: 'No1Care', version: 1, exportedAt: new Date().toISOString(), walls }, null, 2),
    'application/json;charset=utf-8'
  );
}

export function exportWallAsCsv(wall) {
  const secMap = new Map((wall.sections || []).map((s) => [s.id, s.title]));
  const rows = [
    ['標題', '內文', '作者', '分區', '標籤', '時間標記', '地點', '按讚數', '投票淨值', '平均星等', '評分', '留言數', '建立時間'],
  ];
  for (const p of wall.posts || []) {
    const r = p.reactions || {};
    const avgStar = r.stars && r.stars.length
      ? (r.stars.reduce((a, b) => a + b, 0) / r.stars.length).toFixed(1)
      : '';
    rows.push([
      p.title || '',
      p.body || '',
      p.author || '',
      secMap.get(p.sectionId) || '',
      (p.tags || []).join(', '),
      p.dateLabel || '',
      p.locationName || '',
      r.likes || 0,
      (r.up || 0) - (r.down || 0),
      avgStar,
      r.grade ?? '',
      (p.comments || []).length,
      p.createdAt ? new Date(p.createdAt).toISOString() : '',
    ]);
  }
  const csv = '\uFEFF' + rows
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const safeName = (wall.title || 'no1care-wall').replace(/[\\/:*?"<>|]/g, '_');
  downloadFile(`${safeName}.csv`, csv, 'text/csv;charset=utf-8');
}

export function exportWallAsMarkdown(wall) {
  const secMap = new Map((wall.sections || []).map((s) => [s.id, s.title]));
  const lines = [
    `# ${wall.icon || '🧱'} ${wall.title}`,
    '',
    wall.description ? `> ${wall.description}` : '',
    '',
    `- 版面模式：\`${wall.layout}\``,
    `- 貼文總數：${(wall.posts || []).length}`,
    `- 匯出時間：${new Date().toLocaleString('zh-TW')}`,
    '',
    '---',
    '',
  ];

  for (const p of wall.posts || []) {
    lines.push(`## ${p.title || '(無標題貼文)'}`);
    const meta = [];
    if (p.author) meta.push(`作者：${p.author}`);
    if (secMap.get(p.sectionId)) meta.push(`分區：${secMap.get(p.sectionId)}`);
    if (p.dateLabel) meta.push(`時間：${p.dateLabel}`);
    if (p.locationName) meta.push(`地點：${p.locationName}`);
    if (meta.length) lines.push(`*${meta.join(' ｜ ')}*`, '');
    if (p.body) lines.push(p.body, '');
    if (p.attachment?.url) {
      lines.push(`連結：[${p.attachment.title || p.attachment.url}](${p.attachment.url})`, '');
    }
    if (p.comments && p.comments.length) {
      lines.push('**留言：**');
      for (const c of p.comments) {
        lines.push(`- **${c.author}**：${c.text}`);
      }
      lines.push('');
    }
    lines.push('---', '');
  }

  const safeName = (wall.title || 'no1care-wall').replace(/[\\/:*?"<>|]/g, '_');
  downloadFile(`${safeName}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
}

/**
 * Pure-JS QR Code SVG Generator (ISO/IEC 18004 Byte Mode, Error Correction L, Auto Version 1-10)
 * Produces genuinely scannable QR codes completely offline with zero external requests.
 */
export function generateQrSvg(text, size = 180) {
  try {
    const matrix = encodeQrMatrix(String(text || 'https://github.com/childkuo/no1care'));
    const n = matrix.length;
    const quiet = 4;
    const total = n + quiet * 2;
    let paths = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          paths += `M${c + quiet},${r + quiet}h1v1h-1z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${paths}" fill="#1c1917"/></svg>`;
  } catch {
    return `<div style="padding:16px;font-size:12px;color:#57534e">網址過長，請直接複製上方連結</div>`;
  }
}

/* ---------- Minimal ISO 18004 QR Encoder (EC Level L, Byte Mode, V1-V10) ---------- */

const QR_VERSIONS_L = [
  null,
  { total: 26, data: 19, ecPerBlock: 7, blocks: 1, align: [] },
  { total: 44, data: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
  { total: 70, data: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
  { total: 100, data: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
  { total: 134, data: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
  { total: 172, data: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] },
  { total: 196, data: 156, ecPerBlock: 20, blocks: 2, align: [6, 22, 38] },
  { total: 242, data: 194, ecPerBlock: 24, blocks: 2, align: [6, 24, 42] },
  { total: 292, data: 232, ecPerBlock: 30, blocks: 2, align: [6, 26, 46] },
  { total: 346, data: 274, ecPerBlock: 18, blocks: 4, align: [6, 28, 50] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEc(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (const b of data) {
    const factor = b ^ rem[0];
    for (let i = 0; i < ecCount - 1; i++) rem[i] = rem[i + 1];
    rem[ecCount - 1] = 0;
    for (let i = 0; i < ecCount; i++) {
      rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return Array.from(rem);
}

function encodeQrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  for (; ver <= 10; ver++) {
    const countBits = ver < 10 ? 8 : 16;
    const capBits = QR_VERSIONS_L[ver].data * 8;
    if (4 + countBits + bytes.length * 8 <= capBits) break;
  }
  if (ver > 10) throw new Error('Text too long for QR');

  const spec = QR_VERSIONS_L[ver];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = spec.data * 8;
  const term = Math.min(4, maxBits - bits.length);
  pushBits(0, term);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
    codewords.push(val);
  }
  let padIdx = 0;
  while (codewords.length < spec.data) {
    codewords.push(padIdx % 2 === 0 ? 0xec : 0x11);
    padIdx++;
  }

  // Split into blocks & interleave
  const blockCount = spec.blocks;
  const shortLen = Math.floor(spec.data / blockCount);
  const longCount = spec.data % blockCount;
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let b = 0; b < blockCount; b++) {
    const len = shortLen + (b >= blockCount - longCount ? 1 : 0);
    const slice = codewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(slice);
    ecBlocks.push(rsComputeEc(slice, spec.ecPerBlock));
  }

  const finalBytes = [];
  const maxDataLen = shortLen + (longCount > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) if (i < blk.length) finalBytes.push(blk[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const blk of ecBlocks) finalBytes.push(blk[i]);
  }

  const n = ver * 4 + 17;
  const mat = Array.from({ length: n }, () => new Uint8Array(n));
  const reserved = Array.from({ length: n }, () => new Uint8Array(n));

  const setMod = (r, c, val, isFunc = true) => {
    if (r >= 0 && r < n && c >= 0 && c < n) {
      mat[r][c] = val ? 1 : 0;
      if (isFunc) reserved[r][c] = 1;
    }
  };

  // Finder patterns + separators
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const inBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        const inBox = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        setMod(r, c, inBox && (inBorder || inCore), true);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, n - 7);
  drawFinder(n - 7, 0);

  // Alignment patterns
  const align = spec.align;
  for (const r of align) {
    for (const c of align) {
      if (reserved[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const d = Math.max(Math.abs(dr), Math.abs(dc));
          setMod(r + dr, c + dc, d !== 1, true);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    if (!reserved[6][i]) setMod(6, i, i % 2 === 0, true);
    if (!reserved[i][6]) setMod(i, 6, i % 2 === 0, true);
  }

  // Dark module & reserve format info
  setMod(n - 8, 8, 1, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
  }
  for (let i = n - 8; i < n; i++) {
    reserved[8][i] = 1;
    reserved[i][8] = 1;
  }

  // Version info for V7+
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const vBits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (vBits >> i) & 1;
      const r = Math.floor(i / 3);
      const c = n - 11 + (i % 3);
      setMod(r, c, bit, true);
      setMod(c, r, bit, true);
    }
  }

  // Place data bits (mask 0: (r + c) % 2 === 0)
  const bitStream = [];
  for (const b of finalBytes) {
    for (let i = 7; i >= 0; i--) bitStream.push((b >> i) & 1);
  }
  let bi = 0;
  let up = true;
  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[r][c]) {
          const bit = bi < bitStream.length ? bitStream[bi++] : 0;
          const masked = (r + c) % 2 === 0 ? bit ^ 1 : bit;
          mat[r][c] = masked;
        }
      }
    }
    up = !up;
  }

  // Write format info for EC=L (01) and Mask=0 (000) => 5-bit data = 01000 => 15-bit BCH = 0x77c4
  const fmt = 0x77c4;
  for (let i = 0; i <= 5; i++) mat[8][i] = (fmt >> (14 - i)) & 1;
  mat[8][7] = (fmt >> 8) & 1;
  mat[8][8] = (fmt >> 7) & 1;
  mat[7][8] = (fmt >> 6) & 1;
  for (let i = 9; i < 15; i++) mat[14 - i][8] = (fmt >> (14 - i)) & 1;
  for (let i = 0; i < 8; i++) mat[8][n - 1 - i] = (fmt >> i) & 1;
  for (let i = 8; i < 15; i++) mat[n - 15 + i][8] = (fmt >> i) & 1;

  return mat;
}
