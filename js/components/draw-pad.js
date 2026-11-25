/**
 * 內建手繪塗鴉板 (Padlet Drawing Attachment Equivalent)
 * 支援滑鼠與觸控繪圖、多色畫筆、橡皮擦、粗細調整、復原與清空
 */

export class DrawPad {
  constructor(container, onUpdate) {
    this.container = container;
    this.onUpdate = onUpdate;
    this.color = '#1c1917';
    this.size = 4;
    this.erasing = false;
    this.drawing = false;
    this.history = [];
    this.hasDrawn = false;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="draw-pad-box">
        <div class="draw-toolbar">
          <div class="color-dots" data-draw-colors>
            ${['#1c1917', '#d44d30', '#2f7d58', '#2563eb', '#d97706', '#9333ea']
              .map(
                (hex, i) => `
              <button type="button" class="color-dot ${i === 0 ? 'active' : ''}"
                style="background:${hex};width:22px;height:22px"
                data-pen-color="${hex}" aria-label="筆色 ${hex}"></button>`
              )
              .join('')}
          </div>
          <label style="font-size:0.78rem;display:flex;align-items:center;gap:4px">
            粗細
            <input type="range" min="2" max="18" value="4" data-pen-size style="width:72px">
          </label>
          <button type="button" class="btn btn-sm" data-draw-eraser>橡皮擦</button>
          <button type="button" class="btn btn-sm" data-draw-undo>復原</button>
          <button type="button" class="btn btn-sm" data-draw-clear>清空</button>
        </div>
        <canvas class="draw-canvas" width="520" height="240"></canvas>
      </div>
    `;

    this.canvas = this.container.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fillWhite();
    this.pushHistory();
    this.bindEvents();
  }

  fillWhite() {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  pushHistory() {
    if (this.history.length > 20) this.history.shift();
    this.history.push(this.canvas.toDataURL('image/png'));
  }

  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  bindEvents() {
    const colorBtns = this.container.querySelectorAll('[data-pen-color]');
    const eraserBtn = this.container.querySelector('[data-draw-eraser]');

    colorBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.erasing = false;
        eraserBtn.classList.remove('btn-primary');
        colorBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.color = btn.dataset.penColor;
      });
    });

    this.container.querySelector('[data-pen-size]').addEventListener('input', (e) => {
      this.size = Number(e.target.value);
    });

    eraserBtn.addEventListener('click', () => {
      this.erasing = !this.erasing;
      eraserBtn.classList.toggle('btn-primary', this.erasing);
    });

    this.container.querySelector('[data-draw-undo]').addEventListener('click', () => {
      if (this.history.length <= 1) return;
      this.history.pop();
      const prev = this.history[this.history.length - 1];
      const img = new Image();
      img.onload = () => {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(img, 0, 0);
        this.notify();
      };
      img.src = prev;
    });

    this.container.querySelector('[data-draw-clear]').addEventListener('click', () => {
      this.fillWhite();
      this.hasDrawn = false;
      this.pushHistory();
      this.notify();
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.drawing = true;
      this.canvas.setPointerCapture(e.pointerId);
      const pt = this.getPoint(e);
      this.ctx.beginPath();
      this.ctx.moveTo(pt.x, pt.y);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.strokeStyle = this.erasing ? '#ffffff' : this.color;
      this.ctx.lineWidth = this.erasing ? this.size * 2.5 : this.size;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      const pt = this.getPoint(e);
      this.ctx.lineTo(pt.x, pt.y);
      this.ctx.stroke();
      this.hasDrawn = true;
    });

    const endStroke = () => {
      if (!this.drawing) return;
      this.drawing = false;
      this.ctx.closePath();
      this.pushHistory();
      this.notify();
    };

    this.canvas.addEventListener('pointerup', endStroke);
    this.canvas.addEventListener('pointercancel', endStroke);
  }

  notify() {
    if (this.onUpdate) {
      this.onUpdate(this.hasDrawn ? this.canvas.toDataURL('image/png') : null);
    }
  }
}
