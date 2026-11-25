/**
 * 全螢幕簡報放映模式 (Padlet Slideshow Equivalent)
 * 將牆面上的貼文轉為簡報投影片，支援鍵盤 ← → Esc 操作
 */

import { escapeHtml, extractYouTubeId, renderRichText } from '../utils.js';

export function openSlideshow(wall) {
  const slides = (wall.posts || []).filter((p) => p.approved !== false);
  let index = 0;

  const overlay = document.createElement('div');
  overlay.className = 'slideshow-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const renderSlide = () => {
    const hasSlides = slides.length > 0;
    const post = hasSlides ? slides[index] : null;
    let mediaHtml = '';

    if (post?.attachment) {
      const a = post.attachment;
      if (a.type === 'image' && a.dataUrl) {
        mediaHtml = `<img src="${escapeHtml(a.dataUrl)}" alt="${escapeHtml(post.title || '圖片')}">`;
      } else if (a.type === 'link' && a.url) {
        const ytId = extractYouTubeId(a.url);
        if (ytId) {
          mediaHtml = `<div class="post-video-wrap" style="margin:14px 0"><iframe src="https://www.youtube.com/embed/${escapeHtml(ytId)}" allowfullscreen></iframe></div>`;
        } else {
          mediaHtml = `<p><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" style="color:#ff8b6b">🔗 ${escapeHtml(a.title || a.url)}</a></p>`;
        }
      } else if (a.type === 'audio' && a.dataUrl) {
        mediaHtml = `<audio controls src="${escapeHtml(a.dataUrl)}" style="width:100%;margin:14px 0"></audio>`;
      }
    }

    const bodyHtml = post
      ? `
        <div class="slideshow-card">
          <div style="font-size:0.86rem;opacity:0.65;margin-bottom:8px">
            ${wall.showAuthor ? escapeHtml(post.author || '匿名') : '匿名投稿'}
            ${post.dateLabel ? ` · ${escapeHtml(post.dateLabel)}` : ''}
            ${post.locationName ? ` · 📍 ${escapeHtml(post.locationName)}` : ''}
          </div>
          <h2>${escapeHtml(post.title || '(無標題)')}</h2>
          ${mediaHtml}
          <p>${renderRichText(post.body || '', wall.profanityFilter)}</p>
        </div>
      `
      : `<div class="slideshow-card"><h2>${escapeHtml(wall.icon || '🧱')} ${escapeHtml(wall.title)}</h2><p>目前牆上還沒有已核准的貼文可以放映。</p></div>`;

    overlay.innerHTML = `
      <div class="slideshow-header">
        <div style="font-weight:700">${escapeHtml(wall.icon || '🧱')} ${escapeHtml(wall.title)}</div>
        <button type="button" class="btn btn-sm" data-ss-close style="background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.2)">✕ 離開簡報 (Esc)</button>
      </div>
      <div class="slideshow-stage">${bodyHtml}</div>
      <div class="slideshow-footer">
        <button type="button" class="btn btn-sm" data-ss-prev ${index <= 0 ? 'disabled' : ''} style="background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.2)">← 上一張</button>
        <div style="font-size:0.88rem;opacity:0.8">${hasSlides ? `${index + 1} / ${slides.length}` : '0 / 0'}</div>
        <button type="button" class="btn btn-sm" data-ss-next ${index >= slides.length - 1 ? 'disabled' : ''} style="background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.2)">下一張 →</button>
      </div>
    `;

    overlay.querySelector('[data-ss-close]').addEventListener('click', close);
    overlay.querySelector('[data-ss-prev]')?.addEventListener('click', () => {
      if (index > 0) {
        index -= 1;
        renderSlide();
      }
    });
    overlay.querySelector('[data-ss-next]')?.addEventListener('click', () => {
      if (index < slides.length - 1) {
        index += 1;
        renderSlide();
      }
    });
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' || e.key === ' ') {
      if (index < slides.length - 1) {
        index += 1;
        renderSlide();
      }
    }
    if (e.key === 'ArrowLeft') {
      if (index > 0) {
        index -= 1;
        renderSlide();
      }
    }
  };

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  renderSlide();
}
