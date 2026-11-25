/**
 * 內建語音錄音器 (Padlet Audio Recorder Equivalent)
 * 使用瀏覽器原生 MediaRecorder API，免外掛錄製語音備忘並嵌入貼文
 */

export class AudioRecorderWidget {
  constructor(container, onRecorded) {
    this.container = container;
    this.onRecorded = onRecorded;
    this.mediaRecorder = null;
    this.stream = null;
    this.chunks = [];
    this.timer = null;
    this.seconds = 0;
    this.audioDataUrl = null;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="recorder-box">
        <div class="recorder-controls">
          <button type="button" class="btn btn-primary btn-sm" data-rec-start>🎙️ 開始錄音</button>
          <button type="button" class="btn btn-danger btn-sm hidden" data-rec-stop>⏹ 停止錄音</button>
          <span class="hidden" data-rec-indicator style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;font-weight:700;color:var(--danger)">
            <span class="rec-dot"></span>
            <span data-rec-time>00:00</span>
          </span>
        </div>
        <div data-rec-preview class="hidden" style="display:flex;flex-direction:column;gap:8px">
          <audio controls class="post-audio" data-rec-audio></audio>
          <button type="button" class="btn btn-sm" data-rec-clear style="align-self:flex-start">重錄 / 清除</button>
        </div>
        <div data-rec-error class="field-hint" style="color:var(--danger)"></div>
      </div>
    `;

    this.startBtn = this.container.querySelector('[data-rec-start]');
    this.stopBtn = this.container.querySelector('[data-rec-stop]');
    this.indicator = this.container.querySelector('[data-rec-indicator]');
    this.timeEl = this.container.querySelector('[data-rec-time]');
    this.previewBox = this.container.querySelector('[data-rec-preview]');
    this.audioEl = this.container.querySelector('[data-rec-audio]');
    this.clearBtn = this.container.querySelector('[data-rec-clear]');
    this.errorEl = this.container.querySelector('[data-rec-error]');

    this.startBtn.addEventListener('click', () => this.start());
    this.stopBtn.addEventListener('click', () => this.stop());
    this.clearBtn.addEventListener('click', () => this.clear());
  }

  async start() {
    this.errorEl.textContent = '';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.errorEl.textContent = '此瀏覽器環境不支援麥克風錄音（需 HTTPS 或 localhost）。';
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => {
        const mime = this.mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mime });
        const reader = new FileReader();
        reader.onload = () => {
          this.audioDataUrl = String(reader.result);
          this.audioEl.src = this.audioDataUrl;
          this.previewBox.classList.remove('hidden');
          if (this.onRecorded) this.onRecorded(this.audioDataUrl);
        };
        reader.readAsDataURL(blob);
        this.releaseStream();
      };

      this.mediaRecorder.start();
      this.seconds = 0;
      this.timeEl.textContent = '00:00';
      this.startBtn.classList.add('hidden');
      this.stopBtn.classList.remove('hidden');
      this.indicator.classList.remove('hidden');
      this.timer = setInterval(() => {
        this.seconds += 1;
        const m = String(Math.floor(this.seconds / 60)).padStart(2, '0');
        const s = String(this.seconds % 60).padStart(2, '0');
        this.timeEl.textContent = `${m}:${s}`;
        if (this.seconds >= 120) this.stop();
      }, 1000);
    } catch (err) {
      this.errorEl.textContent = `無法存取麥克風：${err.message}`;
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.startBtn.classList.remove('hidden');
    this.stopBtn.classList.add('hidden');
    this.indicator.classList.add('hidden');
  }

  clear() {
    this.audioDataUrl = null;
    this.audioEl.src = '';
    this.previewBox.classList.add('hidden');
    if (this.onRecorded) this.onRecorded(null);
  }

  releaseStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  destroy() {
    this.stop();
    this.releaseStream();
  }
}
