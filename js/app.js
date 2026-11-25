/**
 * 沒人在乎牆軟體 (No1Care Wall) — 主應用程式控制器
 * 完整實作 Padlet 規格：無限制牆面、7 種即時切換版面、多媒體貼文、互動反應、留言、審核、Remake、簡報與匯出
 */

import {
  CARD_COLORS,
  DEFAULT_EMOJI_ICONS,
  FONT_STYLES,
  LAYOUTS,
  PRESET_LOCATIONS,
  REACTION_MODES,
  WALL_TEMPLATES,
  WALLPAPERS,
} from './constants.js';
import { StorageEngine } from './storage.js';
import {
  applyProfanityFilter,
  compressImageFile,
  escapeHtml,
  exportWallAsCsv,
  exportWallAsJson,
  exportWallAsMarkdown,
  exportWorkspaceAsJson,
  extractYouTubeId,
  formatRelativeTime,
  generateQrSvg,
  getDomain,
  getReactionScore,
  readFileAsDataUrl,
  renderRichText,
  uid,
} from './utils.js';
import { DrawPad } from './components/draw-pad.js';
import { AudioRecorderWidget } from './components/audio-recorder.js';
import { renderMapLayout } from './components/world-map.js';
import { openSlideshow } from './components/slideshow.js';

class No1CareApp {
  constructor() {
    this.storage = new StorageEngine();
    this.walls = [];
    this.activeWallId = null;

    // Dashboard filters
    this.dashFilter = 'all'; // 'all' | 'favorite' | 'archived'
    this.dashSearch = '';

    // Board filters
    this.postSearch = '';
    this.postColorFilter = 'all';
    this.postSort = 'default';
    this.selectedMapPostId = null;
    this.connectingFromId = null;
    this.unlockedWalls = new Set();

    // DOM roots
    this.rootEl = document.getElementById('app-root');
    this.modalRoot = document.getElementById('modal-root');
    this.toastRoot = document.getElementById('toast-root');
    this.syncBadgeEl = document.getElementById('sync-badge');
    this.authorBtnEl = document.getElementById('author-profile-btn');
  }

  async start() {
    await this.storage.init();
    this.walls = await this.storage.getAllWalls();
    this.updateHeaderWidgets();

    // Real-time remote / multi-tab sync handler
    this.storage.onChange(async (evt) => {
      if (evt.type === 'wall_updated' && evt.wall) {
        const idx = this.walls.findIndex((w) => w.id === evt.wall.id);
        if (idx >= 0) this.walls[idx] = evt.wall;
        else this.walls.unshift(evt.wall);
        this.render();
      } else if (evt.type === 'wall_deleted') {
        this.walls = this.walls.filter((w) => w.id !== evt.wallId);
        if (this.activeWallId === evt.wallId) {
          this.navigateDashboard();
        } else {
          this.render();
        }
      } else if (evt.type === 'sync_all') {
        this.walls = await this.storage.getAllWalls();
        this.render();
      } else if (evt.type === 'presence') {
        this.updateHeaderWidgets();
      }
    });

    // Global header bindings
    document.getElementById('brand-home-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateDashboard();
    });

    this.authorBtnEl?.addEventListener('click', () => this.openAuthorModal());
    document.getElementById('header-new-wall-btn')?.addEventListener('click', () => this.openCreateWallModal());
    document.getElementById('header-import-btn')?.addEventListener('click', () => this.triggerImportFile());

    window.addEventListener('hashchange', () => this.syncFromHash());
    this.syncFromHash();
  }

  updateHeaderWidgets() {
    if (this.syncBadgeEl) {
      if (this.storage.mode === 'server') {
        this.syncBadgeEl.innerHTML = `<span class="sync-dot"></span><span>多人即時同步 (${this.storage.onlineClients} 人在線)</span>`;
      } else {
        this.syncBadgeEl.innerHTML = `<span class="sync-dot local"></span><span>本機無限儲存 (跨分頁同步)</span>`;
      }
    }
    if (this.authorBtnEl) {
      this.authorBtnEl.textContent = `👤 ${this.storage.getAuthorName()}`;
    }
  }

  syncFromHash() {
    const hash = location.hash || '#/';
    const match = hash.match(/^#\/wall\/(.+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (this.walls.some((w) => w.id === id)) {
        this.activeWallId = id;
        this.postSearch = '';
        this.postColorFilter = 'all';
        this.postSort = 'default';
        this.connectingFromId = null;
        this.render();
        return;
      }
    }
    this.activeWallId = null;
    this.render();
  }

  navigateDashboard() {
    this.activeWallId = null;
    if (location.hash !== '#/' && location.hash !== '') {
      location.hash = '#/';
    } else {
      this.render();
    }
  }

  navigateWall(wallId) {
    this.activeWallId = wallId;
    location.hash = `#/wall/${encodeURIComponent(wallId)}`;
  }

  getActiveWall() {
    return this.walls.find((w) => w.id === this.activeWallId) || null;
  }

  async persistWall(wall) {
    const saved = await this.storage.saveWall(wall);
    const idx = this.walls.findIndex((w) => w.id === saved.id);
    if (idx >= 0) this.walls[idx] = saved;
    else this.walls.unshift(saved);
    return saved;
  }

  toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    this.toastRoot.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 200ms';
      setTimeout(() => el.remove(), 220);
    }, 2400);
  }

  closeModal() {
    if (this.activeAudioWidget) {
      this.activeAudioWidget.destroy();
      this.activeAudioWidget = null;
    }
    this.modalRoot.innerHTML = '';
  }

  /* ========================================================================
     MAIN RENDER DISPATCH
     ======================================================================== */

  render() {
    const wall = this.getActiveWall();
    if (!wall) {
      document.title = '沒人在乎牆軟體 (No1Care) — 無限制數位協作佈告牆';
      this.renderDashboard();
    } else {
      document.title = `${wall.title} — 沒人在乎牆軟體`;
      this.renderBoard(wall);
    }
  }

  /* ========================================================================
     VIEW 1: UNLIMITED WALLS DASHBOARD
     ======================================================================== */

  renderDashboard() {
    const q = this.dashSearch.trim().toLowerCase();
    const filtered = this.walls.filter((w) => {
      if (this.dashFilter === 'archived') {
        if (!w.archived) return false;
      } else {
        if (w.archived) return false;
        if (this.dashFilter === 'favorite' && !w.favorite) return false;
      }
      if (!q) return true;
      return (
        (w.title || '').toLowerCase().includes(q) ||
        (w.description || '').toLowerCase().includes(q)
      );
    });

    const activeCount = this.walls.filter((w) => !w.archived).length;
    const favCount = this.walls.filter((w) => w.favorite && !w.archived).length;
    const archCount = this.walls.filter((w) => w.archived).length;

    const layoutMap = new Map(LAYOUTS.map((l) => [l.id, l]));

    this.rootEl.innerHTML = `
      <main class="dashboard-container">
        <section class="dashboard-hero">
          <div class="hero-copy">
            <h1>沒人在乎牆工作區</h1>
            <p>把沒人在乎的想法，好好貼在牆上。完整對應 Padlet 7 大佈局與多媒體規格，突破免費版 3 面牆限制，愛開幾面牆就開幾面。</p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <div class="quota-pill" title="無限制建立牆面">
              <span>目前牆面：<strong>${activeCount}</strong></span>
              <span style="opacity:0.35">|</span>
              <span>上限：<span class="quota-infinity">∞ 無限制</span></span>
            </div>
            <button type="button" class="btn" id="dash-export-all-btn">📦 匯出全部備份</button>
            <button type="button" class="btn btn-primary" id="dash-create-wall-btn">＋ 建立新牆面</button>
          </div>
        </section>

        <section class="dashboard-toolbar">
          <div class="filter-tabs" role="tablist">
            <button type="button" class="filter-tab ${this.dashFilter === 'all' ? 'active' : ''}" data-dash-filter="all">全部牆面 (${activeCount})</button>
            <button type="button" class="filter-tab ${this.dashFilter === 'favorite' ? 'active' : ''}" data-dash-filter="favorite">★ 收藏 (${favCount})</button>
            <button type="button" class="filter-tab ${this.dashFilter === 'archived' ? 'active' : ''}" data-dash-filter="archived">封存 (${archCount})</button>
          </div>
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="search" class="input" id="dash-search-input" placeholder="搜尋牆面標題或描述..." value="${escapeHtml(this.dashSearch)}">
          </div>
        </section>

        <section class="wall-grid" aria-label="我的牆面列表">
          ${
            this.dashFilter !== 'archived'
              ? `
                <article class="wall-card wall-card-create" id="card-create-wall" tabindex="0" role="button">
                  <div class="create-plus">＋</div>
                  <div style="font-weight:800;font-size:1.02rem">建立新牆面</div>
                  <div style="font-size:0.82rem;opacity:0.78">磚牆・書架・畫布・時間軸・地圖<br>數量完全無上限</div>
                </article>
              `
              : ''
          }
          ${filtered
            .map((w) => {
              const lay = layoutMap.get(w.layout) || LAYOUTS[0];
              const customStyle = w.customWallpaper
                ? `style="background-image:url('${escapeHtml(w.customWallpaper)}')"`
                : '';
              const coverClass = w.customWallpaper ? '' : escapeHtml(w.wallpaper || 'wp-linen');
              return `
                <article class="wall-card" data-open-wall="${escapeHtml(w.id)}">
                  <div class="wall-card-cover ${coverClass}" ${customStyle}>
                    <div class="wall-card-icon">${escapeHtml(w.icon || '🧱')}</div>
                    <div class="wall-card-badges">
                      ${w.password ? '<span class="mini-badge">🔒 上鎖</span>' : ''}
                      <span class="mini-badge">${lay.icon} ${lay.name}</span>
                    </div>
                  </div>
                  <div class="wall-card-body">
                    <h3 class="wall-card-title">${escapeHtml(w.title || '未命名牆面')}</h3>
                    <p class="wall-card-desc">${escapeHtml(w.description || '這面牆很低調，還沒寫說明。')}</p>
                  </div>
                  <div class="wall-card-footer">
                    <span>${(w.posts || []).length} 則貼文 · ${formatRelativeTime(w.updatedAt)}</span>
                    <div class="wall-card-actions">
                      <button type="button" class="btn btn-ghost btn-icon-sm" data-wall-fav="${escapeHtml(w.id)}" title="${w.favorite ? '取消收藏' : '加入收藏'}">${w.favorite ? '★' : '☆'}</button>
                      <button type="button" class="btn btn-ghost btn-icon-sm" data-wall-remake="${escapeHtml(w.id)}" title="複製重製 (Remake)">⧉</button>
                      <button type="button" class="btn btn-ghost btn-icon-sm" data-wall-archive="${escapeHtml(w.id)}" title="${w.archived ? '取消封存' : '封存'}">📥</button>
                      <button type="button" class="btn btn-ghost btn-icon-sm" data-wall-delete="${escapeHtml(w.id)}" title="刪除牆面">🗑</button>
                    </div>
                  </div>
                </article>
              `;
            })
            .join('')}
        </section>

        <section class="templates-section">
          <div class="section-heading">
            <h2>快速範本（一鍵開新牆）</h2>
            <span class="field-hint">點選即可立刻建立對應版面與預設分區</span>
          </div>
          <div class="template-grid">
            ${WALL_TEMPLATES.map((tpl) => {
              const lay = layoutMap.get(tpl.layout) || LAYOUTS[0];
              return `
                <button type="button" class="template-card" data-use-template="${escapeHtml(tpl.id)}">
                  <div class="template-top">
                    <span>${tpl.icon}</span>
                    <span class="template-layout-tag">${lay.icon} ${lay.name}</span>
                  </div>
                  <div class="template-name">${escapeHtml(tpl.name)}</div>
                  <div class="template-desc">${escapeHtml(tpl.desc)}</div>
                </button>
              `;
            }).join('')}
          </div>
        </section>
      </main>
    `;

    // Bind Dashboard Events
    document.getElementById('dash-create-wall-btn')?.addEventListener('click', () => this.openCreateWallModal());
    document.getElementById('card-create-wall')?.addEventListener('click', () => this.openCreateWallModal());
    document.getElementById('dash-export-all-btn')?.addEventListener('click', () => {
      exportWorkspaceAsJson(this.walls);
      this.toast(`已匯出全部 ${this.walls.length} 面牆的 JSON 備份`);
    });

    this.rootEl.querySelectorAll('[data-dash-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.dashFilter = btn.dataset.dashFilter;
        this.renderDashboard();
      });
    });

    const searchInput = document.getElementById('dash-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.dashSearch = e.target.value;
      this.renderDashboard();
      const el = document.getElementById('dash-search-input');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });

    this.rootEl.querySelectorAll('[data-open-wall]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.navigateWall(card.dataset.openWall);
      });
    });

    this.rootEl.querySelectorAll('[data-wall-fav]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const w = this.walls.find((x) => x.id === btn.dataset.wallFav);
        if (!w) return;
        w.favorite = !w.favorite;
        await this.persistWall(w);
        this.renderDashboard();
      });
    });

    this.rootEl.querySelectorAll('[data-wall-remake]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const w = this.walls.find((x) => x.id === btn.dataset.wallRemake);
        if (w) this.openRemakeModal(w);
      });
    });

    this.rootEl.querySelectorAll('[data-wall-archive]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const w = this.walls.find((x) => x.id === btn.dataset.wallArchive);
        if (!w) return;
        w.archived = !w.archived;
        await this.persistWall(w);
        this.toast(w.archived ? '已將牆面移至封存' : '已還原牆面');
        this.renderDashboard();
      });
    });

    this.rootEl.querySelectorAll('[data-wall-delete]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const w = this.walls.find((x) => x.id === btn.dataset.wallDelete);
        if (!w) return;
        if (!confirm(`確定要永久刪除「${w.title}」嗎？此動作無法復原。`)) return;
        await this.storage.deleteWall(w.id);
        this.walls = this.walls.filter((x) => x.id !== w.id);
        this.toast('牆面已刪除');
        this.renderDashboard();
      });
    });

    this.rootEl.querySelectorAll('[data-use-template]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tpl = WALL_TEMPLATES.find((t) => t.id === btn.dataset.useTemplate);
        if (!tpl) return;
        const wall = this.buildNewWall({
          title: tpl.name,
          description: tpl.desc,
          icon: tpl.icon,
          layout: tpl.layout,
          wallpaper: tpl.wallpaper,
          reactionMode: tpl.reactionMode,
          sections: tpl.sections.map((title) => ({ id: uid('sec'), title })),
        });
        await this.persistWall(wall);
        this.toast(`已用範本建立「${wall.title}」`);
        this.navigateWall(wall.id);
      });
    });
  }

  buildNewWall(overrides = {}) {
    const now = Date.now();
    return {
      id: uid('wall'),
      title: '新的沒人在乎牆',
      description: '隨便貼點什麼，反正沒人在乎。',
      icon: '🧱',
      layout: 'wall',
      wallpaper: 'wp-linen',
      customWallpaper: '',
      fontStyle: 'sans',
      colorScheme: 'light',
      reactionMode: 'like',
      allowComments: true,
      showAuthor: true,
      newPostPosition: 'first',
      requireApproval: false,
      profanityFilter: false,
      accessMode: 'write',
      password: '',
      favorite: false,
      archived: false,
      sections: [
        { id: uid('sec'), title: '主題 A' },
        { id: uid('sec'), title: '主題 B' },
      ],
      links: [],
      posts: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  /* ========================================================================
     VIEW 2: BOARD VIEW (ALL 7 PADLET LAYOUTS)
     ======================================================================== */

  renderBoard(wall) {
    // Password protection check
    if (wall.password && !this.unlockedWalls.has(wall.id)) {
      this.renderLockScreen(wall);
      return;
    }

    const wpClass = wall.customWallpaper ? '' : escapeHtml(wall.wallpaper || 'wp-linen');
    const customBg = wall.customWallpaper
      ? `style="background-image:url('${escapeHtml(wall.customWallpaper)}')"`
      : '';
    const schemeClass = wall.colorScheme === 'dark' ? 'board-scheme-dark' : 'board-scheme-light';
    const fontClass = `board-font-${escapeHtml(wall.fontStyle || 'sans')}`;

    const allPosts = wall.posts || [];
    const pendingPosts = allPosts.filter((p) => p.approved === false);
    const filteredPosts = this.getFilteredPosts(wall);

    const canWrite = wall.accessMode !== 'read';

    this.rootEl.innerHTML = `
      <div class="board-shell ${wpClass} ${schemeClass} ${fontClass}" ${customBg}>
        <header class="board-topbar">
          <div class="board-meta">
            <button type="button" class="btn btn-sm" id="board-back-btn" title="回到全部牆面">← 所有牆面</button>
            <div class="board-icon-badge">${escapeHtml(wall.icon || '🧱')}</div>
            <div class="board-title-wrap">
              <h1>${escapeHtml(wall.title)}</h1>
              <p>${escapeHtml(wall.description || '')}</p>
            </div>
          </div>
          <div class="board-controls">
            ${canWrite ? '<button type="button" class="btn btn-primary btn-sm" id="board-add-post-btn">＋ 張貼</button>' : '<span class="mini-badge">👀 唯讀模式</span>'}
            <button type="button" class="btn btn-sm" id="board-slideshow-btn" title="全螢幕簡報播放">▶ 簡報</button>
            <button type="button" class="btn btn-sm" id="board-remake-btn" title="複製這面牆">⧉ Remake</button>
            <button type="button" class="btn btn-sm" id="board-share-btn" title="分享、QR Code 與匯出">↗ 分享 / 匯出</button>
            <button type="button" class="btn btn-sm" id="board-settings-btn" title="牆面設定">⚙ 設定</button>
          </div>
        </header>

        <div class="board-subbar">
          <div class="layout-switcher" role="tablist" aria-label="切換版面格式">
            ${LAYOUTS.map(
              (l) => `
              <button type="button" class="layout-switch-btn ${wall.layout === l.id ? 'active' : ''}" data-switch-layout="${l.id}" title="${escapeHtml(l.desc)}">
                ${l.icon} ${l.name}
              </button>
            `
            ).join('')}
          </div>

          <div class="board-filters">
            <input type="search" class="input" id="post-search-input" placeholder="篩選貼文..." value="${escapeHtml(this.postSearch)}" style="width:165px">
            <select class="select" id="post-color-filter" aria-label="依顏色篩選">
              <option value="all" ${this.postColorFilter === 'all' ? 'selected' : ''}>全部顏色</option>
              ${CARD_COLORS.map((c) => `<option value="${c.id}" ${this.postColorFilter === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
            <select class="select" id="post-sort-select" aria-label="排序方式">
              <option value="default" ${this.postSort === 'default' ? 'selected' : ''}>預設排序</option>
              <option value="newest" ${this.postSort === 'newest' ? 'selected' : ''}>最新發布</option>
              <option value="oldest" ${this.postSort === 'oldest' ? 'selected' : ''}>最早發布</option>
              <option value="reactions" ${this.postSort === 'reactions' ? 'selected' : ''}>最多反應</option>
            </select>
          </div>
        </div>

        ${
          pendingPosts.length > 0
            ? `
              <div class="moderation-banner">
                <span>🛡️ 目前有 <strong>${pendingPosts.length}</strong> 則待審核貼文等待管理員核准。</span>
                <button type="button" class="btn btn-sm btn-primary" id="approve-all-btn">全部核准</button>
              </div>
            `
            : ''
        }

        <main class="board-body" id="board-stage"></main>

        ${canWrite ? '<button type="button" class="fab-add" id="board-fab-add" title="新增貼文 (快捷鍵 N)" aria-label="新增貼文">＋</button>' : ''}
      </div>
    `;

    // Bind Topbar & Subbar
    document.getElementById('board-back-btn')?.addEventListener('click', () => this.navigateDashboard());
    document.getElementById('board-add-post-btn')?.addEventListener('click', () => this.openPostComposer(wall));
    document.getElementById('board-fab-add')?.addEventListener('click', () => this.openPostComposer(wall));
    document.getElementById('board-slideshow-btn')?.addEventListener('click', () => openSlideshow(wall));
    document.getElementById('board-remake-btn')?.addEventListener('click', () => this.openRemakeModal(wall));
    document.getElementById('board-share-btn')?.addEventListener('click', () => this.openShareExportModal(wall));
    document.getElementById('board-settings-btn')?.addEventListener('click', () => this.openSettingsDrawer(wall));

    document.getElementById('approve-all-btn')?.addEventListener('click', async () => {
      wall.posts.forEach((p) => {
        p.approved = true;
      });
      await this.persistWall(wall);
      this.toast('已核准全部待審貼文');
      this.renderBoard(wall);
    });

    this.rootEl.querySelectorAll('[data-switch-layout]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        wall.layout = btn.dataset.switchLayout;
        if (wall.layout === 'shelf' && (!wall.sections || !wall.sections.length)) {
          wall.sections = [
            { id: uid('sec'), title: '分區 1' },
            { id: uid('sec'), title: '分區 2' },
          ];
        }
        this.connectingFromId = null;
        await this.persistWall(wall);
        this.renderBoard(wall);
      });
    });

    const searchEl = document.getElementById('post-search-input');
    searchEl?.addEventListener('input', (e) => {
      this.postSearch = e.target.value;
      this.renderBoardStage(wall, this.getFilteredPosts(wall));
    });

    document.getElementById('post-color-filter')?.addEventListener('change', (e) => {
      this.postColorFilter = e.target.value;
      this.renderBoardStage(wall, this.getFilteredPosts(wall));
    });

    document.getElementById('post-sort-select')?.addEventListener('change', (e) => {
      this.postSort = e.target.value;
      this.renderBoardStage(wall, this.getFilteredPosts(wall));
    });

    this.renderBoardStage(wall, filteredPosts);
  }

  renderLockScreen(wall) {
    this.rootEl.innerHTML = `
      <main class="dashboard-container">
        <div class="lock-screen">
          <div style="font-size:2.6rem;margin-bottom:8px">🔒</div>
          <h1 style="margin:0 0 6px;font-size:1.35rem">${escapeHtml(wall.title)}</h1>
          <p class="field-hint" style="margin-bottom:18px">此牆面已啟用密碼保護，請輸入通行密碼。</p>
          <form id="unlock-form">
            <div class="field-group">
              <input type="password" class="input" id="unlock-pwd-input" placeholder="輸入密碼..." autofocus required>
            </div>
            <div style="display:flex;gap:8px;justify-content:center">
              <button type="button" class="btn" id="unlock-back-btn">返回</button>
              <button type="submit" class="btn btn-primary">解鎖進入</button>
            </div>
          </form>
        </div>
      </main>
    `;
    document.getElementById('unlock-back-btn')?.addEventListener('click', () => this.navigateDashboard());
    document.getElementById('unlock-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('unlock-pwd-input').value;
      if (val === wall.password) {
        this.unlockedWalls.add(wall.id);
        this.renderBoard(wall);
      } else {
        this.toast('密碼錯誤，請再試一次');
      }
    });
  }

  getFilteredPosts(wall) {
    const q = this.postSearch.trim().toLowerCase();
    let list = [...(wall.posts || [])];

    if (this.postColorFilter !== 'all') {
      list = list.filter((p) => (p.color || 'white') === this.postColorFilter);
    }

    if (q) {
      list = list.filter(
        (p) =>
          (p.title || '').toLowerCase().includes(q) ||
          (p.body || '').toLowerCase().includes(q) ||
          (p.author || '').toLowerCase().includes(q) ||
          (p.locationName || '').toLowerCase().includes(q) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }

    if (this.postSort === 'newest') {
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else if (this.postSort === 'oldest') {
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } else if (this.postSort === 'reactions') {
      list.sort(
        (a, b) =>
          getReactionScore(b, wall.reactionMode) - getReactionScore(a, wall.reactionMode)
      );
    }

    // Pinned posts stay at top in default/sorted lists
    list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return list;
  }

  renderBoardStage(wall, posts) {
    const stage = document.getElementById('board-stage');
    if (!stage) return;

    const layout = wall.layout || 'wall';

    if (!posts.length && layout !== 'shelf' && layout !== 'map') {
      stage.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${escapeHtml(wall.icon || '🧱')}</div>
          <h3>牆面空空如也</h3>
          <p>沒人在乎的第一步：點擊下方按鈕或右下角「＋」貼上第一則便利貼！</p>
          ${wall.accessMode !== 'read' ? '<button type="button" class="btn btn-primary" id="empty-add-btn">＋ 新增第一則貼文</button>' : ''}
        </div>
      `;
      stage.querySelector('#empty-add-btn')?.addEventListener('click', () => this.openPostComposer(wall));
      return;
    }

    switch (layout) {
      case 'wall':
        stage.innerHTML = `<div class="layout-wall">${posts.map((p) => this.renderPostCardHtml(wall, p)).join('')}</div>`;
        this.bindPostCardEvents(stage, wall);
        break;

      case 'grid':
        stage.innerHTML = `<div class="layout-grid">${posts.map((p) => this.renderPostCardHtml(wall, p)).join('')}</div>`;
        this.bindPostCardEvents(stage, wall);
        break;

      case 'stream':
        stage.innerHTML = `<div class="layout-stream">${posts.map((p) => this.renderPostCardHtml(wall, p)).join('')}</div>`;
        this.bindPostCardEvents(stage, wall);
        break;

      case 'shelf':
        this.renderShelfLayout(stage, wall, posts);
        break;

      case 'canvas':
        this.renderCanvasLayout(stage, wall, posts);
        break;

      case 'timeline':
        this.renderTimelineLayout(stage, wall, posts);
        break;

      case 'map':
        renderMapLayout({
          container: stage,
          posts,
          selectedPostId: this.selectedMapPostId,
          onSelectPost: (postId) => {
            this.selectedMapPostId = postId;
            this.renderBoardStage(wall, this.getFilteredPosts(wall));
          },
          onClickMap: (coords) => {
            if (wall.accessMode === 'read') return;
            this.openPostComposer(wall, null, {
              lat: coords.lat,
              lng: coords.lng,
              locationName: `${coords.lat.toFixed(2)}, ${coords.lng.toFixed(2)}`,
            });
          },
          renderCardHtml: (p) => this.renderPostCardHtml(wall, p),
        });
        this.bindPostCardEvents(stage, wall);
        break;
    }
  }

  /* ---------- Layout 2: Shelf / Columns with Cross-column Drag & Drop ---------- */

  renderShelfLayout(stage, wall, posts) {
    const sections = wall.sections && wall.sections.length
      ? wall.sections
      : [{ id: 'sec-default', title: '未分類' }];

    const secIds = new Set(sections.map((s) => s.id));
    const uncategorized = posts.filter((p) => !p.sectionId || !secIds.has(p.sectionId));

    const cols = sections.map((sec, idx) => {
      const colPosts = posts.filter((p) => p.sectionId === sec.id);
      if (idx === 0 && uncategorized.length) {
        colPosts.push(...uncategorized);
      }
      return { sec, colPosts };
    });

    const canWrite = wall.accessMode !== 'read';

    stage.innerHTML = `
      <div class="layout-shelf">
        ${cols
          .map(
            ({ sec, colPosts }) => `
            <section class="shelf-column" data-shelf-col="${escapeHtml(sec.id)}">
              <div class="shelf-col-header">
                <h2 class="shelf-col-title">
                  <span>${escapeHtml(sec.title)}</span>
                  <span class="shelf-count">${colPosts.length}</span>
                </h2>
                ${
                  canWrite
                    ? `<div style="display:flex;gap:2px">
                        <button type="button" class="btn btn-ghost btn-icon-sm" data-sec-rename="${escapeHtml(sec.id)}" title="重新命名分區">✎</button>
                        <button type="button" class="btn btn-ghost btn-icon-sm" data-sec-delete="${escapeHtml(sec.id)}" title="刪除分區">✕</button>
                      </div>`
                    : ''
                }
              </div>
              ${colPosts.map((p) => this.renderPostCardHtml(wall, p, { draggable: canWrite })).join('')}
              ${
                canWrite
                  ? `<button type="button" class="btn btn-sm" data-sec-add-post="${escapeHtml(sec.id)}" style="width:100%">＋ 新增貼文到此欄</button>`
                  : ''
              }
            </section>
          `
          )
          .join('')}
        ${
          canWrite
            ? `<button type="button" class="shelf-add-col" id="shelf-add-sec-btn">＋ 新增分區欄位</button>`
            : ''
        }
      </div>
    `;

    this.bindPostCardEvents(stage, wall);

    // Add / Rename / Delete Section
    stage.querySelector('#shelf-add-sec-btn')?.addEventListener('click', async () => {
      const title = prompt('輸入新分區欄位名稱：', `分區 ${(wall.sections || []).length + 1}`);
      if (!title || !title.trim()) return;
      wall.sections = [...(wall.sections || []), { id: uid('sec'), title: title.trim() }];
      await this.persistWall(wall);
      this.renderBoardStage(wall, this.getFilteredPosts(wall));
    });

    stage.querySelectorAll('[data-sec-add-post]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openPostComposer(wall, null, { sectionId: btn.dataset.secAddPost });
      });
    });

    stage.querySelectorAll('[data-sec-rename]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sec = (wall.sections || []).find((s) => s.id === btn.dataset.secRename);
        if (!sec) return;
        const next = prompt('重新命名分區：', sec.title);
        if (!next || !next.trim()) return;
        sec.title = next.trim();
        await this.persistWall(wall);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    stage.querySelectorAll('[data-sec-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if ((wall.sections || []).length <= 1) {
          this.toast('至少需保留一個分區欄位');
          return;
        }
        if (!confirm('刪除此分區？其貼文將會保留並移至第一欄。')) return;
        wall.sections = wall.sections.filter((s) => s.id !== btn.dataset.secDelete);
        await this.persistWall(wall);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    // HTML5 Drag & Drop across Shelf Columns
    let draggedPostId = null;
    stage.querySelectorAll('.post-card[draggable="true"]').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        draggedPostId = card.dataset.postId;
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.5';
      });
      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
        stage.querySelectorAll('.shelf-column').forEach((c) => c.classList.remove('drag-over'));
      });
    });

    stage.querySelectorAll('.shelf-column').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!draggedPostId) return;
        const post = wall.posts.find((p) => p.id === draggedPostId);
        if (post && post.sectionId !== col.dataset.shelfCol) {
          post.sectionId = col.dataset.shelfCol;
          await this.persistWall(wall);
          this.renderBoardStage(wall, this.getFilteredPosts(wall));
        }
        draggedPostId = null;
      });
    });
  }

  /* ---------- Layout 5: Canvas / Freeform with Dragging + Smart Connecting Lines ---------- */

  renderCanvasLayout(stage, wall, posts) {
    // Ensure coordinates exist for every post
    posts.forEach((p, idx) => {
      if (typeof p.x !== 'number' || typeof p.y !== 'number') {
        p.x = 60 + (idx % 4) * 320;
        p.y = 70 + Math.floor(idx / 4) * 280;
      }
    });

    const maxX = Math.max(1400, ...posts.map((p) => (p.x || 0) + 380));
    const maxY = Math.max(900, ...posts.map((p) => (p.y || 0) + 380));

    stage.innerHTML = `
      <div class="layout-canvas-wrap">
        <div class="canvas-hint-bar">
          ${
            this.connectingFromId
              ? `<span>🔗 連線模式：請點擊另一張卡片完成連線</span>
                 <button type="button" class="btn btn-sm" id="cancel-connect-btn" style="background:rgba(255,255,255,0.16);color:#fff;border:none">取消</button>`
              : `<span>🕸️ 按住卡片任意拖曳排版；點卡片右上角「🔗」建立智慧連線，點擊連線可刪除</span>`
          }
        </div>
        <div class="canvas-stage" id="canvas-stage" style="width:${maxX}px;height:${maxY}px">
          <svg class="canvas-links-svg" id="canvas-links-svg" width="${maxX}" height="${maxY}"></svg>
          ${posts
            .map(
              (p) => `
              <div class="canvas-node ${this.connectingFromId === p.id ? 'connecting-source' : ''}"
                   data-canvas-node="${escapeHtml(p.id)}"
                   style="left:${Math.round(p.x)}px;top:${Math.round(p.y)}px">
                ${this.renderPostCardHtml(wall, p, { showConnect: true })}
              </div>
            `
            )
            .join('')}
        </div>
      </div>
    `;

    this.bindPostCardEvents(stage, wall);
    this.drawCanvasLinks(stage, wall);

    stage.querySelector('#cancel-connect-btn')?.addEventListener('click', () => {
      this.connectingFromId = null;
      this.renderBoardStage(wall, this.getFilteredPosts(wall));
    });

    // Pointer Dragging for Canvas Nodes
    const canvasStage = stage.querySelector('#canvas-stage');
    stage.querySelectorAll('[data-canvas-node]').forEach((node) => {
      const postId = node.dataset.canvasNode;

      node.addEventListener('click', async (e) => {
        if (!this.connectingFromId || this.connectingFromId === postId) return;
        if (e.target.closest('button, input, a, textarea')) return;
        e.stopPropagation();
        const label = prompt('輸入連線標籤（可留空）：', '');
        wall.links = wall.links || [];
        wall.links.push({
          id: uid('lnk'),
          from: this.connectingFromId,
          to: postId,
          label: (label || '').trim(),
        });
        this.connectingFromId = null;
        await this.persistWall(wall);
        this.toast('已建立貼文連線');
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });

      node.addEventListener('pointerdown', (e) => {
        if (wall.accessMode === 'read') return;
        if (e.target.closest('button, input, a, textarea, audio, iframe')) return;
        if (this.connectingFromId) return;

        const post = wall.posts.find((p) => p.id === postId);
        if (!post) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = post.x || 0;
        const origY = post.y || 0;
        let moved = false;

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
          post.x = Math.max(16, Math.round(origX + dx));
          post.y = Math.max(16, Math.round(origY + dy));
          node.style.left = `${post.x}px`;
          node.style.top = `${post.y}px`;
          this.drawCanvasLinks(stage, wall);
        };

        const onUp = async () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (moved) {
            await this.persistWall(wall);
          }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    // Redraw links after images settle
    canvasStage?.querySelectorAll('img').forEach((img) => {
      img.addEventListener('load', () => this.drawCanvasLinks(stage, wall));
    });
  }

  drawCanvasLinks(stage, wall) {
    const svg = stage.querySelector('#canvas-links-svg');
    if (!svg) return;
    const links = wall.links || [];
    const parts = [
      `<defs>
        <marker id="arrow-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#d44d30"></path>
        </marker>
      </defs>`,
    ];

    for (const lnk of links) {
      const fromEl = stage.querySelector(`[data-canvas-node="${CSS.escape(lnk.from)}"]`);
      const toEl = stage.querySelector(`[data-canvas-node="${CSS.escape(lnk.to)}"]`);
      if (!fromEl || !toEl) continue;

      const x1 = fromEl.offsetLeft + fromEl.offsetWidth / 2;
      const y1 = fromEl.offsetTop + fromEl.offsetHeight / 2;
      const x2 = toEl.offsetLeft + toEl.offsetWidth / 2;
      const y2 = toEl.offsetTop + toEl.offsetHeight / 2;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const dx = (x2 - x1) * 0.25;
      const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

      parts.push(`
        <path d="${pathD}" fill="none" stroke="transparent" stroke-width="14" class="link-hit" data-delete-link="${escapeHtml(lnk.id)}">
          <title>點擊刪除此連線</title>
        </path>
        <path d="${pathD}" fill="none" stroke="#d44d30" stroke-width="2.4" stroke-dasharray="6 4" marker-end="url(#arrow-head)"></path>
      `);
      if (lnk.label) {
        parts.push(`
          <rect x="${mx - 42}" y="${my - 12}" width="84" height="22" rx="11" fill="#1c1917" opacity="0.88"></rect>
          <text x="${mx}" y="${my + 3}" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="600">${escapeHtml(lnk.label)}</text>
        `);
      }
    }

    svg.innerHTML = parts.join('');
    svg.querySelectorAll('[data-delete-link]').forEach((el) => {
      el.addEventListener('click', async () => {
        if (!confirm('刪除這條連線？')) return;
        wall.links = (wall.links || []).filter((l) => l.id !== el.dataset.deleteLink);
        await this.persistWall(wall);
        this.drawCanvasLinks(stage, wall);
      });
    });
  }

  /* ---------- Layout 6: Timeline ---------- */

  renderTimelineLayout(stage, wall, posts) {
    const ordered = [...posts].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    stage.innerHTML = `
      <div class="layout-timeline">
        ${ordered
          .map((p, idx) => {
            const label = p.dateLabel || new Date(p.createdAt || Date.now()).toLocaleDateString('zh-TW');
            return `
              <div class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-date-pill">#${idx + 1} · ${escapeHtml(label)}</div>
                ${this.renderPostCardHtml(wall, p)}
              </div>
            `;
          })
          .join('')}
        ${
          wall.accessMode !== 'read'
            ? `
              <div class="timeline-item" style="flex:0 0 220px">
                <div class="timeline-dot" style="background:var(--ink-muted)"></div>
                <button type="button" class="shelf-add-col" id="timeline-add-btn" style="width:100%">＋ 新增時間點</button>
              </div>
            `
            : ''
        }
      </div>
    `;
    this.bindPostCardEvents(stage, wall);
    stage.querySelector('#timeline-add-btn')?.addEventListener('click', () => this.openPostComposer(wall));
  }

  /* ========================================================================
     POST CARD TEMPLATE & INTERACTIONS
     ======================================================================== */

  renderPostCardHtml(wall, post, opts = {}) {
    const colorCls = `color-${escapeHtml(post.color || 'white')}`;
    const pinnedCls = post.pinned ? 'is-pinned' : '';
    const pendingCls = post.approved === false ? 'is-pending' : '';
    const dragAttr = opts.draggable ? 'draggable="true"' : '';
    const canWrite = wall.accessMode !== 'read';

    // Media Attachment HTML
    let mediaHtml = '';
    if (post.attachment) {
      const a = post.attachment;
      if (a.type === 'image' && a.dataUrl) {
        mediaHtml = `<div class="post-media"><img src="${escapeHtml(a.dataUrl)}" alt="${escapeHtml(post.title || '附圖')}" data-zoom-img="${escapeHtml(a.dataUrl)}" loading="lazy"></div>`;
      } else if (a.type === 'audio' && a.dataUrl) {
        mediaHtml = `<audio controls class="post-audio" src="${escapeHtml(a.dataUrl)}"></audio>`;
      } else if (a.type === 'link' && a.url) {
        const ytId = extractYouTubeId(a.url);
        if (ytId) {
          mediaHtml = `
            <div class="post-media">
              <div class="post-video-wrap">
                <iframe src="https://www.youtube.com/embed/${escapeHtml(ytId)}" title="YouTube video" allowfullscreen loading="lazy"></iframe>
              </div>
            </div>
          `;
        } else {
          mediaHtml = `
            <a class="post-link-card" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">
              <span style="font-size:1.3rem">🔗</span>
              <div style="min-width:0">
                <div class="post-link-url">${escapeHtml(a.title || a.url)}</div>
                <div class="post-link-domain">${escapeHtml(getDomain(a.url))}</div>
              </div>
            </a>
          `;
        }
      } else if (a.type === 'file' && a.dataUrl) {
        mediaHtml = `
          <div class="post-file-card">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📎 ${escapeHtml(a.name || '附件檔案')}</span>
            <a class="btn btn-sm" href="${escapeHtml(a.dataUrl)}" download="${escapeHtml(a.name || 'attachment')}">下載</a>
          </div>
        `;
      }
    }

    // Poll HTML
    let pollHtml = '';
    if (post.poll && Array.isArray(post.poll.options) && post.poll.options.length) {
      const totalVotes = post.poll.options.reduce((sum, o) => sum + (o.votes || 0), 0);
      pollHtml = `
        <div class="post-poll">
          <div class="poll-question">📊 ${escapeHtml(applyProfanityFilter(post.poll.question || '快速投票', wall.profanityFilter))}</div>
          ${post.poll.options
            .map((opt) => {
              const pct = totalVotes > 0 ? Math.round(((opt.votes || 0) / totalVotes) * 100) : 0;
              return `
                <button type="button" class="poll-option" data-poll-vote="${escapeHtml(post.id)}:${escapeHtml(opt.id)}">
                  <div class="poll-bar" style="width:${pct}%"></div>
                  <span>${escapeHtml(opt.text)}</span>
                  <span style="font-weight:700">${pct}% (${opt.votes || 0})</span>
                </button>
              `;
            })
            .join('')}
        </div>
      `;
    }

    // Reactions HTML
    const r = post.reactions || {};
    let reactionHtml = '';
    if (wall.reactionMode === 'like') {
      reactionHtml = `
        <button type="button" class="reaction-btn" data-react-like="${escapeHtml(post.id)}" title="按讚">
          ♥ <span>${r.likes || 0}</span>
        </button>
      `;
    } else if (wall.reactionMode === 'vote') {
      const score = (r.up || 0) - (r.down || 0);
      reactionHtml = `
        <div class="reaction-group">
          <button type="button" class="reaction-btn" data-react-vote="${escapeHtml(post.id)}:up" title="贊成">▲ ${r.up || 0}</button>
          <span style="font-size:0.8rem;font-weight:700">${score >= 0 ? `+${score}` : score}</span>
          <button type="button" class="reaction-btn" data-react-vote="${escapeHtml(post.id)}:down" title="反對">▼ ${r.down || 0}</button>
        </div>
      `;
    } else if (wall.reactionMode === 'star') {
      const stars = Array.isArray(r.stars) ? r.stars : [];
      const avg = stars.length ? (stars.reduce((a, b) => a + b, 0) / stars.length).toFixed(1) : '0.0';
      const rounded = Math.round(Number(avg));
      reactionHtml = `
        <div class="star-picker" title="點擊評分 (平均 ${avg} / ${stars.length} 則評分)">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) => `<button type="button" class="star-btn ${n <= rounded ? 'filled' : ''}" data-react-star="${escapeHtml(post.id)}:${n}">★</button>`
            )
            .join('')}
          <span style="font-size:0.76rem;margin-left:3px;opacity:0.8">${avg}</span>
        </div>
      `;
    } else if (wall.reactionMode === 'grade') {
      reactionHtml = `
        <label class="grade-input-wrap">
          分數
          <input type="number" min="0" max="100" class="grade-input" value="${r.grade ?? ''}" placeholder="0-100" data-react-grade="${escapeHtml(post.id)}">
          <span>/ 100</span>
        </label>
      `;
    }

    // Comments HTML
    const comments = post.comments || [];
    const commentsHtml = wall.allowComments
      ? `
        <div class="comments-box">
          ${comments
            .map(
              (c) => `
              <div class="comment-item">
                <div>
                  <span class="comment-author">${escapeHtml(c.author || '路人')}</span>
                  <span>${escapeHtml(applyProfanityFilter(c.text, wall.profanityFilter))}</span>
                </div>
                ${
                  canWrite
                    ? `<button type="button" class="post-action-btn" data-del-comment="${escapeHtml(post.id)}:${escapeHtml(c.id)}" title="刪除留言">✕</button>`
                    : ''
                }
              </div>
            `
            )
            .join('')}
          ${
            canWrite
              ? `
                <form class="comment-form" data-comment-form="${escapeHtml(post.id)}">
                  <input type="text" placeholder="留個言..." required>
                  <button type="submit" class="btn btn-sm">送出</button>
                </form>
              `
              : ''
          }
        </div>
      `
      : '';

    const authorInitial = (post.author || '匿').slice(0, 1);

    return `
      <article class="post-card ${colorCls} ${pinnedCls} ${pendingCls}" data-post-id="${escapeHtml(post.id)}" ${dragAttr}>
        ${
          post.approved === false
            ? `
              <div class="post-pending-bar">
                <span>⏳ 待管理員審核</span>
                <div style="display:flex;gap:4px">
                  <button type="button" class="btn btn-sm btn-primary" data-approve-post="${escapeHtml(post.id)}">核准</button>
                  <button type="button" class="btn btn-sm btn-danger" data-delete-post="${escapeHtml(post.id)}">拒絕</button>
                </div>
              </div>
            `
            : ''
        }

        <div class="post-header">
          <div class="post-author-row">
            ${
              wall.showAuthor
                ? `<span class="post-avatar">${escapeHtml(authorInitial)}</span>
                   <span class="post-author-name">${escapeHtml(post.author || '沒人在乎的路人')}</span>`
                : `<span class="post-author-name">匿名</span>`
            }
            <span class="post-time">· ${formatRelativeTime(post.createdAt)}</span>
          </div>
          ${
            canWrite
              ? `
                <div class="post-menu-btns">
                  ${opts.showConnect ? `<button type="button" class="post-action-btn" data-connect-post="${escapeHtml(post.id)}" title="連線到另一張卡片">🔗</button>` : ''}
                  <button type="button" class="post-action-btn" data-pin-post="${escapeHtml(post.id)}" title="${post.pinned ? '取消置頂' : '置頂貼文'}">${post.pinned ? '📌' : '📍'}</button>
                  <button type="button" class="post-action-btn" data-edit-post="${escapeHtml(post.id)}" title="編輯貼文">✎</button>
                  <button type="button" class="post-action-btn" data-delete-post="${escapeHtml(post.id)}" title="刪除貼文">🗑</button>
                </div>
              `
              : ''
          }
        </div>

        ${post.title ? `<h3 class="post-title">${escapeHtml(applyProfanityFilter(post.title, wall.profanityFilter))}</h3>` : ''}
        ${mediaHtml}
        ${post.body ? `<div class="post-body">${renderRichText(post.body, wall.profanityFilter)}</div>` : ''}
        ${pollHtml}

        ${
          (post.tags && post.tags.length) || post.locationName
            ? `
              <div class="post-meta-tags">
                ${post.locationName ? `<span class="post-tag">📍 ${escapeHtml(post.locationName)}</span>` : ''}
                ${(post.tags || []).map((t) => `<span class="post-tag">#${escapeHtml(t)}</span>`).join('')}
              </div>
            `
            : ''
        }

        ${
          reactionHtml || wall.allowComments
            ? `
              <div class="post-footer">
                <div class="reaction-group">${reactionHtml}</div>
                ${wall.allowComments ? `<span style="font-size:0.76rem;opacity:0.7">💬 ${comments.length}</span>` : ''}
              </div>
            `
            : ''
        }

        ${commentsHtml}
      </article>
    `;
  }

  bindPostCardEvents(container, wall) {
    // Image Lightbox
    container.querySelectorAll('[data-zoom-img]').forEach((img) => {
      img.addEventListener('click', () => {
        this.modalRoot.innerHTML = `
          <div class="modal-backdrop" data-close-modal>
            <img src="${escapeHtml(img.dataset.zoomImg)}" class="lightbox-img" alt="預覽大圖">
          </div>
        `;
        this.modalRoot.querySelector('[data-close-modal]').addEventListener('click', () => this.closeModal());
      });
    });

    // Pin
    container.querySelectorAll('[data-pin-post]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const post = wall.posts.find((p) => p.id === btn.dataset.pinPost);
        if (!post) return;
        post.pinned = !post.pinned;
        await this.persistWall(wall);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    // Connect (Canvas mode)
    container.querySelectorAll('[data-connect-post]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.connectingFromId = btn.dataset.connectPost;
        this.toast('請點擊要連接的目標卡片');
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    // Edit
    container.querySelectorAll('[data-edit-post]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const post = wall.posts.find((p) => p.id === btn.dataset.editPost);
        if (post) this.openPostComposer(wall, post);
      });
    });

    // Approve pending
    container.querySelectorAll('[data-approve-post]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const post = wall.posts.find((p) => p.id === btn.dataset.approvePost);
        if (!post) return;
        post.approved = true;
        await this.persistWall(wall);
        this.toast('已核准貼文');
        this.renderBoard(wall);
      });
    });

    // Delete post
    container.querySelectorAll('[data-delete-post]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('確定要刪除這則貼文嗎？')) return;
        const pid = btn.dataset.deletePost;
        wall.posts = wall.posts.filter((p) => p.id !== pid);
        wall.links = (wall.links || []).filter((l) => l.from !== pid && l.to !== pid);
        await this.persistWall(wall);
        this.renderBoard(wall);
      });
    });

    // Like reaction
    container.querySelectorAll('[data-react-like]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const post = wall.posts.find((p) => p.id === btn.dataset.reactLike);
        if (!post) return;
        post.reactions = post.reactions || {};
        post.reactions.likes = (post.reactions.likes || 0) + 1;
        await this.persistWall(wall);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    // Up/Down vote reaction
    container.querySelectorAll('[data-react-vote]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const [pid, dir] = btn.dataset.reactVote.split(':');
        const post = wall.posts.find((p) => p.id === pid);
        if (!post) return;
        post.reactions = post.reactions || {};
        if (dir === 'up') post.reactions.up = (post.reactions.up || 0) + 1;
        else post.reactions.down = (post.reactions.down || 0) + 1;
        await this.persistWall(wall);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    // Star rating
    container.querySelectorAll('[data-react-star]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const [pid, num] = btn.dataset.reactStar.split(':');
        const post = wall.posts.find((p) => p.id === pid);
        if (!post) return;
        post.reactions = post.reactions || {};
        post.reactions.stars = Array.isArray(post.reactions.stars) ? post.reactions.stars : [];
        post.reactions.stars.push(Number(num));
        await this.persistWall(wall);
        this.toast(`已評分 ${num} 顆星`);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    // Grade input
    container.querySelectorAll('[data-react-grade]').forEach((input) => {
      input.addEventListener('change', async () => {
        const post = wall.posts.find((p) => p.id === input.dataset.reactGrade);
        if (!post) return;
        const val = Math.max(0, Math.min(100, Number(input.value || 0)));
        post.reactions = post.reactions || {};
        post.reactions.grade = val;
        await this.persistWall(wall);
        this.toast(`已評分 ${val} 分`);
      });
    });

    // Poll vote
    container.querySelectorAll('[data-poll-vote]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const [pid, oid] = btn.dataset.pollVote.split(':');
        const post = wall.posts.find((p) => p.id === pid);
        const opt = post?.poll?.options?.find((o) => o.id === oid);
        if (!opt) return;
        opt.votes = (opt.votes || 0) + 1;
        await this.persistWall(wall);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    // Add comment
    container.querySelectorAll('[data-comment-form]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const post = wall.posts.find((p) => p.id === form.dataset.commentForm);
        const input = form.querySelector('input');
        const text = (input?.value || '').trim();
        if (!post || !text) return;
        post.comments = post.comments || [];
        post.comments.push({
          id: uid('cmt'),
          author: this.storage.getAuthorName(),
          text,
          createdAt: Date.now(),
        });
        await this.persistWall(wall);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });

    // Delete comment
    container.querySelectorAll('[data-del-comment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const [pid, cid] = btn.dataset.delComment.split(':');
        const post = wall.posts.find((p) => p.id === pid);
        if (!post) return;
        post.comments = (post.comments || []).filter((c) => c.id !== cid);
        await this.persistWall(wall);
        this.renderBoardStage(wall, this.getFilteredPosts(wall));
      });
    });
  }

  /* ========================================================================
     MODAL 1: CREATE NEW UNLIMITED WALL
     ======================================================================== */

  openCreateWallModal() {
    let selectedLayout = 'wall';
    let selectedWallpaper = 'wp-linen';
    let selectedIcon = '🧱';

    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal-dialog modal-lg" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>建立新的沒人在乎牆 (無上限 ∞)</h2>
            <button type="button" class="btn btn-ghost btn-icon-sm" data-close-modal>✕</button>
          </div>
          <form id="create-wall-form">
            <div class="modal-body">
              <div class="field-group">
                <label class="field-label" for="new-wall-title">牆面標題</label>
                <input type="text" id="new-wall-title" class="input" placeholder="例如：沒人在乎的週五腦力激盪牆" required autofocus>
              </div>
              <div class="field-group">
                <label class="field-label" for="new-wall-desc">牆面說明</label>
                <input type="text" id="new-wall-desc" class="input" placeholder="一句話介紹這面牆的用途...">
              </div>
              <div class="field-group">
                <span class="field-label">選擇圖示</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap" id="create-icon-picker">
                  ${DEFAULT_EMOJI_ICONS.map(
                    (ic, i) => `<button type="button" class="btn btn-sm ${i === 0 ? 'btn-primary' : ''}" data-pick-icon="${ic}">${ic}</button>`
                  ).join('')}
                </div>
              </div>
              <div class="field-group">
                <span class="field-label">版面格式（建立後仍可隨時切換）</span>
                <div class="layout-picker">
                  ${LAYOUTS.map(
                    (l, i) => `
                    <button type="button" class="layout-opt ${i === 0 ? 'active' : ''}" data-pick-layout="${l.id}">
                      <span class="layout-opt-icon">${l.icon}</span>
                      <span>${l.name}</span>
                    </button>
                  `
                  ).join('')}
                </div>
              </div>
              <div class="field-group">
                <span class="field-label">精選背景桌布</span>
                <div class="wallpaper-picker">
                  ${WALLPAPERS.map(
                    (wp, i) => `
                    <button type="button" class="wp-swatch ${wp.id} ${i === 0 ? 'active' : ''}" data-pick-wp="${wp.id}">
                      <span>${wp.name}</span>
                    </button>
                  `
                  ).join('')}
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn" data-close-modal>取消</button>
              <button type="submit" class="btn btn-primary">建立並開啟牆面</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.modalRoot.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => this.closeModal());
    });

    this.modalRoot.querySelectorAll('[data-pick-icon]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedIcon = btn.dataset.pickIcon;
        this.modalRoot.querySelectorAll('[data-pick-icon]').forEach((b) => b.classList.remove('btn-primary'));
        btn.classList.add('btn-primary');
      });
    });

    this.modalRoot.querySelectorAll('[data-pick-layout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedLayout = btn.dataset.pickLayout;
        this.modalRoot.querySelectorAll('[data-pick-layout]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    this.modalRoot.querySelectorAll('[data-pick-wp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedWallpaper = btn.dataset.pickWp;
        this.modalRoot.querySelectorAll('[data-pick-wp]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('create-wall-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('new-wall-title').value.trim();
      const description = document.getElementById('new-wall-desc').value.trim();
      if (!title) return;
      const wall = this.buildNewWall({
        title,
        description,
        icon: selectedIcon,
        layout: selectedLayout,
        wallpaper: selectedWallpaper,
      });
      await this.persistWall(wall);
      this.closeModal();
      this.toast(`已建立新牆面「${wall.title}」`);
      this.navigateWall(wall.id);
    });
  }

  /* ========================================================================
     MODAL 2: RICH MULTIMEDIA POST COMPOSER (CREATE / EDIT)
     ======================================================================== */

  openPostComposer(wall, existingPost = null, prefill = {}) {
    const isEdit = Boolean(existingPost);
    let selectedColor = existingPost?.color || 'white';
    let attachType = existingPost?.poll
      ? 'poll'
      : existingPost?.attachment?.type || 'none';
    let attachmentData = existingPost?.attachment ? { ...existingPost.attachment } : null;
    let drawnDataUrl = null;
    let recordedAudioUrl = null;

    const initialLat = existingPost?.lat ?? prefill.lat ?? 25.033;
    const initialLng = existingPost?.lng ?? prefill.lng ?? 121.565;
    const initialLocName = existingPost?.locationName ?? prefill.locationName ?? '';
    const initialSection = existingPost?.sectionId ?? prefill.sectionId ?? (wall.sections?.[0]?.id || '');

    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal-dialog modal-lg" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>${isEdit ? '編輯貼文' : '新增貼文到牆上'}</h2>
            <button type="button" class="btn btn-ghost btn-icon-sm" data-close-modal>✕</button>
          </div>
          <form id="post-composer-form">
            <div class="modal-body">
              <div class="field-group">
                <label class="field-label" for="post-title-input">標題</label>
                <input type="text" id="post-title-input" class="input" placeholder="寫個吸引人（或沒人在乎）的標題..." value="${escapeHtml(existingPost?.title || '')}" autofocus>
              </div>

              <div class="field-group">
                <label class="field-label" for="post-body-input">
                  <span>內容</span>
                  <span class="field-hint">支援 **粗體**、*斜體*、\`程式碼\` 與自動網址連結</span>
                </label>
                <textarea id="post-body-input" class="textarea" placeholder="輸入想法、筆記或討論內容...">${escapeHtml(existingPost?.body || '')}</textarea>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div class="field-group">
                  <span class="field-label">卡片底色</span>
                  <div class="color-dots" id="composer-color-dots">
                    ${CARD_COLORS.map(
                      (c) => `
                      <button type="button" class="color-dot ${selectedColor === c.id ? 'active' : ''}"
                        style="background:${c.hex}" data-post-color="${c.id}" title="${c.name}"></button>
                    `
                    ).join('')}
                  </div>
                </div>

                <div class="field-group">
                  <label class="field-label" for="post-tags-input">標籤（以逗號分隔）</label>
                  <input type="text" id="post-tags-input" class="input" placeholder="靈感, 會議, 廢文" value="${escapeHtml((existingPost?.tags || []).join(', '))}">
                </div>
              </div>

              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
                ${
                  wall.sections && wall.sections.length
                    ? `
                      <div class="field-group">
                        <label class="field-label" for="post-section-select">所屬分區</label>
                        <select id="post-section-select" class="select">
                          ${wall.sections.map((s) => `<option value="${escapeHtml(s.id)}" ${initialSection === s.id ? 'selected' : ''}>${escapeHtml(s.title)}</option>`).join('')}
                        </select>
                      </div>
                    `
                    : ''
                }
                <div class="field-group">
                  <label class="field-label" for="post-date-label">時間軸標籤</label>
                  <input type="text" id="post-date-label" class="input" placeholder="例如：2026 Q4 / Day 1" value="${escapeHtml(existingPost?.dateLabel || '')}">
                </div>
                <div class="field-group">
                  <label class="field-label" for="post-location-preset">地圖釘選地點</label>
                  <select id="post-location-preset" class="select">
                    <option value="">-- 選擇預設城市或維持座標 --</option>
                    ${PRESET_LOCATIONS.map((loc) => `<option value="${loc.lat},${loc.lng},${escapeHtml(loc.name)}" ${initialLocName === loc.name ? 'selected' : ''}>📍 ${escapeHtml(loc.name)}</option>`).join('')}
                  </select>
                </div>
              </div>

              <div class="field-group" style="margin-top:4px">
                <span class="field-label">多媒體附件 / 互動模組</span>
                <div class="attach-tabs" id="attach-tabs">
                  <button type="button" class="attach-tab ${attachType === 'none' ? 'active' : ''}" data-attach-tab="none">無</button>
                  <button type="button" class="attach-tab ${attachType === 'image' ? 'active' : ''}" data-attach-tab="image">🖼️ 圖片</button>
                  <button type="button" class="attach-tab ${attachType === 'link' ? 'active' : ''}" data-attach-tab="link">🔗 連結 / YouTube</button>
                  <button type="button" class="attach-tab ${attachType === 'draw' ? 'active' : ''}" data-attach-tab="draw">🎨 手繪畫板</button>
                  <button type="button" class="attach-tab ${attachType === 'audio' ? 'active' : ''}" data-attach-tab="audio">🎙️ 錄音</button>
                  <button type="button" class="attach-tab ${attachType === 'file' ? 'active' : ''}" data-attach-tab="file">📎 檔案</button>
                  <button type="button" class="attach-tab ${attachType === 'poll' ? 'active' : ''}" data-attach-tab="poll">📊 投票</button>
                </div>
                <div id="attach-panel"></div>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn" data-close-modal>取消</button>
              <button type="submit" class="btn btn-primary">${isEdit ? '儲存變更' : '發布到牆上'}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.modalRoot.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => this.closeModal());
    });

    this.modalRoot.querySelectorAll('[data-post-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedColor = btn.dataset.postColor;
        this.modalRoot.querySelectorAll('[data-post-color]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    const panel = document.getElementById('attach-panel');

    const renderAttachPanel = () => {
      if (this.activeAudioWidget) {
        this.activeAudioWidget.destroy();
        this.activeAudioWidget = null;
      }

      if (attachType === 'none') {
        panel.innerHTML = `<div class="field-hint">不附加媒體，僅張貼純文字卡片。</div>`;
      } else if (attachType === 'image') {
        const previewUrl = attachmentData?.type === 'image' ? attachmentData.dataUrl : '';
        panel.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px">
            <input type="file" id="attach-img-file" accept="image/*" class="input">
            <input type="url" id="attach-img-url" class="input" placeholder="或直接貼上圖片網址 (https://...)" value="${previewUrl.startsWith('http') ? escapeHtml(previewUrl) : ''}">
            <div id="attach-img-preview">${previewUrl ? `<img src="${escapeHtml(previewUrl)}" style="max-height:160px;border-radius:10px">` : ''}</div>
          </div>
        `;
        panel.querySelector('#attach-img-file').addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const dataUrl = await compressImageFile(file);
          attachmentData = { type: 'image', dataUrl };
          panel.querySelector('#attach-img-preview').innerHTML = `<img src="${escapeHtml(dataUrl)}" style="max-height:160px;border-radius:10px">`;
        });
        panel.querySelector('#attach-img-url').addEventListener('input', (e) => {
          const url = e.target.value.trim();
          if (url) {
            attachmentData = { type: 'image', dataUrl: url };
            panel.querySelector('#attach-img-preview').innerHTML = `<img src="${escapeHtml(url)}" style="max-height:160px;border-radius:10px">`;
          }
        });
      } else if (attachType === 'link') {
        panel.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px">
            <input type="url" id="attach-link-url" class="input" placeholder="貼上網頁或 YouTube 影片網址 (https://...)" value="${escapeHtml(attachmentData?.type === 'link' ? attachmentData.url || '' : '')}">
            <input type="text" id="attach-link-title" class="input" placeholder="連結標題（選填）" value="${escapeHtml(attachmentData?.type === 'link' ? attachmentData.title || '' : '')}">
          </div>
        `;
      } else if (attachType === 'draw') {
        new DrawPad(panel, (dataUrl) => {
          drawnDataUrl = dataUrl;
        });
      } else if (attachType === 'audio') {
        this.activeAudioWidget = new AudioRecorderWidget(panel, (dataUrl) => {
          recordedAudioUrl = dataUrl;
        });
      } else if (attachType === 'file') {
        panel.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:6px">
            <input type="file" id="attach-generic-file" class="input">
            <div class="field-hint" id="attach-file-info">${attachmentData?.type === 'file' ? `已選擇：${escapeHtml(attachmentData.name)}` : '支援 PDF、TXT、CSV、文件等（建議小於 4MB）'}</div>
          </div>
        `;
        panel.querySelector('#attach-generic-file').addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 4 * 1024 * 1024) {
            this.toast('檔案超過 4MB 上限');
            e.target.value = '';
            return;
          }
          const dataUrl = await readFileAsDataUrl(file);
          attachmentData = { type: 'file', name: file.name, size: file.size, dataUrl };
          panel.querySelector('#attach-file-info').textContent = `已附加：${file.name} (${Math.round(file.size / 1024)} KB)`;
        });
      } else if (attachType === 'poll') {
        const q = existingPost?.poll?.question || '';
        const opts = existingPost?.poll?.options?.map((o) => o.text) || ['選項 A', '選項 B', '選項 C'];
        panel.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px">
            <input type="text" id="poll-question-input" class="input" placeholder="輸入投票問題..." value="${escapeHtml(q)}">
            <textarea id="poll-options-input" class="textarea" style="min-height:80px" placeholder="每行輸入一個投票選項...">${escapeHtml(opts.join('\n'))}</textarea>
          </div>
        `;
      }
    };

    this.modalRoot.querySelectorAll('[data-attach-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        attachType = tab.dataset.attachTab;
        this.modalRoot.querySelectorAll('[data-attach-tab]').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        renderAttachPanel();
      });
    });

    renderAttachPanel();

    document.getElementById('post-composer-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('post-title-input').value.trim();
      const body = document.getElementById('post-body-input').value.trim();
      const tags = document
        .getElementById('post-tags-input')
        .value.split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const sectionId = document.getElementById('post-section-select')?.value || initialSection;
      const dateLabel = document.getElementById('post-date-label').value.trim();

      let lat = initialLat;
      let lng = initialLng;
      let locationName = initialLocName;
      const locPresetVal = document.getElementById('post-location-preset').value;
      if (locPresetVal) {
        const [pLat, pLng, ...nameParts] = locPresetVal.split(',');
        lat = Number(pLat);
        lng = Number(pLng);
        locationName = nameParts.join(',');
      }

      let finalAttachment = null;
      let finalPoll = null;

      if (attachType === 'image' && attachmentData?.dataUrl) {
        finalAttachment = { type: 'image', dataUrl: attachmentData.dataUrl };
      } else if (attachType === 'link') {
        const url = document.getElementById('attach-link-url')?.value.trim();
        const lTitle = document.getElementById('attach-link-title')?.value.trim();
        if (url) finalAttachment = { type: 'link', url, title: lTitle || url };
      } else if (attachType === 'draw' && drawnDataUrl) {
        finalAttachment = { type: 'image', dataUrl: drawnDataUrl };
      } else if (attachType === 'audio') {
        const url = recordedAudioUrl || (existingPost?.attachment?.type === 'audio' ? existingPost.attachment.dataUrl : null);
        if (url) finalAttachment = { type: 'audio', dataUrl: url };
      } else if (attachType === 'file' && attachmentData?.dataUrl) {
        finalAttachment = attachmentData;
      } else if (attachType === 'poll') {
        const question = document.getElementById('poll-question-input')?.value.trim() || title || '投票';
        const lines = (document.getElementById('poll-options-input')?.value || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (lines.length >= 2) {
          finalPoll = {
            question,
            options: lines.map((text, idx) => ({
              id: existingPost?.poll?.options?.[idx]?.id || uid('opt'),
              text,
              votes: existingPost?.poll?.options?.[idx]?.votes || 0,
            })),
          };
        }
      }

      if (!title && !body && !finalAttachment && !finalPoll) {
        this.toast('請至少輸入標題、內容或附加一個媒體');
        return;
      }

      if (isEdit) {
        Object.assign(existingPost, {
          title,
          body,
          color: selectedColor,
          tags,
          sectionId,
          dateLabel,
          lat,
          lng,
          locationName,
          attachment: finalAttachment,
          poll: finalPoll,
        });
      } else {
        const idx = (wall.posts || []).length;
        const newPost = {
          id: uid('post'),
          title,
          body,
          author: this.storage.getAuthorName(),
          color: selectedColor,
          sectionId,
          pinned: false,
          approved: wall.requireApproval ? false : true,
          tags,
          createdAt: Date.now(),
          dateLabel,
          x: 60 + (idx % 4) * 310,
          y: 80 + Math.floor(idx / 4) * 260,
          lat,
          lng,
          locationName,
          attachment: finalAttachment,
          poll: finalPoll,
          reactions: { likes: 0, likedBy: [], up: 0, down: 0, stars: [], grade: null },
          comments: [],
        };
        wall.posts = wall.posts || [];
        if (wall.newPostPosition === 'last') wall.posts.push(newPost);
        else wall.posts.unshift(newPost);
      }

      await this.persistWall(wall);
      this.closeModal();
      this.toast(isEdit ? '貼文已更新' : wall.requireApproval ? '貼文已送出，等待管理員審核' : '已成功貼上牆面！');
      this.renderBoard(wall);
    });
  }

  /* ========================================================================
     DRAWER: BOARD SETTINGS (PADLET GEAR MENU)
     ======================================================================== */

  openSettingsDrawer(wall) {
    this.modalRoot.innerHTML = `
      <div class="drawer-backdrop" data-close-modal>
        <aside class="drawer-panel" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>⚙ 牆面設定</h2>
            <button type="button" class="btn btn-ghost btn-icon-sm" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <div class="drawer-section">
              <h3 class="drawer-section-title">基本資訊</h3>
              <div class="field-group">
                <label class="field-label" for="set-title">標題</label>
                <input type="text" id="set-title" class="input" value="${escapeHtml(wall.title)}">
              </div>
              <div class="field-group">
                <label class="field-label" for="set-desc">副標題 / 說明</label>
                <textarea id="set-desc" class="textarea" style="min-height:66px">${escapeHtml(wall.description || '')}</textarea>
              </div>
              <div class="field-group">
                <label class="field-label" for="set-icon">圖示 Emoji</label>
                <input type="text" id="set-icon" class="input" value="${escapeHtml(wall.icon || '🧱')}" maxlength="4" style="width:90px">
              </div>
            </div>

            <div class="drawer-section">
              <h3 class="drawer-section-title">外觀與排版</h3>
              <div class="field-group">
                <span class="field-label">背景桌布</span>
                <div class="wallpaper-picker">
                  ${WALLPAPERS.map(
                    (wp) => `
                    <button type="button" class="wp-swatch ${wp.id} ${wall.wallpaper === wp.id && !wall.customWallpaper ? 'active' : ''}" data-set-wp="${wp.id}">
                      <span>${wp.name}</span>
                    </button>
                  `
                  ).join('')}
                </div>
              </div>
              <div class="field-group">
                <label class="field-label" for="set-custom-wp">自訂桌布圖片網址（選填）</label>
                <input type="url" id="set-custom-wp" class="input" placeholder="https://..." value="${escapeHtml(wall.customWallpaper || '')}">
              </div>
              <div class="field-group">
                <label class="field-label" for="set-font">字體風格</label>
                <select id="set-font" class="select">
                  ${FONT_STYLES.map((f) => `<option value="${f.id}" ${wall.fontStyle === f.id ? 'selected' : ''}>${f.name}</option>`).join('')}
                </select>
              </div>
              <div class="field-group">
                <label class="field-label" for="set-scheme">卡片深淺色主題</label>
                <select id="set-scheme" class="select">
                  <option value="light" ${wall.colorScheme !== 'dark' ? 'selected' : ''}>明亮紙感 (Light)</option>
                  <option value="dark" ${wall.colorScheme === 'dark' ? 'selected' : ''}>深色護眼 (Dark)</option>
                </select>
              </div>
            </div>

            <div class="drawer-section">
              <h3 class="drawer-section-title">互動與貼文規則</h3>
              <div class="field-group">
                <label class="field-label" for="set-reaction">反應模式</label>
                <select id="set-reaction" class="select">
                  ${REACTION_MODES.map((m) => `<option value="${m.id}" ${wall.reactionMode === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
                </select>
              </div>
              <div class="field-group">
                <label class="field-label" for="set-pos">新貼文插入位置</label>
                <select id="set-pos" class="select">
                  <option value="first" ${wall.newPostPosition !== 'last' ? 'selected' : ''}>顯示在最前面 (First)</option>
                  <option value="last" ${wall.newPostPosition === 'last' ? 'selected' : ''}>顯示在最後面 (Last)</option>
                </select>
              </div>
              <div class="toggle-row">
                <div><span class="toggle-label">允許留言討論</span></div>
                <label class="switch"><input type="checkbox" id="set-comments" ${wall.allowComments ? 'checked' : ''}><span class="switch-slider"></span></label>
              </div>
              <div class="toggle-row">
                <div><span class="toggle-label">顯示作者名稱</span></div>
                <label class="switch"><input type="checkbox" id="set-author" ${wall.showAuthor ? 'checked' : ''}><span class="switch-slider"></span></label>
              </div>
              <div class="toggle-row">
                <div><span class="toggle-label">開啟發文審核機制</span><span class="toggle-sub">新貼文需經核准後才算正式公開</span></div>
                <label class="switch"><input type="checkbox" id="set-approval" ${wall.requireApproval ? 'checked' : ''}><span class="switch-slider"></span></label>
              </div>
              <div class="toggle-row">
                <div><span class="toggle-label">敏感詞彙過濾</span><span class="toggle-sub">將不雅詞彙自動替換成可愛表情符號</span></div>
                <label class="switch"><input type="checkbox" id="set-profanity" ${wall.profanityFilter ? 'checked' : ''}><span class="switch-slider"></span></label>
              </div>
            </div>

            <div class="drawer-section">
              <h3 class="drawer-section-title">權限與安全</h3>
              <div class="field-group">
                <label class="field-label" for="set-access">訪客權限</label>
                <select id="set-access" class="select">
                  <option value="write" ${wall.accessMode !== 'read' ? 'selected' : ''}>可閱讀與張貼 (Can Write)</option>
                  <option value="read" ${wall.accessMode === 'read' ? 'selected' : ''}>僅供檢視 (Read-only)</option>
                </select>
              </div>
              <div class="field-group">
                <label class="field-label" for="set-password">密碼保護（留空則為公開）</label>
                <input type="text" id="set-password" class="input" placeholder="設定進入密碼..." value="${escapeHtml(wall.password || '')}">
              </div>
            </div>

            <div class="drawer-section">
              <h3 class="drawer-section-title">危險區域</h3>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="btn btn-sm btn-danger" id="set-clear-posts">清空所有貼文</button>
                <button type="button" class="btn btn-sm btn-danger" id="set-delete-wall">永久刪除此牆面</button>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" data-close-modal>關閉</button>
            <button type="button" class="btn btn-primary" id="set-save-btn">儲存設定</button>
          </div>
        </aside>
      </div>
    `;

    let pickedWp = wall.wallpaper || 'wp-linen';

    this.modalRoot.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => this.closeModal());
    });

    this.modalRoot.querySelectorAll('[data-set-wp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        pickedWp = btn.dataset.setWp;
        document.getElementById('set-custom-wp').value = '';
        this.modalRoot.querySelectorAll('[data-set-wp]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('set-save-btn')?.addEventListener('click', async () => {
      wall.title = document.getElementById('set-title').value.trim() || wall.title;
      wall.description = document.getElementById('set-desc').value.trim();
      wall.icon = document.getElementById('set-icon').value.trim() || '🧱';
      wall.wallpaper = pickedWp;
      wall.customWallpaper = document.getElementById('set-custom-wp').value.trim();
      wall.fontStyle = document.getElementById('set-font').value;
      wall.colorScheme = document.getElementById('set-scheme').value;
      wall.reactionMode = document.getElementById('set-reaction').value;
      wall.newPostPosition = document.getElementById('set-pos').value;
      wall.allowComments = document.getElementById('set-comments').checked;
      wall.showAuthor = document.getElementById('set-author').checked;
      wall.requireApproval = document.getElementById('set-approval').checked;
      wall.profanityFilter = document.getElementById('set-profanity').checked;
      wall.accessMode = document.getElementById('set-access').value;
      const newPwd = document.getElementById('set-password').value;
      wall.password = newPwd;
      if (newPwd) this.unlockedWalls.add(wall.id);

      await this.persistWall(wall);
      this.closeModal();
      this.toast('牆面設定已儲存');
      this.renderBoard(wall);
    });

    document.getElementById('set-clear-posts')?.addEventListener('click', async () => {
      if (!confirm('確定要清空這面牆的所有貼文嗎？')) return;
      wall.posts = [];
      wall.links = [];
      await this.persistWall(wall);
      this.closeModal();
      this.toast('已清空所有貼文');
      this.renderBoard(wall);
    });

    document.getElementById('set-delete-wall')?.addEventListener('click', async () => {
      if (!confirm(`確定要永久刪除「${wall.title}」嗎？`)) return;
      await this.storage.deleteWall(wall.id);
      this.walls = this.walls.filter((w) => w.id !== wall.id);
      this.closeModal();
      this.toast('已刪除牆面');
      this.navigateDashboard();
    });
  }

  /* ========================================================================
     MODAL 3: SHARE, QR CODE & MULTI-FORMAT EXPORT
     ======================================================================== */

  openShareExportModal(wall) {
    const shareUrl = `${location.origin}${location.pathname}#/wall/${encodeURIComponent(wall.id)}`;
    const qrSvg = generateQrSvg(shareUrl, 176);

    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal-dialog" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>↗ 分享、QR Code 與匯出</h2>
            <button type="button" class="btn btn-ghost btn-icon-sm" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <div class="field-group">
              <label class="field-label">牆面專屬連結</label>
              <div style="display:flex;gap:8px">
                <input type="text" class="input" id="share-url-input" value="${escapeHtml(shareUrl)}" readonly>
                <button type="button" class="btn btn-primary" id="copy-share-url-btn">複製</button>
              </div>
              <span class="field-hint">
                ${this.storage.mode === 'server' ? '目前處於伺服器模式：同一網路/網址的協作者開啟此連結即可即時同步。' : '目前為本機離線模式：若要跨電腦分享，請點擊下方「匯出 JSON」或使用 npm start 啟動即時協作伺服器。'}
              </span>
            </div>

            <div class="qr-wrap" style="margin-bottom:16px">
              ${qrSvg}
              <span class="field-hint">掃描 QR Code 快速開啟此牆面</span>
            </div>

            <div class="field-group">
              <span class="field-label">匯出格式（同 Padlet 規格）</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <button type="button" class="btn" id="exp-json-btn">📦 匯出 JSON 牆面檔</button>
                <button type="button" class="btn" id="exp-csv-btn">📊 匯出 CSV 試算表</button>
                <button type="button" class="btn" id="exp-md-btn">📝 匯出 Markdown</button>
                <button type="button" class="btn" id="exp-pdf-btn">🖨️ 列印 / 儲存 PDF</button>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-close-modal>完成</button>
          </div>
        </div>
      </div>
    `;

    this.modalRoot.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => this.closeModal());
    });

    document.getElementById('copy-share-url-btn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        this.toast('已複製分享連結');
      } catch {
        document.getElementById('share-url-input').select();
        document.execCommand('copy');
        this.toast('已複製分享連結');
      }
    });

    document.getElementById('exp-json-btn')?.addEventListener('click', () => {
      exportWallAsJson(wall);
      this.toast('已匯出 JSON 檔案');
    });
    document.getElementById('exp-csv-btn')?.addEventListener('click', () => {
      exportWallAsCsv(wall);
      this.toast('已匯出 CSV 試算表');
    });
    document.getElementById('exp-md-btn')?.addEventListener('click', () => {
      exportWallAsMarkdown(wall);
      this.toast('已匯出 Markdown 文件');
    });
    document.getElementById('exp-pdf-btn')?.addEventListener('click', () => {
      this.closeModal();
      setTimeout(() => window.print(), 180);
    });
  }

  /* ========================================================================
     MODAL 4: REMAKE / CLONE WALL
     ======================================================================== */

  openRemakeModal(wall) {
    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal-dialog" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>⧉ 複製重製牆面 (Remake)</h2>
            <button type="button" class="btn btn-ghost btn-icon-sm" data-close-modal>✕</button>
          </div>
          <form id="remake-form">
            <div class="modal-body">
              <div class="field-group">
                <label class="field-label" for="remake-title">新牆面名稱</label>
                <input type="text" id="remake-title" class="input" value="${escapeHtml(wall.title)} (複本)" required autofocus>
              </div>
              <div class="toggle-row">
                <div>
                  <span class="toggle-label">同時複製所有貼文與連線</span>
                  <span class="toggle-sub">關閉時僅複製版面、桌布與分區結構</span>
                </div>
                <label class="switch"><input type="checkbox" id="remake-copy-posts" checked><span class="switch-slider"></span></label>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn" data-close-modal>取消</button>
              <button type="submit" class="btn btn-primary">建立複本</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.modalRoot.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => this.closeModal());
    });

    document.getElementById('remake-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('remake-title').value.trim() || `${wall.title} (複本)`;
      const copyPosts = document.getElementById('remake-copy-posts').checked;
      const clone = JSON.parse(JSON.stringify(wall));
      clone.id = uid('wall');
      clone.title = title;
      clone.createdAt = Date.now();
      clone.updatedAt = Date.now();
      clone.favorite = false;
      clone.archived = false;
      if (!copyPosts) {
        clone.posts = [];
        clone.links = [];
      }
      await this.persistWall(clone);
      this.closeModal();
      this.toast(`已複製建立「${clone.title}」`);
      this.navigateWall(clone.id);
    });
  }

  /* ========================================================================
     MODAL 5: AUTHOR NICKNAME & IMPORT JSON
     ======================================================================== */

  openAuthorModal() {
    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal-dialog" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2>👤 設定你的張貼暱稱</h2>
            <button type="button" class="btn btn-ghost btn-icon-sm" data-close-modal>✕</button>
          </div>
          <form id="author-form">
            <div class="modal-body">
              <div class="field-group">
                <label class="field-label" for="author-name-input">顯示名稱（免註冊帳號即可協作）</label>
                <input type="text" id="author-name-input" class="input" value="${escapeHtml(this.storage.getAuthorName())}" required autofocus>
                <span class="field-hint">發表貼文與留言時會顯示此名稱。</span>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn" data-close-modal>取消</button>
              <button type="submit" class="btn btn-primary">更新暱稱</button>
            </div>
          </form>
        </div>
      </div>
    `;
    this.modalRoot.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => this.closeModal());
    });
    document.getElementById('author-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.storage.setAuthorName(document.getElementById('author-name-input').value);
      this.updateHeaderWidgets();
      this.closeModal();
      this.toast(`已切換暱稱為「${name}」`);
    });
  }

  triggerImportFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const imported = Array.isArray(data.walls) ? data.walls : data.id ? [data] : [];
        if (!imported.length) {
          this.toast('檔案格式不符，找不到牆面資料');
          return;
        }
        const normalized = imported.map((w) => ({
          ...w,
          id: this.walls.some((existing) => existing.id === w.id) ? uid('wall') : w.id || uid('wall'),
          updatedAt: Date.now(),
        }));
        await this.storage.importWalls(normalized);
        this.walls = await this.storage.getAllWalls();
        this.toast(`成功匯入 ${normalized.length} 面牆！`);
        this.render();
      } catch (err) {
        this.toast(`匯入失敗：${err.message}`);
      }
    });
    input.click();
  }
}

const app = new No1CareApp();
app.start();

// Keyboard shortcut: press N inside a board to open composer
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (document.getElementById('modal-root')?.children.length) return;
  const wall = app.getActiveWall();
  if (wall && wall.accessMode !== 'read') {
    e.preventDefault();
    app.openPostComposer(wall);
  }
});
