export class Deck {
  constructor(name, engine, onChange = () => {}) {
    this.name = name;
    this.engine = engine;
    this.onChange = onChange;
    this.track = null;
    this.source = null;
    this.playing = false;
    this.position = 0;
    this.startedAt = 0;
    this.rate = 1;
    this.tempo = 0;
    this.pitchBend = 1;
    this.cuePoint = 0;
    this.hotCues = [null, null, null, null];
    this.loopBeats = 4;
    this.loopEnabled = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.reverse = false;
    this.reversedBuffer = null;
    this.scratching = false;
    this.resumeAfterScratch = false;
    this.scratchDirection = 1;
  }

  load(track) {
    this.stopSource();
    this.track = track;
    this.position = 0;
    this.cuePoint = 0;
    this.hotCues = [null, null, null, null];
    this.reverse = false;
    this.reversedBuffer = null;
    this.loopEnabled = false;
    this.loopStart = 0;
    this.loopEnd = track.buffer.duration;
    this.onChange();
  }

  play() {
    if (!this.track) return false;
    if (this.playing && !this.scratching) {
      this.pause();
      return false;
    }
    this.startSource();
    this.playing = true;
    this.onChange();
    return true;
  }

  pause() {
    if (!this.playing) return;
    this.position = this.getPosition();
    this.stopSource();
    this.playing = false;
    this.onChange();
  }

  cue() {
    if (!this.track) return;
    if (this.playing) this.stopSource();
    this.position = this.cuePoint;
    this.playing = false;
    this.onChange();
  }

  setCuePoint() {
    if (!this.track) return;
    this.cuePoint = this.getPosition();
    this.onChange();
  }

  setHotCue(index) {
    if (!this.track || index < 0 || index > 3) return;
    if (this.hotCues[index] === null) {
      this.hotCues[index] = this.getPosition();
    } else {
      this.position = this.hotCues[index];
      if (this.playing) this.restartSource();
    }
    this.onChange();
  }

  setTempo(value) {
    this.tempo = Math.max(-16, Math.min(16, Number(value)));
    this.updateRate();
  }

  syncTo(bpm) {
    if (!this.track || !bpm) return;
    const percentage = (bpm / this.track.bpm - 1) * 100;
    this.setTempo(percentage);
  }

  bend(amount) {
    if (!this.playing) return;
    this.pitchBend = amount < 0 ? 0.94 : 1.06;
    this.updateRate();
    clearTimeout(this.bendTimeout);
    this.bendTimeout = setTimeout(() => {
      this.pitchBend = 1;
      this.updateRate();
    }, 180);
  }

  setLoopBeats(beats) {
    this.loopBeats = beats;
    if (this.loopEnabled) this.setLoop(true);
  }

  setLoop(enabled) {
    if (!this.track) return;
    const position = this.getPosition();
    this.loopEnabled = enabled;
    if (enabled) {
      const beatSeconds = 60 / this.track.bpm;
      this.loopStart = Math.min(position, Math.max(0, this.track.buffer.duration - beatSeconds * this.loopBeats));
      this.loopEnd = Math.min(this.track.buffer.duration, this.loopStart + beatSeconds * this.loopBeats);
      this.position = this.loopStart;
    } else {
      this.loopStart = 0;
      this.loopEnd = this.track.buffer.duration;
      this.position = position;
    }
    if (this.playing) this.restartSource();
    this.onChange();
  }

  toggleReverse() {
    if (!this.track) return;
    this.reverse = !this.reverse;
    if (this.playing) this.restartSource();
    this.onChange();
  }

  seek(position) {
    if (!this.track) return;
    this.position = this.wrapPosition(position);
    if (this.playing) this.restartSource();
    this.onChange();
  }

  beginScratch() {
    if (!this.track) return;
    this.position = this.getPosition();
    this.scratching = true;
    this.resumeAfterScratch = this.playing;
    this.scratchDirection = 0;
    if (this.playing) this.stopSource();
  }

  scratch(position, velocity) {
    if (!this.track || !this.scratching) return;
    this.position = this.wrapPosition(position);
    const direction = velocity < 0 ? -1 : 1;
    if (direction !== this.scratchDirection) {
      this.scratchDirection = direction;
      this.restartScratchSource(velocity);
    } else if (this.source) {
      this.source.playbackRate.setTargetAtTime(Math.max(0.12, Math.min(3.5, Math.abs(velocity))), this.engine.context.currentTime, 0.015);
    }
  }

  endScratch() {
    if (!this.scratching) return;
    const position = this.position;
    this.scratching = false;
    if (this.resumeAfterScratch) {
      this.reverse = false;
      this.position = position;
      this.stopSource();
      this.startSource();
      this.playing = true;
    } else {
      this.stopSource();
    }
    this.scratchDirection = 1;
    this.resumeAfterScratch = false;
    this.updateRate();
    this.onChange();
  }

  getPosition() {
    if (!this.track) return 0;
    if (this.scratching) return this.position;
    let position = this.position;
    if (this.playing) {
      const elapsed = this.engine.context.currentTime - this.startedAt;
      position += elapsed * this.rate * (this.reverse ? -1 : 1);
    }
    return this.wrapPosition(position);
  }

  getDuration() {
    return this.track?.buffer.duration ?? 0;
  }

  updateRate() {
    this.rate = 1 + this.tempo / 100;
    const playbackRate = this.rate * this.pitchBend;
    if (this.source && !this.scratching) {
      this.source.playbackRate.setTargetAtTime(playbackRate, this.engine.context.currentTime, 0.025);
    }
  }

  startSource() {
    if (!this.track) return;
    const buffer = this.reverse ? this.getReversedBuffer() : this.track.buffer;
    const source = this.engine.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const duration = buffer.duration;
    if (this.reverse) {
      source.loopStart = Math.max(0, duration - this.loopEnd);
      source.loopEnd = Math.max(source.loopStart + 0.01, duration - this.loopStart);
    } else {
      source.loopStart = this.loopStart;
      source.loopEnd = Math.max(this.loopStart + 0.01, this.loopEnd);
    }
    source.playbackRate.value = this.rate * this.pitchBend;
    this.engine.connectSource(source, this.name);
    this.source = source;
    this.startedAt = this.engine.context.currentTime;
    const offset = this.reverse ? Math.max(0, duration - this.position) : this.position;
    source.start(0, Math.min(offset, duration - 0.001));
  }

  restartSource() {
    this.position = this.getPosition();
    this.stopSource();
    this.startSource();
  }

  restartScratchSource(velocity) {
    this.position = this.getPosition();
    this.stopSource();
    this.reverse = velocity < 0;
    this.startSource();
    this.source.playbackRate.setValueAtTime(Math.max(0.12, Math.min(3.5, Math.abs(velocity))), this.engine.context.currentTime);
  }

  stopSource() {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
    }
    this.source.disconnect();
    this.source = null;
  }

  getReversedBuffer() {
    if (this.reversedBuffer) return this.reversedBuffer;
    const original = this.track.buffer;
    const reversed = this.engine.context.createBuffer(original.numberOfChannels, original.length, original.sampleRate);
    for (let channel = 0; channel < original.numberOfChannels; channel++) {
      const source = original.getChannelData(channel);
      const target = reversed.getChannelData(channel);
      for (let index = 0; index < source.length; index++) target[index] = source[source.length - 1 - index];
    }
    this.reversedBuffer = reversed;
    return reversed;
  }

  wrapPosition(position) {
    if (!this.track) return 0;
    if (this.loopEnabled && this.loopEnd > this.loopStart) {
      const length = this.loopEnd - this.loopStart;
      return this.loopStart + ((position - this.loopStart) % length + length) % length;
    }
    const duration = this.track.buffer.duration;
    return ((position % duration) + duration) % duration;
  }
}
