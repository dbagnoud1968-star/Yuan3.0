let localTrackId = 0;

export async function decodeAudioFile(file, audioContext) {
  const encoded = await file.arrayBuffer();
  let buffer;
  try {
    buffer = await audioContext.decodeAudioData(encoded.slice(0));
  } catch (error) {
    throw new Error(`Could not decode "${file.name}". Try an MP3, WAV, OGG, or M4A file.`, { cause: error });
  }
  const bpm = detectBpm(buffer);
  const title = file.name.replace(/\.[^.]+$/, "");
  return {
    id: `local-${++localTrackId}`,
    title,
    artist: "LOCAL FILE",
    genre: "LOCAL",
    bpm,
    key: "--",
    buffer,
    local: true
  };
}

export function detectBpm(buffer) {
  const channel = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate / 100));
  const envelope = new Float32Array(Math.ceil(channel.length / step));
  for (let point = 0; point < envelope.length; point++) {
    const start = point * step;
    const end = Math.min(channel.length, start + step);
    let energy = 0;
    for (let sample = start; sample < end; sample += 2) energy += channel[sample] * channel[sample];
    envelope[point] = Math.sqrt(energy / Math.max(1, Math.ceil((end - start) / 2)));
  }

  const max = envelope.reduce((peak, value) => Math.max(peak, value), 0);
  if (max < 0.001) return 120;
  const minGap = 22;
  const peaks = [];
  let lastPeak = -minGap;
  const smoothRadius = 4;
  for (let index = smoothRadius; index < envelope.length - smoothRadius; index++) {
    let localAverage = 0;
    for (let offset = -smoothRadius; offset <= smoothRadius; offset++) localAverage += envelope[index + offset];
    localAverage /= smoothRadius * 2 + 1;
    const value = envelope[index];
    if (value < Math.max(max * 0.09, localAverage * 1.55) || index - lastPeak < minGap) continue;
    let isMaximum = true;
    for (let offset = -2; offset <= 2; offset++) {
      if (envelope[index + offset] > value) isMaximum = false;
    }
    if (isMaximum) {
      peaks.push(index);
      lastPeak = index;
    }
  }
  if (peaks.length < 3) return 120;

  const intervals = [];
  for (let index = 1; index < peaks.length; index++) {
    const interval = peaks[index] - peaks[index - 1];
    if (interval >= 22 && interval <= 115) intervals.push(interval);
  }
  if (!intervals.length) return 120;
  const histogram = new Map();
  for (const interval of intervals) {
    const rawBpm = 6000 / interval;
    for (const bpm of [rawBpm, rawBpm * 2, rawBpm / 2]) {
      if (bpm < 70 || bpm > 190) continue;
      const rounded = Math.round(bpm);
      histogram.set(rounded, (histogram.get(rounded) ?? 0) + 1);
    }
  }
  return [...histogram.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 120;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
