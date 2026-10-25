import { createAudioEngine } from "./audioEngine.js";
import { Deck } from "./deck.js";
import { createSynthTracks } from "./synthTracks.js";
import { Waveforms } from "./waveform.js";
import { decodeAudioFile, formatTime } from "./playlist.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const decks = {};
const trackLibrary = [];
let engine = null;
let waveforms;
let audioReady = false;
let automixEnabled = false;
let automix = null;
let toastTimer;
let lastFrame = 0;

waveforms = new Waveforms({ a: $("#wave-a"), b: $("#wave-b") });
bindInterface();

function bindInterface() {
  $("#unlock-audio").addEventListener("click", unlockAudio);
  $("#add-tracks").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", event => importFiles(event.target.files));
  $("#track-search").addEventListener("input", renderPlaylist);
  $("#crossfader").addEventListener("input", event => {
    if (!engine) return;
    engine.setCrossfader(Number(event.target.value));
  });
  $("#master-volume").addEventListener("input", event => engine?.setMasterVolume(Number(event.target.value)));
  $("#fader-a").addEventListener("input", event => engine?.setFader("a", Number(event.target.value)));
  $("#fader-b").addEventListener("input", event => engine?.setFader("b", Number(event.target.value)));
  $("#fx-type").addEventListener("change", updateEffect);
  $("#fx-route").addEventListener("change", updateEffect);
  $("#fx-beat").addEventListener("change", updateEffect);
  $("#fx-level").addEventListener("input", updateEffect);
  $("#automix-button").addEventListener("click", toggleAutomix);
  $("#help-button").addEventListener("click", () => $("#shortcuts-dialog").showModal());
  $("#close-help").addEventListener("click", () => $("#shortcuts-dialog").close());
  $("#shortcuts-dialog").addEventListener("click", event => {
    if (event.target === $("#shortcuts-dialog")) $("#shortcuts-dialog").close();
  });

  $$(".tempo-slider").forEach(input => input.addEventListener("input", () => {
    const name = input.id.slice(-1);
    decks[name]?.setTempo(input.value);
    $(`#tempo-value-${name}`).textContent = `${Number(input.value) >= 0 ? "+" : ""}${Number(input.value).toFixed(1)}%`;
  }));
  $$(".loop-size").forEach(button => button.addEventListener("click", () => {
    const name = button.dataset.deck;
    $$(".loop-size").filter(item => item.dataset.deck === name).forEach(item => item.classList.toggle("selected", item === button));
    decks[name]?.setLoopBeats(Number(button.dataset.beats));
  }));
  $$(".loop-toggle").forEach(button => button.addEventListener("click", () => {
    const deck = decks[button.dataset.deck];
    if (!deck?.track) return notify("Load a track to set a loop.");
    deck.setLoop(!deck.loopEnabled);
    button.classList.toggle("active", deck.loopEnabled);
    button.textContent = deck.loopEnabled ? `LOOP ${deck.loopBeats}` : "LOOP OFF";
  }));

  for (const name of ["a", "b"]) {
    $(`#play-${name}`).addEventListener("click", () => {
      if (!decks[name].track) return notify("Load a track before pressing play.");
      decks[name].play();
    });
    $(`#cue-${name}`).addEventListener("click", event => {
      if (!decks[name].track) return notify("Load a track before using cue.");
      if (event.shiftKey) decks[name].setCuePoint();
      else decks[name].cue();
    });
    $(`#sync-${name}`).addEventListener("click", () => {
      const other = decks[name === "a" ? "b" : "a"];
      if (!decks[name].track || !other.track) return notify("Load tracks on both decks to sync.");
      decks[name].syncTo(other.track.bpm * other.rate);
      $(`#tempo-${name}`).value = decks[name].tempo;
      updateDeckDisplay(name);
    });
    $(`#reverse-${name}`).addEventListener("click", () => decks[name].toggleReverse());
    $$(".pitch-buttons button").filter(button => button.dataset.deck === name).forEach(button => {
      button.addEventListener("pointerdown", () => decks[name].bend(Number(button.dataset.bend)));
    });
    $$(".hot-cues button").filter(button => button.dataset.deck === name).forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.cue);
        if (!decks[name].track) return notify("Load a track to use hot cues.");
        decks[name].setHotCue(index);
        button.classList.toggle("has-cue", decks[name].hotCues[index] !== null);
      });
    });
    $("#platter-" + name).addEventListener("pointerdown", event => startScratch(event, name));
    $("#overview-" + name).addEventListener("pointerdown", event => seekOverview(event, name));
    $(`#platter-${name}`).addEventListener("keydown", event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        decks[name].seek(decks[name].getPosition() + (event.key === "ArrowLeft" ? -0.1 : 0.1));
      }
    });
  }
  $$(".knob").forEach(bindKnob);

  const dropZone = $("#drop-zone");
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    });
  }
  dropZone.addEventListener("drop", event => importFiles(event.dataTransfer.files));
  document.addEventListener("keydown", handleShortcuts);
  requestAnimationFrame(animate);
}

async function unlockAudio() {
  if (audioReady) return;
  $("#unlock-audio").disabled = true;
  $("#system-status").textContent = "POWERING AUDIO ENGINE";
  try {
    engine = await createAudioEngine();
    for (const name of ["a", "b"]) {
      decks[name] = new Deck(name, engine, () => updateDeckDisplay(name));
    }
    engine.setCrossfader(Number($("#crossfader").value));
    engine.setMasterVolume(Number($("#master-volume").value));
    engine.setFader("a", Number($("#fader-a").value));
    engine.setFader("b", Number($("#fader-b").value));
    audioReady = true;
    updateEffect();
    $("#unlock-screen").classList.add("dismissed");
  } catch (error) {
    $("#system-status").textContent = "AUDIO ENGINE ERROR";
    $("#unlock-audio").disabled = false;
    showUnlockError(error.message);
    return;
  }

  $("#system-status").textContent = "SYNTHESIZING TRACKS";
  try {
    const tracks = await createSynthTracks();
    trackLibrary.push(...tracks);
    renderPlaylist();
    $("#system-status").textContent = "AUDIO ENGINE READY";
    notify("Three original tracks are ready in your library.");
  } catch (error) {
    console.error(error);
    $("#system-status").textContent = "AUDIO ENGINE READY";
    notify(`Procedural tracks could not be created: ${error.message} You can still add local audio files.`);
  }
}

function showUnlockError(message) {
  $("#unlock-screen").classList.remove("dismissed");
  notify(message || "Unable to start the audio engine.");
}

function renderPlaylist() {
  const body = $("#track-list");
  const search = $("#track-search").value.trim().toLowerCase();
  const filtered = trackLibrary.filter(track => `${track.title} ${track.artist} ${track.genre}`.toLowerCase().includes(search));
  body.replaceChildren();
  filtered.forEach((track, index) => {
    const row = document.createElement("tr");
    if (track.local) row.className = "user-track";
    const number = document.createElement("td");
    number.textContent = String(trackLibrary.indexOf(track) + 1).padStart(2, "0");
    const title = document.createElement("td");
    title.textContent = `${track.title} / ${track.artist}`;
    const genre = document.createElement("td");
    genre.textContent = track.genre;
    const bpm = document.createElement("td");
    bpm.textContent = String(track.bpm);
    const key = document.createElement("td");
    key.textContent = track.key;
    const duration = document.createElement("td");
    duration.textContent = formatTime(track.buffer.duration);
    const actions = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "load-actions";
    for (const name of ["a", "b"]) {
      const button = document.createElement("button");
      button.className = name === "b" ? "load-b" : "";
      button.textContent = `LOAD ${name.toUpperCase()}`;
      button.setAttribute("aria-label", `Load ${track.title} to deck ${name.toUpperCase()}`);
      button.addEventListener("click", () => loadTrack(track, name));
      actionGroup.append(button);
    }
    actions.append(actionGroup);
    row.append(number, title, genre, bpm, key, duration, actions);
    body.append(row);
  });
  $("#empty-library").hidden = filtered.length > 0;
  $("#library-count").textContent = `${trackLibrary.length.toString().padStart(2, "0")} TRACKS`;
}

function loadTrack(track, name) {
  if (!audioReady) return notify("Power on the audio engine first.");
  decks[name].load(track);
  waveforms.setTrack(name, track);
  $(`#loop-toggle-${name}`).textContent = "LOOP OFF";
  $(`#loop-toggle-${name}`).classList.remove("active");
  $$(".hot-cues button").filter(button => button.dataset.deck === name).forEach(button => button.classList.remove("has-cue"));
  updateDeckDisplay(name);
  notify(`Loaded ${track.title} to Deck ${name.toUpperCase()}.`);
}

async function importFiles(fileList) {
  if (!audioReady) return notify("Power on the audio engine before adding local files.");
  const files = [...fileList].filter(file => file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name));
  if (!files.length) return notify("Choose an audio file to add.");
  let imported = 0;
  for (const file of files) {
    try {
      const track = await decodeAudioFile(file, engine.context);
      trackLibrary.push(track);
      imported++;
    } catch (error) {
      console.error(error);
      notify(error.message);
    }
  }
  renderPlaylist();
  if (imported) notify(`Added ${imported} local ${imported === 1 ? "track" : "tracks"} — audio stays on this device.`);
  $("#file-input").value = "";
}

function updateDeckDisplay(name) {
  const deck = decks[name];
  if (!deck) return;
  const suffix = name.toUpperCase();
  const playing = deck.playing;
  $(`#state-${name}`).textContent = !deck.track ? "EMPTY" : playing ? "PLAYING" : "LOADED";
  $(`#state-${name}`).classList.toggle("is-playing", playing);
  $(`#play-${name}`).classList.toggle("is-playing", playing);
  $(`#play-${name}`).textContent = playing ? "Ⅱ" : "▶";
  $(`#reverse-${name}`).classList.toggle("active", deck.reverse);
  $(`#tempo-${name}`).value = deck.tempo;
  $(`#tempo-value-${name}`).textContent = `${deck.tempo >= 0 ? "+" : ""}${deck.tempo.toFixed(1)}%`;
  if (!deck.track) {
    $(`#title-${name}`).textContent = "Select a track below";
    $(`#bpm-${name}`).innerHTML = "---.<small>--</small>";
    $(`#key-${name}`).textContent = "KEY --";
    $(`#duration-${name}`).textContent = "00:00";
    return;
  }
  $(`#title-${name}`).textContent = `${deck.track.title} — ${deck.track.artist}`;
  $(`#bpm-${name}`).innerHTML = `${deck.track.bpm}.<small>00</small>`;
  $(`#key-${name}`).textContent = `KEY ${deck.track.key}`;
  $(`#duration-${name}`).textContent = formatTime(deck.getDuration());
}

function animate(now) {
  requestAnimationFrame(animate);
  if (!engine || now - lastFrame < 32) return;
  lastFrame = now;
  for (const name of ["a", "b"]) {
    const deck = decks[name];
    const position = deck.getPosition();
    const markers = {
      hotCues: deck.hotCues,
      loopEnabled: deck.loopEnabled,
      loopStart: deck.loopStart,
      loopEnd: deck.loopEnd
    };
    waveforms.draw(name, position, deck.playing, markers);
    waveforms.drawOverview(name, position, markers);
    $(`#time-${name}`).textContent = formatTime(position);
    $(`#elapsed-${name}`).textContent = formatTime(position);
  }
  const masterLevel = engine.getLevel("master");
  const aLevel = engine.getLevel("a");
  const bLevel = engine.getLevel("b");
  $("#master-meter-l").style.height = `${Math.min(100, masterLevel * 100)}%`;
  $("#master-meter-r").style.height = `${Math.min(100, masterLevel * 93)}%`;
  $(".fx-meter span").style.width = `${Math.min(100, (aLevel + bLevel) * 65)}%`;
  $("#clock-readout").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
  updateAutomix();
}

function bindKnob(knob) {
  const min = Number(knob.dataset.min);
  const max = Number(knob.dataset.max);
  const control = knob.dataset.control;
  let value = Number(knob.dataset.value);
  const render = () => {
    const amount = (value - min) / (max - min);
    const angle = control === "trim"
      ? (value - 1) * 135
      : min < 0 && max > 0
        ? value < 0 ? value / -min * 135 : value / max * 135
        : -135 + amount * 270;
    knob.style.setProperty("--knob-angle", `${angle}deg`);
    knob.querySelector("i").style.transform = `rotate(${angle}deg)`;
    knob.setAttribute("aria-valuemin", min);
    knob.setAttribute("aria-valuemax", max);
    knob.setAttribute("aria-valuenow", value.toFixed(2));
    applyKnob(knob, value);
  };
  const update = next => {
    value = Math.max(min, Math.min(max, next));
    knob.dataset.value = String(value);
    render();
  };
  knob.addEventListener("pointerdown", event => {
    event.preventDefault();
    knob.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startValue = value;
    const sensitivity = (max - min) / 150;
    const move = moveEvent => update(startValue + (startY - moveEvent.clientY) * sensitivity);
    const end = () => {
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", end);
      knob.removeEventListener("pointercancel", end);
    };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", end);
    knob.addEventListener("pointercancel", end);
  });
  knob.addEventListener("keydown", event => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    update(value + (event.key === "ArrowUp" ? 1 : -1) * (max - min) / 48);
  });
  render();
}

function applyKnob(knob, value) {
  if (!engine) return;
  const { control, deck } = knob.dataset;
  if (control === "trim") engine.setTrim(deck, value);
  else if (control === "filter") engine.setFilter(deck, value);
  else engine.setEq(deck, control, value);
}

function startScratch(event, name) {
  if (!decks[name].track) return;
  event.preventDefault();
  const platter = event.currentTarget;
  platter.setPointerCapture(event.pointerId);
  decks[name].beginScratch();
  const getAngle = pointer => {
    const rect = platter.getBoundingClientRect();
    return Math.atan2(pointer.clientY - rect.top - rect.height / 2, pointer.clientX - rect.left - rect.width / 2);
  };
  let angle = getAngle(event);
  let lastTime = performance.now();
  const move = moveEvent => {
    let nextAngle = getAngle(moveEvent);
    let delta = nextAngle - angle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    const now = performance.now();
    const elapsed = Math.max(0.008, (now - lastTime) / 1000);
    const speed = delta * 0.42 / elapsed;
    const position = decks[name].getPosition() + delta * 0.42;
    decks[name].scratch(position, speed);
    angle = nextAngle;
    lastTime = now;
  };
  const end = () => {
    platter.removeEventListener("pointermove", move);
    platter.removeEventListener("pointerup", end);
    platter.removeEventListener("pointercancel", end);
    decks[name].endScratch();
  };
  platter.addEventListener("pointermove", move);
  platter.addEventListener("pointerup", end, { once: true });
  platter.addEventListener("pointercancel", end, { once: true });
}

function seekOverview(event, name) {
  if (!decks[name]?.track) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  decks[name].seek(ratio * decks[name].getDuration());
}

function updateEffect() {
  if (!engine) return;
  const type = $("#fx-type").value;
  const route = $("#fx-route").value;
  const beat = Number($("#fx-beat").value);
  const depth = Number($("#fx-level").value);
  const referenceBpm = decks.a.track?.bpm ?? decks.b.track?.bpm ?? 120;
  engine.setEffect(type, route, (60 / referenceBpm) * beat, depth);
  $("#fx-status").textContent = type === "off" ? "FX — OFF" : `FX — ${type.toUpperCase()} / ${route.toUpperCase()}`;
}

function toggleAutomix() {
  if (!audioReady) return notify("Power on the audio engine first.");
  if (automixEnabled) {
    automixEnabled = false;
    automix = null;
    $("#automix-button").setAttribute("aria-pressed", "false");
    $("#automix-state").textContent = "OFF";
    return notify("Automix disabled.");
  }
  const active = ["a", "b"].find(name => decks[name].playing && decks[name].track);
  const loaded = ["a", "b"].find(name => decks[name].track);
  const activeDeck = active ?? loaded;
  if (!activeDeck) return notify("Load a track before starting Automix.");
  automixEnabled = true;
  const nextDeck = activeDeck === "a" ? "b" : "a";
  const currentIndex = trackLibrary.indexOf(decks[activeDeck].track);
  const nextTrack = trackLibrary[(currentIndex + 1 + trackLibrary.length) % trackLibrary.length];
  if (!nextTrack || trackLibrary.length < 2) {
    automixEnabled = false;
    return notify("Add at least two tracks to use Automix.");
  }
  automix = { activeDeck, nextDeck, transitionStarted: false, transitionAt: 0, duration: Math.min(8, decks[activeDeck].getDuration() * 0.45) };
  loadTrack(nextTrack, nextDeck);
  const activeBpm = decks[activeDeck].track.bpm * decks[activeDeck].rate;
  decks[nextDeck].syncTo(activeBpm);
  $(`#tempo-${nextDeck}`).value = decks[nextDeck].tempo;
  updateDeckDisplay(nextDeck);
  const initial = activeDeck === "a" ? 0 : 1;
  $("#crossfader").value = initial;
  engine.setCrossfader(initial);
  $("#automix-button").setAttribute("aria-pressed", "true");
  $("#automix-state").textContent = "ON";
  notify(`Automix queued ${nextTrack.title}.`);
}

function updateAutomix() {
  if (!automixEnabled || !automix) return;
  const current = decks[automix.activeDeck];
  const incoming = decks[automix.nextDeck];
  if (!current.track || !incoming.track) return;
  const remaining = current.getDuration() - current.getPosition();
  if (!automix.transitionStarted && current.playing && remaining <= automix.duration) {
    incoming.play();
    automix.transitionStarted = true;
    automix.transitionAt = engine.context.currentTime;
  }
  if (!automix.transitionStarted) return;
  const progress = Math.min(1, (engine.context.currentTime - automix.transitionAt) / automix.duration);
  const crossfader = automix.activeDeck === "a" ? progress : 1 - progress;
  $("#crossfader").value = crossfader;
  engine.setCrossfader(crossfader);
  if (progress < 1) return;

  current.pause();
  const previous = automix.activeDeck;
  automix.activeDeck = automix.nextDeck;
  automix.nextDeck = previous;
  automix.transitionStarted = false;
  automix.duration = Math.min(8, incoming.getDuration() * 0.45);
  const currentIndex = trackLibrary.indexOf(incoming.track);
  const nextTrack = trackLibrary[(currentIndex + 1) % trackLibrary.length];
  if (nextTrack) {
    loadTrack(nextTrack, automix.nextDeck);
    decks[automix.nextDeck].syncTo(incoming.track.bpm * incoming.rate);
    $(`#tempo-${automix.nextDeck}`).value = decks[automix.nextDeck].tempo;
  }
}

function handleShortcuts(event) {
  if (event.target.matches("input,textarea,select,[contenteditable=true]")) return;
  if (event.key === "?" || (event.shiftKey && event.key === "/")) {
    $("#shortcuts-dialog").showModal();
  } else if (event.key.toLowerCase() === "q") {
    decks.a?.track && decks.a.play();
  } else if (event.key.toLowerCase() === "p") {
    decks.b?.track && decks.b.play();
  } else if (event.key.toLowerCase() === "w") {
    decks.a?.cue();
  } else if (event.key.toLowerCase() === "o") {
    decks.b?.cue();
  } else if (event.key.toLowerCase() === "m") {
    toggleAutomix();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const fader = $("#crossfader");
    fader.value = Math.max(0, Math.min(1, Number(fader.value) + (event.key === "ArrowLeft" ? -0.03 : 0.03)));
    engine?.setCrossfader(Number(fader.value));
  }
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}
