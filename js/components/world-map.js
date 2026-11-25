/**
 * 互動世界地圖檢視器 (Padlet Map Format Equivalent)
 * 零外部依賴向量世界地圖（等距圓柱投影），支援縮放、點擊地圖任意處釘選新貼文與釘選點選擇
 */

import { escapeHtml } from '../utils.js';

const MAP_W = 1000;
const MAP_H = 500;

export function latLngToXY(lat, lng) {
  const x = ((Number(lng) + 180) / 360) * MAP_W;
  const y = ((90 - Number(lat)) / 180) * MAP_H;
  return { x, y };
}

export function xyToLatLng(x, y) {
  const lng = (x / MAP_W) * 360 - 180;
  const lat = 90 - (y / MAP_H) * 180;
  return {
    lat: Math.round(Math.max(-85, Math.min(85, lat)) * 1000) / 1000,
    lng: Math.round(Math.max(-180, Math.min(180, lng)) * 1000) / 1000,
  };
}

// Clean stylized vector continents in 1000x500 equirectangular coordinates
const CONTINENT_PATHS = [
  // North America
  'M 65 82 L 135 55 L 220 58 L 285 75 L 312 115 L 280 150 L 245 178 L 225 215 L 200 225 L 178 196 L 145 175 L 112 135 L 70 112 Z',
  // Greenland
  'M 345 32 L 420 26 L 440 58 L 390 88 L 355 72 Z',
  // South America
  'M 245 232 L 295 236 L 348 272 L 368 315 L 335 375 L 298 430 L 278 442 L 266 392 L 250 328 L 236 276 Z',
  // Europe
  'M 465 72 L 535 58 L 600 66 L 615 110 L 575 138 L 530 142 L 495 148 L 468 134 L 458 104 Z',
  // UK / Ireland
  'M 472 95 L 486 92 L 488 112 L 474 114 Z',
  // Africa
  'M 465 162 L 535 155 L 592 175 L 626 226 L 612 288 L 578 358 L 542 385 L 515 352 L 500 285 L 460 245 L 448 200 Z',
  // Madagascar
  'M 618 308 L 632 305 L 628 340 L 614 338 Z',
  // Asia
  'M 595 62 L 735 52 L 875 72 L 920 105 L 878 158 L 850 198 L 818 228 L 785 245 L 748 222 L 716 242 L 690 208 L 650 218 L 615 182 L 592 145 Z',
  // Japan
  'M 875 138 L 896 128 L 898 158 L 882 172 L 872 162 Z',
  // Taiwan
  'M 836 176 L 842 176 L 840 186 L 835 185 Z',
  // Southeast Asia / Indonesia
  'M 785 248 L 832 252 L 856 268 L 812 272 L 778 262 Z',
  // Australia
  'M 792 315 L 866 306 L 908 338 L 898 386 L 848 398 L 795 376 L 782 344 Z',
  // New Zealand
  'M 936 392 L 952 384 L 948 414 L 932 418 Z',
];

export function renderMapLayout({ container, posts, selectedPostId, onSelectPost, onClickMap, renderCardHtml }) {
  const pinnedPosts = posts.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');

  const pinsSvg = pinnedPosts
    .map((p) => {
      const { x, y } = latLngToXY(p.lat, p.lng);
      const isSelected = p.id === selectedPostId;
      const r = isSelected ? 11 : 8;
      const fill = isSelected ? '#1c1917' : '#d44d30';
      return `
        <g class="map-pin-marker" data-map-pin="${escapeHtml(p.id)}" transform="translate(${x.toFixed(1)}, ${y.toFixed(1)})">
          <circle r="${r + 5}" fill="${fill}" opacity="0.22"></circle>
          <circle r="${r}" fill="${fill}" stroke="#ffffff" stroke-width="2.2"></circle>
          <title>${escapeHtml(p.title || p.locationName || '貼文')}</title>
        </g>
      `;
    })
    .join('');

  const gridLines = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    const { y } = latLngToXY(lat, 0);
    gridLines.push(`<line x1="0" y1="${y}" x2="${MAP_W}" y2="${y}" stroke="rgba(28,25,23,0.08)" stroke-dasharray="4 4"/>`);
  }
  for (let lng = -150; lng <= 150; lng += 30) {
    const { x } = latLngToXY(0, lng);
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${MAP_H}" stroke="rgba(28,25,23,0.08)" stroke-dasharray="4 4"/>`);
  }

  container.innerHTML = `
    <div class="layout-map-container">
      <div class="map-viewport">
        <div class="map-toolbar">
          <div class="map-chip">🗺️ 點擊地圖任意位置即可釘選新貼文（共 ${pinnedPosts.length} 個地標）</div>
          <div style="display:flex;gap:4px">
            <button type="button" class="btn btn-sm" data-map-zoom="in" title="放大">＋</button>
            <button type="button" class="btn btn-sm" data-map-zoom="out" title="縮小">－</button>
            <button type="button" class="btn btn-sm" data-map-zoom="reset" title="重設視角">重設</button>
          </div>
        </div>
        <svg class="map-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet" data-map-svg>
          <rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="#cfe0ea"></rect>
          <g data-map-viewport-group>
            ${gridLines.join('')}
            ${CONTINENT_PATHS.map((d) => `<path d="${d}" fill="#ece7db" stroke="#b9b09f" stroke-width="1.3" stroke-linejoin="round"/>`).join('')}
            ${pinsSvg}
          </g>
        </svg>
      </div>
      <div class="map-sidebar" data-map-sidebar>
        ${
          posts.length
            ? posts
                .map((p) => {
                  const highlight = p.id === selectedPostId ? 'style="outline:2px solid var(--accent);border-radius:14px"' : '';
                  return `<div ${highlight} data-map-card-wrap="${escapeHtml(p.id)}">${renderCardHtml(p)}</div>`;
                })
                .join('')
            : `<div class="empty-state"><div class="empty-state-icon">📍</div><h3>尚無地圖釘選</h3><p>點擊左側地圖任意地點即可新增打卡貼文！</p></div>`
        }
      </div>
    </div>
  `;

  // Zoom state
  let zoom = 1;
  let cx = MAP_W / 2;
  let cy = MAP_H / 2;
  const svg = container.querySelector('[data-map-svg]');

  const updateViewBox = () => {
    const vw = MAP_W / zoom;
    const vh = MAP_H / zoom;
    const vx = Math.max(0, Math.min(MAP_W - vw, cx - vw / 2));
    const vy = Math.max(0, Math.min(MAP_H - vh, cy - vh / 2));
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  };

  container.querySelectorAll('[data-map-zoom]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.mapZoom;
      if (action === 'in') zoom = Math.min(4, zoom * 1.4);
      if (action === 'out') zoom = Math.max(1, zoom / 1.4);
      if (action === 'reset') {
        zoom = 1;
        cx = MAP_W / 2;
        cy = MAP_H / 2;
      }
      updateViewBox();
    });
  });

  // Pin click
  container.querySelectorAll('[data-map-pin]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = el.dataset.mapPin;
      if (onSelectPost) onSelectPost(postId);
      const cardEl = container.querySelector(`[data-map-card-wrap="${CSS.escape(postId)}"]`);
      cardEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  // Click empty map area to create a post pinned to that lat/lng
  svg.addEventListener('click', (e) => {
    if (e.target.closest('[data-map-pin]')) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const svgPt = pt.matrixTransform(ctm.inverse());
    const coords = xyToLatLng(svgPt.x, svgPt.y);
    if (onClickMap) onClickMap(coords);
  });
}
