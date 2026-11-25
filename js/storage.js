/**
 * 沒人在乎牆軟體 (No1Care Wall) — 雙模式儲存與即時同步引擎
 *
 * 模式 1 (Server Mode)：偵測到 server.js 運行時，使用 REST API + SSE 多人跨裝置即時協作
 * 模式 2 (Local IndexedDB Mode)：靜態部署或離線開啟時，使用 IndexedDB（支援無限制牆面與大容量多媒體）+ BroadcastChannel 跨分頁即時同步
 */

import { createDefaultWalls } from './constants.js';
import { uid } from './utils.js';

const DB_NAME = 'No1CareWallDB';
const DB_VERSION = 1;
const STORE_NAME = 'walls';
const PROFILE_KEY = 'no1care_author_profile';

export class StorageEngine {
  constructor() {
    this.clientId = uid('client');
    this.mode = 'local'; // 'server' | 'local'
    this.onlineClients = 1;
    this.db = null;
    this.channel = null;
    this.eventSource = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error('[Storage listener error]', err);
      }
    }
  }

  getAuthorName() {
    return localStorage.getItem(PROFILE_KEY) || '沒人在乎的路人';
  }

  setAuthorName(name) {
    const clean = String(name || '').trim() || '沒人在乎的路人';
    localStorage.setItem(PROFILE_KEY, clean);
    return clean;
  }

  async init() {
    await this.openIndexedDB();
    const serverOk = await this.probeServer();
    if (serverOk) {
      this.mode = 'server';
      this.connectSSE();
    } else {
      this.mode = 'local';
      this.connectBroadcastChannel();
    }
    return this.mode;
  }

  async probeServer() {
    if (location.protocol === 'file:') return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1400);
      const res = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = await res.json();
      if (data && data.ok && data.mode === 'server') {
        this.onlineClients = Math.max(1, Number(data.onlineClients || 1));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  openIndexedDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  connectBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel('no1care_realtime_sync');
    this.channel.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.originClientId === this.clientId) return;
      this.emit(msg);
    };
  }

  connectSSE() {
    if (typeof EventSource === 'undefined') return;
    this.eventSource = new EventSource('/api/events');
    this.eventSource.addEventListener('wall_updated', (e) => {
      const data = JSON.parse(e.data);
      if (data.originClientId === this.clientId) return;
      this.emit({ type: 'wall_updated', wall: data.wall });
    });
    this.eventSource.addEventListener('wall_deleted', (e) => {
      const data = JSON.parse(e.data);
      if (data.originClientId === this.clientId) return;
      this.emit({ type: 'wall_deleted', wallId: data.wallId });
    });
    this.eventSource.addEventListener('sync_all', (e) => {
      const data = JSON.parse(e.data);
      if (data.originClientId === this.clientId) return;
      this.emit({ type: 'sync_all' });
    });
    this.eventSource.addEventListener('presence', (e) => {
      const data = JSON.parse(e.data);
      this.onlineClients = Math.max(1, Number(data.onlineClients || 1));
      this.emit({ type: 'presence', onlineClients: this.onlineClients });
    });
  }

  async getAllWalls() {
    if (this.mode === 'server') {
      const res = await fetch('/api/walls', { cache: 'no-store' });
      const data = await res.json();
      let walls = Array.isArray(data.walls) ? data.walls : [];
      if (!walls.length) {
        const defaults = createDefaultWalls();
        await this.importWalls(defaults);
        walls = defaults;
      }
      return walls.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    let walls = await this.idbGetAll();
    if (!walls.length) {
      const seeded = localStorage.getItem('no1care_seeded_v1');
      if (!seeded) {
        const defaults = createDefaultWalls();
        for (const w of defaults) {
          await this.idbPut(w);
        }
        localStorage.setItem('no1care_seeded_v1', '1');
        walls = defaults;
      }
    }
    return walls.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async saveWall(wall) {
    const next = { ...wall, updatedAt: Date.now() };
    if (this.mode === 'server') {
      const res = await fetch(`/api/walls/${encodeURIComponent(next.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': this.clientId,
        },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error('伺服器儲存失敗');
      return next;
    }

    await this.idbPut(next);
    this.channel?.postMessage({
      type: 'wall_updated',
      wall: next,
      originClientId: this.clientId,
    });
    return next;
  }

  async deleteWall(wallId) {
    if (this.mode === 'server') {
      await fetch(`/api/walls/${encodeURIComponent(wallId)}`, {
        method: 'DELETE',
        headers: { 'X-Client-Id': this.clientId },
      });
      return;
    }

    await this.idbDelete(wallId);
    this.channel?.postMessage({
      type: 'wall_deleted',
      wallId,
      originClientId: this.clientId,
    });
  }

  async importWalls(walls) {
    if (this.mode === 'server') {
      await fetch('/api/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': this.clientId,
        },
        body: JSON.stringify({ walls }),
      });
      return;
    }

    for (const w of walls) {
      await this.idbPut(w);
    }
    this.channel?.postMessage({
      type: 'sync_all',
      originClientId: this.clientId,
    });
  }

  /* ---------- IndexedDB Primitives ---------- */

  idbGetAll() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve([]);
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  idbPut(wall) {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(wall);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  idbDelete(id) {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
