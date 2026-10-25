const deckNames = ["a", "b"];

export async function createAudioEngine() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("This browser does not support the Web Audio API.");

  const context = new AudioContextConstructor();
  await context.resume();
  const master = context.createGain();
  const limiter = context.createDynamicsCompressor();
  const masterAnalyser = context.createAnalyser();
  masterAnalyser.fftSize = 256;
  limiter.threshold.value = -3;
  limiter.knee.value = 5;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  master.connect(limiter).connect(masterAnalyser).connect(context.destination);
  master.gain.value = 0.78;

  const channels = {};
  const fxInput = context.createGain();
  for (const name of deckNames) {
    const trim = context.createGain();
    const low = context.createBiquadFilter();
    const mid = context.createBiquadFilter();
    const high = context.createBiquadFilter();
    const filter = context.createBiquadFilter();
    const fader = context.createGain();
    const crossfade = context.createGain();
    const analyser = context.createAnalyser();
    low.type = "lowshelf";
    low.frequency.value = 250;
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 0.8;
    high.type = "highshelf";
    high.frequency.value = 4000;
    filter.type = "lowpass";
    filter.frequency.value = 22000;
    analyser.fftSize = 256;
    trim.gain.value = 1;
    fader.gain.value = 0.82;
    crossfade.gain.value = 0.707;
    trim.connect(low);
    low.connect(mid).connect(high).connect(filter).connect(analyser).connect(fader).connect(crossfade).connect(master);
    channels[name] = { trim, low, mid, high, filter, fader, crossfade, analyser };
    filter.connect(fxInput);
  }

  const echo = context.createDelay(4);
  const echoFeedback = context.createGain();
  const echoWet = context.createGain();
  echo.delayTime.value = 0.35;
  echoFeedback.gain.value = 0.32;
  echo.connect(echoFeedback).connect(echo);
  echo.connect(echoWet);
  echoWet.gain.value = 0;

  const flanger = context.createDelay(0.05);
  const flangeFeedback = context.createGain();
  const flangeWet = context.createGain();
  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();
  flanger.delayTime.value = 0.008;
  flangeFeedback.gain.value = 0.2;
  lfo.frequency.value = 0.25;
  lfoDepth.gain.value = 0.004;
  lfo.connect(lfoDepth).connect(flanger.delayTime);
  lfo.start();
  flanger.connect(flangeFeedback).connect(flanger);
  flanger.connect(flangeWet);
  flangeWet.gain.value = 0;

  const convolver = context.createConvolver();
  const reverbWet = context.createGain();
  convolver.buffer = makeImpulse(context, 2.2, 2.2);
  convolver.connect(reverbWet);
  reverbWet.gain.value = 0;

  const fxLevel = context.createGain();
  const fxReturn = context.createGain();
  const fxToMaster = context.createGain();
  const fxToA = context.createGain();
  const fxToB = context.createGain();
  fxLevel.gain.value = 0;
  fxInput.connect(echo);
  fxInput.connect(flanger);
  fxInput.connect(convolver);
  echoWet.connect(fxLevel);
  flangeWet.connect(fxLevel);
  reverbWet.connect(fxLevel);
  fxLevel.connect(fxReturn);
  fxReturn.connect(fxToMaster).connect(master);
  fxReturn.connect(fxToA).connect(channels.a.crossfade);
  fxReturn.connect(fxToB).connect(channels.b.crossfade);
  fxToMaster.gain.value = 1;
  fxToA.gain.value = 0;
  fxToB.gain.value = 0;

  const scratchGains = Object.fromEntries(deckNames.map(name => [name, context.createGain()]));
  for (const name of deckNames) {
    channels[name].crossfade.gain.value = name === "a" ? Math.SQRT1_2 : Math.SQRT1_2;
    channels[name].sourceInput = scratchGains[name];
    scratchGains[name].connect(channels[name].trim);
  }

  const analysers = { master: masterAnalyser, a: channels.a.analyser, b: channels.b.analyser };

  function setCrossfader(value) {
    const angle = Math.max(0, Math.min(1, value)) * Math.PI / 2;
    channels.a.crossfade.gain.setTargetAtTime(Math.cos(angle), context.currentTime, 0.012);
    channels.b.crossfade.gain.setTargetAtTime(Math.sin(angle), context.currentTime, 0.012);
  }

  function setFilter(name, value) {
    const node = channels[name].filter;
    if (value < 0) {
      node.type = "lowpass";
      node.frequency.setTargetAtTime(22000 * Math.pow(35 / 22000, -value), context.currentTime, 0.018);
    } else if (value > 0) {
      node.type = "highpass";
      node.frequency.setTargetAtTime(20 * Math.pow(3500 / 20, value), context.currentTime, 0.018);
    } else {
      node.type = "lowpass";
      node.frequency.setTargetAtTime(22000, context.currentTime, 0.018);
    }
  }

  function setEffect(type, route, beatSeconds, depth) {
    const enabled = type !== "off";
    echoWet.gain.setTargetAtTime(type === "echo" ? 1 : 0, context.currentTime, 0.02);
    flangeWet.gain.setTargetAtTime(type === "flanger" ? 1 : 0, context.currentTime, 0.02);
    reverbWet.gain.setTargetAtTime(type === "reverb" ? 1 : 0, context.currentTime, 0.02);
    fxLevel.gain.setTargetAtTime(enabled ? depth : 0, context.currentTime, 0.02);
    if (type === "echo") echo.delayTime.setTargetAtTime(Math.max(0.06, Math.min(3.8, beatSeconds)), context.currentTime, 0.025);
    if (type === "flanger") {
      lfo.frequency.setTargetAtTime(Math.max(0.05, Math.min(3, 1 / Math.max(beatSeconds, 0.33))), context.currentTime, 0.05);
      lfoDepth.gain.setTargetAtTime(0.001 + depth * 0.012, context.currentTime, 0.03);
    }
    fxToMaster.gain.setTargetAtTime(route === "master" ? 1 : 0, context.currentTime, 0.02);
    fxToA.gain.setTargetAtTime(route === "a" ? 1 : 0, context.currentTime, 0.02);
    fxToB.gain.setTargetAtTime(route === "b" ? 1 : 0, context.currentTime, 0.02);
  }

  function connectSource(source, name) {
    source.connect(scratchGains[name]);
  }

  function setEq(name, band, value) {
    const nodes = { low: channels[name].low, mid: channels[name].mid, high: channels[name].high };
    const node = nodes[band];
    if (node) node.gain.setTargetAtTime(value, context.currentTime, 0.025);
  }

  function getLevel(name) {
    const analyser = analysers[name];
    const values = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(values);
    let energy = 0;
    for (const value of values) {
      const sample = (value - 128) / 128;
      energy += sample * sample;
    }
    return Math.min(1, Math.sqrt(energy / values.length) * 2.8);
  }

  return {
    context,
    channels,
    master,
    connectSource,
    setCrossfader,
    setFilter,
    setEq,
    setEffect,
    setMasterVolume(value) { master.gain.setTargetAtTime(value, context.currentTime, 0.02); },
    setTrim(name, value) { channels[name].trim.gain.setTargetAtTime(value, context.currentTime, 0.02); },
    setFader(name, value) { channels[name].fader.gain.setTargetAtTime(value, context.currentTime, 0.02); },
    getLevel
  };
}

function makeImpulse(context, seconds, decay) {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}
