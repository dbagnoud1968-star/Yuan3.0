const sampleRate = 44100;
const bars = 4;

export const trackCatalog = [
  { id: "tech-house", title: "Night Shift", artist: "NEON DECK", genre: "TECH HOUSE", bpm: 126, key: "8A", style: "house" },
  { id: "peak-techno", title: "Redline", artist: "NEON DECK", genre: "PEAK TECHNO", bpm: 128, key: "5A", style: "techno" },
  { id: "drum-bass", title: "Afterburn", artist: "NEON DECK", genre: "DRUM & BASS", bpm: 174, key: "11A", style: "dnb" }
];

export async function createSynthTracks() {
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error("This browser does not support offline audio synthesis.");
  return Promise.all(trackCatalog.map(async metadata => ({
    ...metadata,
    buffer: await synthesize(metadata, OfflineContext)
  })));
}

async function synthesize(track, OfflineContext) {
  const beat = 60 / track.bpm;
  const duration = beat * 4 * bars;
  const context = new OfflineContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const master = context.createGain();
  master.gain.value = 0.76;
  master.connect(context.destination);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.ratio.value = 5;
  limiter.connect(master);

  const kickEvery = track.style === "dnb" ? 2 : 1;
  for (let index = 0; index < bars * 4; index++) {
    const time = index * beat;
    if (index % kickEvery === 0) kick(context, limiter, time, track.style);
    if (track.style !== "techno" && index % 4 === 1 || track.style === "techno" && index % 4 === 2) {
      noiseHit(context, limiter, time, 0.18, 1800, track.style === "dnb" ? 0.28 : 0.38);
    }
    if (track.style === "dnb" && index % 4 === 2) noiseHit(context, limiter, time, 0.11, 2200, 0.3);
    if (track.style === "techno" && index % 4 === 2) noiseHit(context, limiter, time, 0.06, 9000, 0.17);
  }

  const eighths = Math.ceil(duration / (beat / 2));
  for (let index = 0; index < eighths; index++) {
    const time = index * beat / 2;
    const offbeat = index % 2 === 1;
    const probability = track.style === "techno" ? (offbeat ? 0.78 : 0.3) : (offbeat ? 0.93 : 0.23);
    if (Math.random() < probability) {
      noiseHit(context, limiter, time, track.style === "dnb" ? 0.045 : 0.065,
        track.style === "techno" ? (offbeat ? 7300 : 4800) : (offbeat ? 9400 : 6800),
        track.style === "dnb" ? 0.12 : 0.105);
    }
  }

  if (track.style === "house") {
    const notes = [55, 55, 65.41, 73.42, 55, 82.41, 73.42, 65.41];
    for (let index = 0; index < bars * 4; index++) {
      bassNote(context, limiter, index * beat + beat * 0.05, beat * 0.78, notes[index % notes.length], "triangle", 0.22);
      if (index % 4 === 0 || index % 4 === 2) chord(context, limiter, index * beat + beat * 0.08, beat * 0.34, index % 8 === 0 ? 220 : 246.94);
    }
  } else if (track.style === "techno") {
    const notes = [55, 55, 65.41, 73.42, 55, 82.41, 73.42, 65.41, 55, 65.41, 73.42, 82.41, 73.42, 65.41, 55, 49];
    for (let index = 0; index < bars * 4; index++) {
      bassNote(context, limiter, index * beat + beat * 0.02, beat * 0.46, notes[index % notes.length], "sawtooth", 0.2, 0.42);
      if (index % 2 === 1) chord(context, limiter, index * beat + beat * 0.08, beat * 0.2, 164.81 + (index % 4) * 20);
    }
  } else {
    const notes = [55, 55, 65.41, 73.42, 55, 49, 65.41, 58.27];
    for (let index = 0; index < bars * 8; index++) {
      const time = index * beat / 2;
      bassNote(context, limiter, time, beat * 0.42, notes[index % notes.length], "sawtooth", 0.16, 0.38);
      if (index % 4 === 2) noiseHit(context, limiter, time, 0.055, 3300, 0.16);
    }
  }
  return context.startRendering();
}

function kick(context, output, time, style) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(style === "techno" ? 160 : 145, time);
  oscillator.frequency.exponentialRampToValueAtTime(style === "dnb" ? 45 : 38, time + 0.13);
  gain.gain.setValueAtTime(style === "dnb" ? 0.95 : 1.1, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + (style === "techno" ? 0.34 : 0.24));
  oscillator.connect(gain).connect(output);
  oscillator.start(time);
  oscillator.stop(time + 0.36);
}

function noiseHit(context, output, time, length, cutoff, volume) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = cutoff;
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + length);
  source.connect(filter).connect(gain).connect(output);
  source.start(time);
}

function bassNote(context, output, time, length, frequency, type, volume, detune = 0) {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.detune.value = detune;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(type === "sawtooth" ? 700 : 1100, time);
  filter.frequency.exponentialRampToValueAtTime(type === "sawtooth" ? 260 : 480, time + length);
  filter.Q.value = type === "sawtooth" ? 2.5 : 0.7;
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(volume, time + 0.012);
  gain.gain.setValueAtTime(volume * 0.7, time + length * 0.55);
  gain.gain.exponentialRampToValueAtTime(0.001, time + length);
  oscillator.connect(filter).connect(gain).connect(output);
  oscillator.start(time);
  oscillator.stop(time + length + 0.02);
}

function chord(context, output, time, length, root) {
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(2200, time);
  filter.frequency.exponentialRampToValueAtTime(650, time + length);
  envelope.gain.setValueAtTime(0.001, time);
  envelope.gain.linearRampToValueAtTime(0.075, time + 0.018);
  envelope.gain.exponentialRampToValueAtTime(0.001, time + length);
  filter.connect(envelope).connect(output);
  for (const ratio of [1, 1.25, 1.5]) {
    const oscillator = context.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = root * ratio;
    oscillator.connect(filter);
    oscillator.start(time);
    oscillator.stop(time + length + 0.02);
  }
}
