export class Waveforms {
  constructor(elements) {
    this.elements = elements;
    this.data = { a: null, b: null };
    this.overview = { a: null, b: null };
    this.colors = { a: ["#ff4d5d", "#79e57c", "#49bdff"], b: ["#ff4d5d", "#79e57c", "#49bdff"] };
    window.addEventListener("resize", () => this.resizeAll());
    this.resizeAll();
  }

  setTrack(deck, track) {
    this.data[deck] = track ? { ...analyzeBuffer(track.buffer), bpm: track.bpm } : null;
    this.overview[deck] = track?.buffer ?? null;
    this.drawOverview(deck, 0);
  }

  resizeAll() {
    for (const canvas of Object.values(this.elements)) {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
    }
  }

  draw(deck, position, playing, state = {}) {
    const canvas = this.elements[deck];
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0b0d10";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#252a30";
    context.lineWidth = 1;
    const data = this.data[deck];
    const windowSeconds = 8;
    const secondsPerPixel = windowSeconds / width;
    const startTime = position - windowSeconds / 2;
    if (data?.bpm) {
      const beatDuration = 60 / data.bpm;
      const firstBeat = Math.max(0, Math.ceil(startTime / beatDuration));
      const lastBeat = Math.ceil((startTime + windowSeconds) / beatDuration);
      for (let beat = firstBeat; beat <= lastBeat; beat++) {
        const x = Math.round((beat * beatDuration - startTime) / secondsPerPixel) + 0.5;
        context.strokeStyle = beat % 4 === 0 ? "#39414a" : "#252a30";
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
    }
    if (state.loopEnabled) {
      const left = Math.max(0, Math.floor((state.loopStart - startTime) / secondsPerPixel));
      const right = Math.min(width, Math.ceil((state.loopEnd - startTime) / secondsPerPixel));
      if (right > left) {
        context.fillStyle = "#ffffff0c";
        context.fillRect(left, 0, right - left, height);
      }
    }
    if (data) {
      const center = Math.floor(width / 2);
      const samplesPerSecond = data.length / data.duration;
      const bands = [data.low, data.mid, data.high];
      const bandColors = this.colors[deck];
      const bandHeight = height / 3;
      for (let x = 0; x < width; x++) {
        const time = position + (x - center) * secondsPerPixel;
        const sample = Math.floor(time * samplesPerSecond);
        if (sample < 0 || sample >= data.length) continue;
        for (let band = 0; band < 3; band++) {
          const amplitude = bands[band][sample];
          const centerY = band * bandHeight + bandHeight / 2;
          const extent = Math.max(1, amplitude * bandHeight * 0.9);
          context.fillStyle = bandColors[band];
          context.globalAlpha = 0.3 + Math.min(0.7, amplitude);
          context.fillRect(x, centerY - extent / 2, 1, extent);
        }
      }
      context.globalAlpha = 1;
    }
    if (state.hotCues) {
      const accent = deck === "a" ? "#00e5f5" : "#ff3685";
      state.hotCues.forEach((cue, index) => {
        if (cue === null) return;
        const x = Math.round((cue - startTime) / secondsPerPixel);
        if (x < 0 || x >= width) return;
        context.strokeStyle = accent;
        context.globalAlpha = 0.8;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
        context.fillStyle = accent;
        context.fillText(String(index + 1), x + 3, 9);
      });
      context.globalAlpha = 1;
    }
    context.fillStyle = playing ? "#ffffff" : "#aeb4bc";
    context.fillRect(Math.floor(width / 2) - 1, 0, 2, height);
    context.fillStyle = "#ffffff18";
    context.fillRect(Math.floor(width / 2) - 20, 0, 40, height);
    context.fillStyle = playing ? "#ffffff" : "#aeb4bc";
    context.fillRect(Math.floor(width / 2) - 1, 0, 2, height);
  }

  drawOverview(deck, position, state = {}) {
    const canvas = document.getElementById(`overview-${deck}`);
    const buffer = this.overview[deck];
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * ratio)) {
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
    }
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0b0d10";
    context.fillRect(0, 0, width, height);
    if (!buffer) return;
    if (state.loopEnabled) {
      const start = Math.max(0, state.loopStart / buffer.duration * width);
      const end = Math.min(width, state.loopEnd / buffer.duration * width);
      context.fillStyle = "#ffffff18";
      context.fillRect(start, 0, end - start, height);
    }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    const stride = Math.max(1, Math.floor(buffer.length / width));
    context.strokeStyle = deck === "a" ? "#00e5f5" : "#ff3685";
    context.globalAlpha = 0.85;
    context.beginPath();
    for (let x = 0; x < width; x++) {
      let peak = 0;
      const start = x * stride;
      const end = Math.min(buffer.length, start + stride);
      for (const channel of channels) {
        for (let sample = start; sample < end; sample += 4) peak = Math.max(peak, Math.abs(channel[sample]));
      }
      const y = height / 2 - peak * height * 0.44;
      context.moveTo(x, height / 2 + peak * height * 0.44);
      context.lineTo(x, y);
    }
    context.stroke();
    if (state.hotCues) {
      context.fillStyle = deck === "a" ? "#00e5f5" : "#ff3685";
      for (const cue of state.hotCues) {
        if (cue === null) continue;
        const cueX = Math.max(0, Math.min(width, cue / buffer.duration * width));
        context.fillRect(cueX - 1, 0, 2, height);
      }
    }
    context.globalAlpha = 1;
    const x = Math.max(0, Math.min(width, position / buffer.duration * width));
    context.fillStyle = "#ffffff";
    context.fillRect(x - 1, 0, 2, height);
  }
}

function analyzeBuffer(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const length = Math.min(1800, Math.max(240, Math.ceil(buffer.duration * 28)));
  const low = new Float32Array(length);
  const mid = new Float32Array(length);
  const high = new Float32Array(length);
  let previousLow = 0;
  let previousMid = 0;
  for (let point = 0; point < length; point++) {
    const start = Math.floor(point * buffer.length / length);
    const end = Math.max(start + 1, Math.floor((point + 1) * buffer.length / length));
    let sum = 0;
    let count = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample += 6) {
        sum += Math.abs(channel[sample]);
        count++;
      }
    }
    const energy = Math.min(1, (sum / Math.max(count, 1)) * 3.5);
    previousLow = previousLow * 0.86 + energy * 0.14;
    previousMid = previousMid * 0.5 + energy * 0.5;
    low[point] = previousLow;
    mid[point] = Math.max(0, Math.abs(previousMid - previousLow) * 2.2);
    high[point] = Math.max(0, energy - previousMid) * 2.6;
  }
  return { low, mid, high, duration: buffer.duration, length };
}
