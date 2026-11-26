import { vibrateGamepad, getControllerSettings } from './controller';

const SOUND_URLS = {
  cock: 'https://cdn.freesound.org/previews/402/402790_7111288-hq.mp3',
  gunshot: 'https://cdn.freesound.org/previews/396/396316_5937039-hq.mp3',
  click: 'https://cdn.freesound.org/previews/677/677159_7157894-hq.mp3',
  splatter: 'https://cdn.freesound.org/previews/406/406582_6068748-hq.mp3',
  heartbeat: 'https://cdn.freesound.org/previews/332/332821_5859881-lq.mp3',
  load: 'https://cdn.freesound.org/previews/139/139001_2534439-hq.mp3',
  ambient: 'https://cdn.freesound.org/previews/799/799355_2520418-lq.mp3',
  item: 'https://cdn.freesound.org/previews/538/538000_3377875-hq.mp3',
  tap: 'https://cdn.freesound.org/previews/253/253168_4404552-hq.mp3',
  purchase: 'https://cdn.freesound.org/previews/209/209578_2558531-hq.mp3',
  syringeCap: 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABgAZGF0YQQAAAAAAAAA',
  syringeSlam: 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABgAZGF0YQQAAAAAAAAA',
  thump: 'https://cdn.freesound.org/previews/454/454418_612689-hq.mp3',
  pliers: 'https://pixabay.com/sound-effects/download/film-special-effects-pliers-155627/'
};

const audioInstances = new Map<string, HTMLAudioElement>();

let globalMasterVolume = 1.0;
let globalAmbientVolume = 0.4;

export const setMasterVolume = (vol: number) => {
  globalMasterVolume = Math.max(0, Math.min(1, vol));
  const ambient = audioInstances.get('ambient');
  if (ambient) ambient.volume = globalAmbientVolume * globalMasterVolume;
  const heartbeat = audioInstances.get('heartbeat');
  if (heartbeat) heartbeat.volume = 1.0 * globalMasterVolume;
};

export const setAmbientVolume = (vol: number) => {
  globalAmbientVolume = Math.max(0, Math.min(1, vol));
  const ambient = audioInstances.get('ambient');
  if (ambient) ambient.volume = globalAmbientVolume * globalMasterVolume;
};

export const getMasterVolume = () => globalMasterVolume;
export const getAmbientVolume = () => globalAmbientVolume;

export const initAudio = () => {
  // Preload all audio
  for (const [key, url] of Object.entries(SOUND_URLS)) {
    if (!audioInstances.has(key)) {
      const audio = new Audio(url);
      if (key === 'ambient' || key === 'heartbeat') {
        audio.loop = true;
      }
      audioInstances.set(key, audio);
    }
  }
};

const playSound = (key: string, restart = true, baseVolume = 1.0) => {
  let audio = audioInstances.get(key);
  if (!audio && key in SOUND_URLS) {
     audio = new Audio(SOUND_URLS[key as keyof typeof SOUND_URLS]);
     if (key === 'ambient' || key === 'heartbeat') audio.loop = true;
     audioInstances.set(key, audio);
  }
  if (audio) {
    if (restart) {
      audio.currentTime = 0;
    }
    const finalVol = key === 'ambient' ? (globalAmbientVolume * globalMasterVolume) : (baseVolume * globalMasterVolume);
    audio.volume = finalVol;
    audio.play().catch(e => console.warn(`Audio play failed for ${key}:`, e));
  }
};

const stopSound = (key: string) => {
  const audio = audioInstances.get(key);
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
};

export const playStartAudio = () => {
  initAudio();
};

export const startAmbientDrone = () => {
  playSound('ambient', false, 0.4);
};

export const playGunshot = () => {
  playSound('gunshot', true, 1.0);
};

export const playCockSound = () => {
  playSound('cock', true, 1.0);
  // Hammer pull tension followed by the crisp lock
  setTimeout(() => vibrateGamepad('rumble', { duration: 80, weak: 0.3, strong: 0.0 }), 50);
  setTimeout(() => vibrateGamepad('click', { duration: 30, weak: 0.8, strong: 0.6 }), 280);
};

export const playEmptyClick = () => {
  playSound('click', true, 1.0);
};

export const playTapSound = () => {
  playUIClick('primary');
};

export const playItemSound = () => {
  playUIClick('secondary');
};

export const playUIHover = (intensity: number = 0.5) => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // Very subtle, short, soft low-pass filtered click
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.03);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05 * intensity * globalMasterVolume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    
    osc.start(now);
    osc.stop(now + 0.05);

    setTimeout(() => {
      try { osc.disconnect(); gain.disconnect(); } catch(e){}
    }, 100);
  } catch (e) {}
};

export const playUIClick = (type: 'primary' | 'secondary' | 'back' | 'toggle' = 'primary') => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === 'primary') {
      // Crisp, tactile click
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15 * globalMasterVolume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    } else if (type === 'secondary') {
      // Deeper, softer thud
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.06);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12 * globalMasterVolume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    } else if (type === 'back') {
      // Lower pitched, descending click
      osc.type = 'square';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.05);
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1000, now);
      filter.connect(gain);
      osc.disconnect();
      osc.connect(filter);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1 * globalMasterVolume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    } else if (type === 'toggle') {
      // Double click effect
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1 * globalMasterVolume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      
      // Add second click
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(800, now + 0.05);
      osc2.frequency.exponentialRampToValueAtTime(1000, now + 0.09);
      gain2.gain.setValueAtTime(0, now + 0.05);
      gain2.gain.linearRampToValueAtTime(0.12 * globalMasterVolume, now + 0.06);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.1);
      
      setTimeout(() => {
        try { osc2.disconnect(); gain2.disconnect(); } catch(e){}
      }, 150);
    }
    
    osc.start(now);
    osc.stop(now + 0.1);

    setTimeout(() => {
      try { osc.disconnect(); gain.disconnect(); } catch(e){}
    }, 150);
  } catch (e) {}
};

export const playUISliderTick = (normalizedValue: number) => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // Pitch goes up as slider goes right (normalizedValue 0.0 -> 1.0)
    const baseFreq = 400 + (normalizedValue * 400); 
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, now + 0.03);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05 * globalMasterVolume, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    
    osc.start(now);
    osc.stop(now + 0.05);

    setTimeout(() => {
      try { osc.disconnect(); gain.disconnect(); } catch(e){}
    }, 100);
  } catch (e) {}
};

export const playPurchaseSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // Cash register / purchase satisfying sound (ch-ching)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'square';
    osc1.frequency.setValueAtTime(800, now);
    osc1.frequency.linearRampToValueAtTime(1200, now + 0.1);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.2 * globalMasterVolume, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1200, now + 0.1);
    osc2.frequency.linearRampToValueAtTime(1800, now + 0.2);
    gain2.gain.setValueAtTime(0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(0.2 * globalMasterVolume, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    
    osc1.start(now);
    osc1.stop(now + 0.16);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.26);
    
    setTimeout(() => { 
      try { 
        osc1.disconnect(); gain1.disconnect(); 
        osc2.disconnect(); gain2.disconnect(); 
      } catch(e){} 
    }, 300);
  } catch (e) {}
};

export const playBloodSplatter = () => {
  const s = getControllerSettings();
  if (s.bloodEffectsEnabled === false) return;
  playBloodImpactSplatter(1.05);
};

export const playCylinderLatchSound = (stage: 'open' | 'close') => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = globalMasterVolume;
    const pitchVar = 0.96 + Math.random() * 0.08;

    const makeNoise = (dur: number, decayTau: number) => {
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.exp(-(i / ctx.sampleRate) / decayTau);
      }
      return buf;
    };

    if (stage === 'open') {
      // 1. Thumb latch forward slide & detent release click
      const latchSrc = ctx.createBufferSource();
      latchSrc.buffer = makeNoise(0.055, 0.014);
      const latchFilter = ctx.createBiquadFilter();
      latchFilter.type = 'bandpass';
      latchFilter.frequency.setValueAtTime(2200 * pitchVar, now);
      latchFilter.frequency.exponentialRampToValueAtTime(1250 * pitchVar, now + 0.045);
      latchFilter.Q.value = 3.2;
      const latchGain = ctx.createGain();
      latchGain.gain.setValueAtTime(0.42 * vol, now);
      latchGain.gain.exponentialRampToValueAtTime(0.002, now + 0.05);
      latchSrc.connect(latchFilter);
      latchFilter.connect(latchGain);
      latchGain.connect(ctx.destination);
      latchSrc.start(now);
      latchSrc.stop(now + 0.055);

      // 2. Steel cylinder crane swinging out on yoke pin
      const swingTime = now + 0.055;
      const swingSrc = ctx.createBufferSource();
      swingSrc.buffer = makeNoise(0.11, 0.032);
      const swingFilter = ctx.createBiquadFilter();
      swingFilter.type = 'bandpass';
      swingFilter.frequency.setValueAtTime(980 * pitchVar, swingTime);
      swingFilter.frequency.exponentialRampToValueAtTime(480 * pitchVar, swingTime + 0.09);
      swingFilter.Q.value = 2.4;
      const swingGain = ctx.createGain();
      swingGain.gain.setValueAtTime(0.24 * vol, swingTime);
      swingGain.gain.exponentialRampToValueAtTime(0.002, swingTime + 0.10);
      swingSrc.connect(swingFilter);
      swingFilter.connect(swingGain);
      swingGain.connect(ctx.destination);
      swingSrc.start(swingTime);
      swingSrc.stop(swingTime + 0.11);

      // Subtle yoke stop click
      const stopOsc = ctx.createOscillator();
      const stopGain = ctx.createGain();
      stopOsc.type = 'triangle';
      stopOsc.frequency.setValueAtTime(1450 * pitchVar, swingTime + 0.04);
      stopOsc.frequency.exponentialRampToValueAtTime(520 * pitchVar, swingTime + 0.065);
      stopGain.gain.setValueAtTime(0.16 * vol, swingTime + 0.04);
      stopGain.gain.exponentialRampToValueAtTime(0.001, swingTime + 0.07);
      stopOsc.connect(stopGain);
      stopGain.connect(ctx.destination);
      stopOsc.start(swingTime + 0.04);
      stopOsc.stop(swingTime + 0.075);

      setTimeout(() => {
        try {
          latchSrc.disconnect(); latchFilter.disconnect(); latchGain.disconnect();
          swingSrc.disconnect(); swingFilter.disconnect(); swingGain.disconnect();
          stopOsc.disconnect(); stopGain.disconnect();
        } catch {}
      }, 240);
    } else {
      // 'close': Heavy steel cylinder crane snapping cleanly back into frame (no hammer cock)
      // 1. Solid steel frame seating thud
      const bodyOsc = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      bodyOsc.type = 'sine';
      bodyOsc.frequency.setValueAtTime(215 * pitchVar, now);
      bodyOsc.frequency.exponentialRampToValueAtTime(72 * pitchVar, now + 0.048);
      bodyGain.gain.setValueAtTime(0.48 * vol, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.002, now + 0.055);
      bodyOsc.connect(bodyGain);
      bodyGain.connect(ctx.destination);
      bodyOsc.start(now);
      bodyOsc.stop(now + 0.06);

      // 2. Crisp steel-on-steel crane snap
      const snapSrc = ctx.createBufferSource();
      snapSrc.buffer = makeNoise(0.055, 0.012);
      const snapFilter = ctx.createBiquadFilter();
      snapFilter.type = 'bandpass';
      snapFilter.frequency.setValueAtTime(1750 * pitchVar, now);
      snapFilter.frequency.exponentialRampToValueAtTime(880 * pitchVar, now + 0.045);
      snapFilter.Q.value = 3.0;
      const snapGain = ctx.createGain();
      snapGain.gain.setValueAtTime(0.55 * vol, now);
      snapGain.gain.exponentialRampToValueAtTime(0.002, now + 0.05);
      snapSrc.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(ctx.destination);
      snapSrc.start(now);
      snapSrc.stop(now + 0.055);

      // 3. Thumb latch spring lock detent click (+24ms)
      const lockTime = now + 0.024;
      const lockOsc = ctx.createOscillator();
      const lockGain = ctx.createGain();
      lockOsc.type = 'triangle';
      lockOsc.frequency.setValueAtTime(2550 * pitchVar, lockTime);
      lockOsc.frequency.exponentialRampToValueAtTime(980 * pitchVar, lockTime + 0.025);
      lockGain.gain.setValueAtTime(0.22 * vol, lockTime);
      lockGain.gain.exponentialRampToValueAtTime(0.001, lockTime + 0.03);
      lockOsc.connect(lockGain);
      lockGain.connect(ctx.destination);
      lockOsc.start(lockTime);
      lockOsc.stop(lockTime + 0.035);

      setTimeout(() => {
        try {
          bodyOsc.disconnect(); bodyGain.disconnect();
          snapSrc.disconnect(); snapFilter.disconnect(); snapGain.disconnect();
          lockOsc.disconnect(); lockGain.disconnect();
        } catch {}
      }, 180);
    }
  } catch {}
};

export const playPliersGripSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = globalMasterVolume;
    const pitchVar = 0.95 + Math.random() * 0.1;

    // Serrated steel jaws biting onto brass cartridge rim
    const biteLen = Math.floor(ctx.sampleRate * 0.045);
    const biteBuf = ctx.createBuffer(1, biteLen, ctx.sampleRate);
    const bd = biteBuf.getChannelData(0);
    for (let i = 0; i < biteLen; i++) {
      bd[i] = (Math.random() * 2 - 1) * Math.exp(-(i / ctx.sampleRate) / 0.011);
    }
    const biteSrc = ctx.createBufferSource();
    biteSrc.buffer = biteBuf;
    const biteFilter = ctx.createBiquadFilter();
    biteFilter.type = 'bandpass';
    biteFilter.frequency.setValueAtTime(2400 * pitchVar, now);
    biteFilter.frequency.exponentialRampToValueAtTime(1400 * pitchVar, now + 0.04);
    biteFilter.Q.value = 4.2;
    const biteGain = ctx.createGain();
    biteGain.gain.setValueAtTime(0.38 * vol, now);
    biteGain.gain.exponentialRampToValueAtTime(0.002, now + 0.042);
    biteSrc.connect(biteFilter);
    biteFilter.connect(biteGain);
    biteGain.connect(ctx.destination);
    biteSrc.start(now);
    biteSrc.stop(now + 0.045);

    const clinkOsc = ctx.createOscillator();
    const clinkGain = ctx.createGain();
    clinkOsc.type = 'triangle';
    clinkOsc.frequency.setValueAtTime(2150 * pitchVar, now);
    clinkOsc.frequency.exponentialRampToValueAtTime(1120 * pitchVar, now + 0.032);
    clinkGain.gain.setValueAtTime(0.18 * vol, now);
    clinkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    clinkOsc.connect(clinkGain);
    clinkGain.connect(ctx.destination);
    clinkOsc.start(now);
    clinkOsc.stop(now + 0.04);

    setTimeout(() => {
      try {
        biteSrc.disconnect(); biteFilter.disconnect(); biteGain.disconnect();
        clinkOsc.disconnect(); clinkGain.disconnect();
      } catch {}
    }, 150);
  } catch {}
};

export const playPliersSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = globalMasterVolume;
    const pitchVar = 0.94 + Math.random() * 0.12;

    // 1. Tight brass-on-steel chamber wall friction slide as shell is pried out
    const slideDur = 0.11;
    const slideLen = Math.floor(ctx.sampleRate * slideDur);
    const slideBuf = ctx.createBuffer(1, slideLen, ctx.sampleRate);
    const sd = slideBuf.getChannelData(0);
    for (let i = 0; i < slideLen; i++) {
      const t = i / ctx.sampleRate;
      const grit = 0.65 + 0.35 * Math.sin(t * 210);
      sd[i] = (Math.random() * 2 - 1) * grit * Math.exp(-t / 0.045);
    }
    const slideSrc = ctx.createBufferSource();
    slideSrc.buffer = slideBuf;
    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.setValueAtTime(2350 * pitchVar, now);
    slideFilter.frequency.exponentialRampToValueAtTime(1320 * pitchVar, now + slideDur);
    slideFilter.Q.value = 3.6;
    const slideGain = ctx.createGain();
    slideGain.gain.setValueAtTime(0.46 * vol, now);
    slideGain.gain.exponentialRampToValueAtTime(0.002, now + slideDur);
    slideSrc.connect(slideFilter);
    slideFilter.connect(slideGain);
    slideGain.connect(ctx.destination);
    slideSrc.start(now);
    slideSrc.stop(now + slideDur);

    // 2. Cartridge freeing pop & steel plier snap (+65ms)
    const popTime = now + 0.065;
    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(280 * pitchVar, popTime);
    popOsc.frequency.exponentialRampToValueAtTime(90 * pitchVar, popTime + 0.045);
    popGain.gain.setValueAtTime(0.32 * vol, popTime);
    popGain.gain.exponentialRampToValueAtTime(0.002, popTime + 0.05);
    popOsc.connect(popGain);
    popGain.connect(ctx.destination);
    popOsc.start(popTime);
    popOsc.stop(popTime + 0.055);

    const tinkOsc = ctx.createOscillator();
    const tinkGain = ctx.createGain();
    tinkOsc.type = 'triangle';
    tinkOsc.frequency.setValueAtTime(1820 * pitchVar, popTime);
    tinkOsc.frequency.exponentialRampToValueAtTime(1280 * pitchVar, popTime + 0.05);
    tinkGain.gain.setValueAtTime(0.24 * vol, popTime);
    tinkGain.gain.exponentialRampToValueAtTime(0.001, popTime + 0.055);
    tinkOsc.connect(tinkGain);
    tinkGain.connect(ctx.destination);
    tinkOsc.start(popTime);
    tinkOsc.stop(popTime + 0.06);

    // 3. Ejected brass cartridge clinking lightly on wooden table (+390ms, +520ms)
    [0.39, 0.52].forEach((delay, idx) => {
      const t = now + delay;
      const bScale = idx === 0 ? 1.0 : 0.45;
      const clink = ctx.createOscillator();
      const clinkG = ctx.createGain();
      clink.type = 'sine';
      clink.frequency.setValueAtTime((3450 + idx * 420) * pitchVar, t);
      clink.frequency.exponentialRampToValueAtTime(2600 * pitchVar, t + 0.055);
      clinkG.gain.setValueAtTime(0.14 * bScale * vol, t);
      clinkG.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      clink.connect(clinkG);
      clinkG.connect(ctx.destination);
      clink.start(t);
      clink.stop(t + 0.065);
    });

    setTimeout(() => {
      try {
        slideSrc.disconnect(); slideFilter.disconnect(); slideGain.disconnect();
        popOsc.disconnect(); popGain.disconnect();
        tinkOsc.disconnect(); tinkGain.disconnect();
      } catch {}
    }, 700);
  } catch {}
};

// Web Audio API Synthesizers for beautiful custom sounds!
const getAudioContext = (): AudioContext | null => {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!(window as any)._gameAudioCtx) {
    (window as any)._gameAudioCtx = new AudioContextClass();
  }
  const ctx = (window as any)._gameAudioCtx as AudioContext;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
};

let heartbeatPlaying = false;
let heartbeatInterval: number | null = null;

const synthHeartbeat = () => {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        
        // Thump 1
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60, now);
        osc.frequency.exponentialRampToValueAtTime(25, now + 0.1);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.8 * globalMasterVolume, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.2);
        vibrateGamepad('rumble', { duration: 150, weak: 0.6, strong: 0.15 });

        // Thump 2
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(65, now + 0.25);
        osc2.frequency.exponentialRampToValueAtTime(25, now + 0.35);
        gain2.gain.setValueAtTime(0, now + 0.23);
        gain2.gain.linearRampToValueAtTime(1.0 * globalMasterVolume, now + 0.27);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc2.start(now + 0.25);
        osc2.stop(now + 0.55);
        setTimeout(() => vibrateGamepad('rumble', { duration: 250, weak: 0.8, strong: 0.25 }), 250);
        
        setTimeout(() => {
          try { osc.disconnect(); gain.disconnect(); osc2.disconnect(); gain2.disconnect(); } catch(e){}
        }, 700);
    } catch(e) {}
};

export const setHeartbeatStatus = (active: boolean) => {
  if (active && !heartbeatPlaying) {
    heartbeatPlaying = true;
    synthHeartbeat();
    heartbeatInterval = window.setInterval(() => {
      if (heartbeatPlaying) synthHeartbeat();
    }, 1200);
  } else if (!active && heartbeatPlaying) {
    heartbeatPlaying = false;
    if (heartbeatInterval !== null) {
      window.clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }
};

export const playHeartbeat = () => {
  // We don't trigger one-offs anymore, we use setHeartbeatStatus for smooth looping
};

export const playBulletLoad = () => {
  playSound('load', true, 0.6);
};

export const playSyringeCap = () => {
  playSound('syringeCap', true, 0.85);
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // 1. Textured plastic-on-needle sheath friction slide
    const slideSize = Math.floor(ctx.sampleRate * 0.12);
    const slideBuf = ctx.createBuffer(1, slideSize, ctx.sampleRate);
    const sd = slideBuf.getChannelData(0);
    for (let i = 0; i < slideSize; i++) sd[i] = (Math.random() * 2 - 1) * (1 - i / slideSize);
    const slide = ctx.createBufferSource();
    slide.buffer = slideBuf;
    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.setValueAtTime(3200, now);
    slideFilter.frequency.exponentialRampToValueAtTime(1400, now + 0.1);
    slideFilter.Q.value = 3.0;
    const slideGain = ctx.createGain();
    slideGain.gain.setValueAtTime(0.45 * globalMasterVolume, now);
    slideGain.gain.exponentialRampToValueAtTime(0.01, now + 0.11);
    slide.connect(slideFilter);
    slideFilter.connect(slideGain);
    slideGain.connect(ctx.destination);
    slide.start(now);
    slide.stop(now + 0.12);

    // 2. Tactile rubber vacuum suction release pop ("POP-TINK")
    const popTime = now + 0.04;
    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(380, popTime);
    popOsc.frequency.exponentialRampToValueAtTime(80, popTime + 0.05);
    popGain.gain.setValueAtTime(0.7 * globalMasterVolume, popTime);
    popGain.gain.exponentialRampToValueAtTime(0.01, popTime + 0.06);
    popOsc.connect(popGain);
    popGain.connect(ctx.destination);
    popOsc.start(popTime);
    popOsc.stop(popTime + 0.07);

    // 3. Delicate surgical stainless steel needle tip ring
    const ringOsc = ctx.createOscillator();
    const ringGain = ctx.createGain();
    ringOsc.type = 'triangle';
    ringOsc.frequency.setValueAtTime(4200, popTime);
    ringOsc.frequency.exponentialRampToValueAtTime(2800, popTime + 0.12);
    ringGain.gain.setValueAtTime(0.3 * globalMasterVolume, popTime);
    ringGain.gain.exponentialRampToValueAtTime(0.001, popTime + 0.13);
    ringOsc.connect(ringGain);
    ringGain.connect(ctx.destination);
    ringOsc.start(popTime);
    ringOsc.stop(popTime + 0.14);

    setTimeout(() => {
      try {
        slide.disconnect(); slideFilter.disconnect(); slideGain.disconnect();
        popOsc.disconnect(); popGain.disconnect();
        ringOsc.disconnect(); ringGain.disconnect();
      } catch (err) {}
    }, 250);
  } catch (e) {
    console.warn("Synth cap sound failed:", e);
  }
};

export const playRazorSlice = () => {
  const s = getControllerSettings();
  if (s.bloodEffectsEnabled !== false) {
    playBloodImpactSplatter(0.72);
  }
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Cold high-carbon steel edge biting & scraping across taut tissue fibers (no tonal whistle)
    const scrapeDur = 0.34;
    const bufferSize = Math.floor(ctx.sampleRate * scrapeDur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < bufferSize; i++) {
      const t = i / ctx.sampleRate;
      const white = Math.random() * 2 - 1;
      // Fibrous resistance judders during drag across dermis
      const fiberCatch = 0.45 + 0.55 * Math.abs(Math.sin(t * 78 + Math.cos(t * 145) * 1.8));
      const pink = prev * 0.42 + white * 0.58;
      prev = pink;
      const env = Math.sin(Math.min(1, t / scrapeDur) * Math.PI);
      data[i] = Math.tanh(pink * fiberCatch * env * 1.9);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = 'bandpass';
    scrapeFilter.frequency.setValueAtTime(3400, now);
    scrapeFilter.frequency.exponentialRampToValueAtTime(1150, now + scrapeDur);
    scrapeFilter.Q.value = 1.85;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.01, now);
    noiseGain.gain.linearRampToValueAtTime(0.88 * globalMasterVolume, now + 0.035);
    noiseGain.gain.exponentialRampToValueAtTime(0.008, now + scrapeDur);

    noise.connect(scrapeFilter);
    scrapeFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);

    // 2. Wet sub-dermal fibrous tearing & capillary rupture (low-mid wet squelch noise, zero synth tones)
    const tearDur = 0.30;
    const tearBufSize = Math.floor(ctx.sampleRate * tearDur);
    const tearBuf = ctx.createBuffer(1, tearBufSize, ctx.sampleRate);
    const tearData = tearBuf.getChannelData(0);
    let prevT = 0;
    for (let i = 0; i < tearBufSize; i++) {
      const t = i / ctx.sampleRate;
      const white = Math.random() * 2 - 1;
      prevT = prevT * 0.78 + white * 0.22;
      const microSnap = Math.random() < 0.012 ? (Math.random() * 2 - 1) * 1.8 : 0;
      const env = Math.exp(-t / 0.11);
      tearData[i] = Math.tanh((prevT * 2.2 + microSnap) * env);
    }
    const tearSrc = ctx.createBufferSource();
    tearSrc.buffer = tearBuf;

    const tearFilter = ctx.createBiquadFilter();
    tearFilter.type = 'bandpass';
    tearFilter.frequency.setValueAtTime(620, now + 0.02);
    tearFilter.frequency.exponentialRampToValueAtTime(210, now + tearDur);
    tearFilter.Q.value = 1.4;

    const tearGain = ctx.createGain();
    tearGain.gain.setValueAtTime(0.95 * globalMasterVolume, now + 0.02);
    tearGain.gain.exponentialRampToValueAtTime(0.005, now + tearDur);

    tearSrc.connect(tearFilter);
    tearFilter.connect(tearGain);
    tearGain.connect(ctx.destination);
    tearSrc.start(now + 0.02);

    setTimeout(() => {
      try {
        noise.disconnect(); scrapeFilter.disconnect(); noiseGain.disconnect();
        tearSrc.disconnect(); tearFilter.disconnect(); tearGain.disconnect();
      } catch (e) {}
    }, 450);
  } catch (e) {
    console.warn("Razor slice sound failed:", e);
  }
};

export const playMirrorInspect = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const masterVol = globalMasterVolume;

    // Dynamic variation for organic realism on every inspection
    const pitchVar = 0.95 + Math.random() * 0.10;
    const sparkleSeed = Math.random();

    // 1. Tactile brushed brass handle lift & felt friction scrape
    const bufSize = Math.floor(ctx.sampleRate * 0.32);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.09));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800 * pitchVar, now);
    filter.frequency.exponentialRampToValueAtTime(650 * pitchVar, now + 0.28);
    filter.Q.value = 3.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.38 * masterVol, now + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.32);

    // 2. Dynamic Optical Light Catch & Prismatic Lens Sweep
    // A sweeping resonant filter that opens as the mirror catches the light angle
    const sweepBufSize = Math.floor(ctx.sampleRate * 0.45);
    const sweepBuf = ctx.createBuffer(1, sweepBufSize, ctx.sampleRate);
    const sd = sweepBuf.getChannelData(0);
    for (let i = 0; i < sweepBufSize; i++) {
      const env = Math.sin((i / sweepBufSize) * Math.PI);
      sd[i] = (Math.random() * 2 - 1) * Math.pow(env, 2);
    }
    const sweepNoise = ctx.createBufferSource();
    sweepNoise.buffer = sweepBuf;
    const sweepFilter = ctx.createBiquadFilter();
    sweepFilter.type = 'bandpass';
    sweepFilter.frequency.setValueAtTime(2200 * pitchVar, now + 0.04);
    sweepFilter.frequency.exponentialRampToValueAtTime(5400 * pitchVar, now + 0.22);
    sweepFilter.frequency.exponentialRampToValueAtTime(3200 * pitchVar, now + 0.45);
    sweepFilter.Q.value = 7.5;
    const sweepGain = ctx.createGain();
    sweepGain.gain.setValueAtTime(0, now + 0.04);
    sweepGain.gain.linearRampToValueAtTime(0.28 * masterVol, now + 0.20);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
    sweepNoise.connect(sweepFilter);
    sweepFilter.connect(sweepGain);
    sweepGain.connect(ctx.destination);
    sweepNoise.start(now + 0.04);
    sweepNoise.stop(now + 0.48);

    // 3. Multi-Harmonic Crystalline Glass Bell Ring (Pristine optical glint)
    const glassHarmonics = [
      { freq: 3136 * pitchVar, gain: 0.32, decay: 0.65 }, // High G7
      { freq: 4186 * pitchVar, gain: 0.24, decay: 0.50 }, // C8
      { freq: 5587 * pitchVar, gain: 0.18, decay: 0.38 }, // F8
      { freq: 7040 * pitchVar, gain: 0.12, decay: 0.25 }, // A8
    ];

    glassHarmonics.forEach((h, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(h.freq, now + 0.06);
      osc.frequency.exponentialRampToValueAtTime(h.freq * 0.985, now + 0.06 + h.decay);

      g.gain.setValueAtTime(0, now + 0.06);
      g.gain.linearRampToValueAtTime(h.gain * masterVol, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.06 + h.decay);

      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now + 0.06);
      osc.stop(now + 0.06 + h.decay + 0.05);
    });

    // 4. Sparkling Micro-Granule Cascade (Cascading photonic specular sparkles)
    const sparkleCount = 5;
    for (let s = 0; s < sparkleCount; s++) {
      const sparkleDelay = 0.08 + s * 0.045 + (Math.random() * 0.015);
      const sparkleFreq = (4400 + s * 750 + sparkleSeed * 400) * pitchVar;
      const spOsc = ctx.createOscillator();
      const spGain = ctx.createGain();
      spOsc.type = 'sine';
      spOsc.frequency.setValueAtTime(sparkleFreq, now + sparkleDelay);
      spOsc.frequency.exponentialRampToValueAtTime(sparkleFreq * 1.12, now + sparkleDelay + 0.08);

      spGain.gain.setValueAtTime(0, now + sparkleDelay);
      spGain.gain.linearRampToValueAtTime((0.15 - s * 0.02) * masterVol, now + sparkleDelay + 0.008);
      spGain.gain.exponentialRampToValueAtTime(0.0005, now + sparkleDelay + 0.09);

      spOsc.connect(spGain);
      spGain.connect(ctx.destination);
      spOsc.start(now + sparkleDelay);
      spOsc.stop(now + sparkleDelay + 0.1);
    }

    // 5. Eerie Chamber Cavity Resonance (Dark internal cylinder revelation hum)
    const hum = ctx.createOscillator();
    const humGain = ctx.createGain();
    const humLfo = ctx.createOscillator();
    const humLfoGain = ctx.createGain();
    humLfo.type = 'sine';
    humLfo.frequency.value = 5.2; // Shimmering vibrato
    humLfoGain.gain.value = 14;
    humLfo.connect(hum.frequency);

    hum.type = 'sine';
    hum.frequency.setValueAtTime(520 * pitchVar, now + 0.05);
    hum.frequency.exponentialRampToValueAtTime(360 * pitchVar, now + 0.75);

    humGain.gain.setValueAtTime(0, now + 0.05);
    humGain.gain.linearRampToValueAtTime(0.32 * masterVol, now + 0.18);
    humGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    hum.connect(humGain);
    humGain.connect(ctx.destination);
    humLfo.start(now + 0.05);
    hum.start(now + 0.05);
    hum.stop(now + 0.9);
    humLfo.stop(now + 0.9);

  } catch (e) {
    console.warn("Mirror inspect sound failed:", e);
  }
};

export const playWhiskeyDrink = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Bottle glass lift / wooden table friction slide
    const slideSize = Math.floor(ctx.sampleRate * 0.2);
    const slideBuf = ctx.createBuffer(1, slideSize, ctx.sampleRate);
    const sData = slideBuf.getChannelData(0);
    for (let i = 0; i < slideSize; i++) {
      sData[i] = (Math.random() * 2 - 1) * (1 - i / slideSize);
    }
    const slide = ctx.createBufferSource();
    slide.buffer = slideBuf;
    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.setValueAtTime(450, now);
    slideFilter.Q.value = 2.0;
    const slideGain = ctx.createGain();
    slideGain.gain.setValueAtTime(0.35 * globalMasterVolume, now);
    slideGain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
    slide.connect(slideFilter);
    slideFilter.connect(slideGain);
    slideGain.connect(ctx.destination);
    slide.start(now);
    slide.stop(now + 0.2);

    // 2. Cork friction squeak
    const corkSqueak = ctx.createOscillator();
    const corkSqueakGain = ctx.createGain();
    corkSqueak.type = 'triangle';
    corkSqueak.frequency.setValueAtTime(320, now + 0.1);
    corkSqueak.frequency.exponentialRampToValueAtTime(680, now + 0.22);
    corkSqueakGain.gain.setValueAtTime(0, now + 0.1);
    corkSqueakGain.gain.linearRampToValueAtTime(0.28 * globalMasterVolume, now + 0.16);
    corkSqueakGain.gain.exponentialRampToValueAtTime(0.01, now + 0.23);
    corkSqueak.connect(corkSqueakGain);
    corkSqueakGain.connect(ctx.destination);
    corkSqueak.start(now + 0.1);
    corkSqueak.stop(now + 0.24);

    // 3. Deep vacuum cork pop ("THWUMP-POP")
    const popTime = now + 0.24;
    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(180, popTime);
    popOsc.frequency.exponentialRampToValueAtTime(35, popTime + 0.14);
    popGain.gain.setValueAtTime(0, popTime);
    popGain.gain.linearRampToValueAtTime(0.95 * globalMasterVolume, popTime + 0.01);
    popGain.gain.exponentialRampToValueAtTime(0.001, popTime + 0.16);
    popOsc.connect(popGain);
    popGain.connect(ctx.destination);
    popOsc.start(popTime);
    popOsc.stop(popTime + 0.18);

    // Pop high-frequency cavity burst
    const popNoiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
    const pnData = popNoiseBuf.getChannelData(0);
    for (let i = 0; i < pnData.length; i++) pnData[i] = Math.random() * 2 - 1;
    const popNoise = ctx.createBufferSource();
    popNoise.buffer = popNoiseBuf;
    const popNFilter = ctx.createBiquadFilter();
    popNFilter.type = 'bandpass';
    popNFilter.frequency.value = 1100;
    popNFilter.Q.value = 3.0;
    const popNGain = ctx.createGain();
    popNGain.gain.setValueAtTime(0.6 * globalMasterVolume, popTime);
    popNGain.gain.exponentialRampToValueAtTime(0.01, popTime + 0.07);
    popNoise.connect(popNFilter);
    popNFilter.connect(popNGain);
    popNGain.connect(ctx.destination);
    popNoise.start(popTime);
    popNoise.stop(popTime + 0.08);

    // 4. Staggered visceral liquid glugs / pouring bubbles
    const glugTimes = [popTime + 0.22, popTime + 0.45, popTime + 0.68, popTime + 0.92];
    const glugFreqs = [440, 390, 480, 360];

    glugTimes.forEach((gTime, idx) => {
      const gOsc = ctx.createOscillator();
      const gGain = ctx.createGain();
      gOsc.type = 'sine';
      gOsc.frequency.setValueAtTime(glugFreqs[idx], gTime);
      gOsc.frequency.exponentialRampToValueAtTime(glugFreqs[idx] * 0.65, gTime + 0.12);
      gGain.gain.setValueAtTime(0, gTime);
      gGain.gain.linearRampToValueAtTime(0.4 * globalMasterVolume, gTime + 0.02);
      gGain.gain.exponentialRampToValueAtTime(0.001, gTime + 0.14);
      gOsc.connect(gGain);
      gGain.connect(ctx.destination);
      gOsc.start(gTime);
      gOsc.stop(gTime + 0.15);

      // Bubble splash noise
      const gNBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
      const gnd = gNBuf.getChannelData(0);
      for (let i = 0; i < gnd.length; i++) gnd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03));
      const gNSource = ctx.createBufferSource();
      gNSource.buffer = gNBuf;
      const gNFilter = ctx.createBiquadFilter();
      gNFilter.type = 'lowpass';
      gNFilter.frequency.value = 1400;
      const gNGain = ctx.createGain();
      gNGain.gain.setValueAtTime(0.2 * globalMasterVolume, gTime);
      gNGain.gain.exponentialRampToValueAtTime(0.001, gTime + 0.09);
      gNSource.connect(gNFilter);
      gNFilter.connect(gNGain);
      gNGain.connect(ctx.destination);
      gNSource.start(gTime);
      gNSource.stop(gTime + 0.1);
    });

    // 5. Heavy visceral swallowing gulp & burning ethanol throat sigh
    const gulpTime = popTime + 1.15;
    const gulpOsc = ctx.createOscillator();
    const gulpGain = ctx.createGain();
    gulpOsc.type = 'sine';
    gulpOsc.frequency.setValueAtTime(190, gulpTime);
    gulpOsc.frequency.exponentialRampToValueAtTime(55, gulpTime + 0.25);
    gulpGain.gain.setValueAtTime(0, gulpTime);
    gulpGain.gain.linearRampToValueAtTime(0.7 * globalMasterVolume, gulpTime + 0.04);
    gulpGain.gain.exponentialRampToValueAtTime(0.01, gulpTime + 0.28);
    gulpOsc.connect(gulpGain);
    gulpGain.connect(ctx.destination);
    gulpOsc.start(gulpTime);
    gulpOsc.stop(gulpTime + 0.3);

    // Warm ethanol throat exhale/gasp
    const gaspTime = gulpTime + 0.22;
    const gaspBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
    const gd = gaspBuf.getChannelData(0);
    for (let i = 0; i < gd.length; i++) gd[i] = Math.random() * 2 - 1;
    const gasp = ctx.createBufferSource();
    gasp.buffer = gaspBuf;
    const gaspFilter = ctx.createBiquadFilter();
    gaspFilter.type = 'lowpass';
    gaspFilter.frequency.setValueAtTime(550, gaspTime);
    gaspFilter.frequency.linearRampToValueAtTime(250, gaspTime + 0.55);
    const gaspGain = ctx.createGain();
    gaspGain.gain.setValueAtTime(0, gaspTime);
    gaspGain.gain.linearRampToValueAtTime(0.35 * globalMasterVolume, gaspTime + 0.1);
    gaspGain.gain.exponentialRampToValueAtTime(0.001, gaspTime + 0.58);
    gasp.connect(gaspFilter);
    gaspFilter.connect(gaspGain);
    gaspGain.connect(ctx.destination);
    gasp.start(gaspTime);
    gasp.stop(gaspTime + 0.6);

  } catch (e) {
    console.warn("Whiskey drink sound failed:", e);
  }
};

export const playTourniquetTighten = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Heavy canvas/elastic strap stretching friction
    const strapSize = Math.floor(ctx.sampleRate * 0.5);
    const strapBuf = ctx.createBuffer(1, strapSize, ctx.sampleRate);
    const sd = strapBuf.getChannelData(0);
    for (let i = 0; i < strapSize; i++) {
      sd[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(i * 0.08));
    }
    const strap = ctx.createBufferSource();
    strap.buffer = strapBuf;
    const strapFilter = ctx.createBiquadFilter();
    strapFilter.type = 'bandpass';
    strapFilter.frequency.setValueAtTime(600, now);
    strapFilter.frequency.exponentialRampToValueAtTime(2200, now + 0.45);
    strapFilter.Q.value = 3.5;
    const strapGain = ctx.createGain();
    strapGain.gain.setValueAtTime(0, now);
    strapGain.gain.linearRampToValueAtTime(0.7 * globalMasterVolume, now + 0.15);
    strapGain.gain.exponentialRampToValueAtTime(0.01, now + 0.48);
    strap.connect(strapFilter);
    strapFilter.connect(strapGain);
    strapGain.connect(ctx.destination);
    strap.start(now);
    strap.stop(now + 0.5);

    // 2. High-tension ratcheting clamp clicks (3 progressive mechanical tooth clicks)
    const clickTimes = [now + 0.12, now + 0.26, now + 0.40];
    const clickFreqs = [1100, 1350, 1650];

    clickTimes.forEach((cTime, idx) => {
      const cOsc = ctx.createOscillator();
      const cGain = ctx.createGain();
      cOsc.type = 'triangle';
      cOsc.frequency.setValueAtTime(clickFreqs[idx], cTime);
      cOsc.frequency.exponentialRampToValueAtTime(250, cTime + 0.04);
      cGain.gain.setValueAtTime(0, cTime);
      cGain.gain.linearRampToValueAtTime(0.55 * globalMasterVolume, cTime + 0.005);
      cGain.gain.exponentialRampToValueAtTime(0.001, cTime + 0.05);
      cOsc.connect(cGain);
      cGain.connect(ctx.destination);
      cOsc.start(cTime);
      cOsc.stop(cTime + 0.06);
    });

    // 3. Bone-crushing vascular compression sub-thump & tension snap
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(100, now + 0.42);
    thump.frequency.exponentialRampToValueAtTime(28, now + 0.7);
    thumpGain.gain.setValueAtTime(0, now + 0.42);
    thumpGain.gain.linearRampToValueAtTime(0.85 * globalMasterVolume, now + 0.45);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    thump.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thump.start(now + 0.42);
    thump.stop(now + 0.8);

  } catch (e) {
    console.warn("Tourniquet sound failed:", e);
  }
};

export const playPentagramChant = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Abyssal sub-bass demonic drone with 3.5Hz beating infrasound pulse
    const drone1 = ctx.createOscillator();
    const drone2 = ctx.createOscillator();
    const droneGain = ctx.createGain();
    drone1.type = 'sawtooth';
    drone2.type = 'sawtooth';
    drone1.frequency.setValueAtTime(38, now);
    drone2.frequency.setValueAtTime(41.5, now);

    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowpass';
    lowFilter.frequency.setValueAtTime(120, now);
    lowFilter.frequency.linearRampToValueAtTime(240, now + 0.8);
    lowFilter.frequency.exponentialRampToValueAtTime(60, now + 1.8);

    droneGain.gain.setValueAtTime(0, now);
    droneGain.gain.linearRampToValueAtTime(0.8 * globalMasterVolume, now + 0.3);
    droneGain.gain.exponentialRampToValueAtTime(0.001, now + 1.85);

    drone1.connect(lowFilter);
    drone2.connect(lowFilter);
    lowFilter.connect(droneGain);
    droneGain.connect(ctx.destination);
    drone1.start(now);
    drone2.start(now);
    drone1.stop(now + 1.9);
    drone2.stop(now + 1.9);

    // 2. Dissonant spectral chorus screech (FM synthesis demonic overtones)
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const chorusGain = ctx.createGain();

    carrier.type = 'triangle';
    carrier.frequency.setValueAtTime(666, now + 0.15);
    carrier.frequency.exponentialRampToValueAtTime(333, now + 1.4);

    modulator.type = 'sawtooth';
    modulator.frequency.setValueAtTime(133, now + 0.15);
    modulator.frequency.linearRampToValueAtTime(88, now + 1.4);

    modGain.gain.setValueAtTime(450, now + 0.15);
    modGain.gain.linearRampToValueAtTime(800, now + 0.8);
    modGain.gain.exponentialRampToValueAtTime(10, now + 1.4);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    chorusGain.gain.setValueAtTime(0, now + 0.15);
    chorusGain.gain.linearRampToValueAtTime(0.45 * globalMasterVolume, now + 0.4);
    chorusGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    carrier.connect(chorusGain);
    chorusGain.connect(ctx.destination);
    modulator.start(now + 0.15);
    carrier.start(now + 0.15);
    modulator.stop(now + 1.55);
    carrier.stop(now + 1.55);

    // 3. Swirling blood vortex and hellish soul-swap rush
    const vSize = Math.floor(ctx.sampleRate * 1.5);
    const vBuf = ctx.createBuffer(1, vSize, ctx.sampleRate);
    const vd = vBuf.getChannelData(0);
    for (let i = 0; i < vSize; i++) {
      vd[i] = (Math.random() * 2 - 1);
    }
    const vortex = ctx.createBufferSource();
    vortex.buffer = vBuf;
    const vFilter = ctx.createBiquadFilter();
    vFilter.type = 'bandpass';
    vFilter.frequency.setValueAtTime(250, now + 0.2);
    vFilter.frequency.exponentialRampToValueAtTime(1800, now + 0.9);
    vFilter.frequency.exponentialRampToValueAtTime(300, now + 1.6);
    vFilter.Q.value = 6.0;

    const vGain = ctx.createGain();
    vGain.gain.setValueAtTime(0, now + 0.2);
    vGain.gain.linearRampToValueAtTime(0.65 * globalMasterVolume, now + 0.6);
    vGain.gain.exponentialRampToValueAtTime(0.001, now + 1.7);

    vortex.connect(vFilter);
    vFilter.connect(vGain);
    vGain.connect(ctx.destination);
    vortex.start(now + 0.2);
    vortex.stop(now + 1.75);

  } catch (e) {
    console.warn("Pentagram chant sound failed:", e);
  }
};

export const playDefibrillatorShock = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. High-voltage capacitor charging whine (180Hz -> 4800Hz exponential charge)
    const chargeOsc = ctx.createOscillator();
    const chargeGain = ctx.createGain();
    chargeOsc.type = 'sawtooth';
    chargeOsc.frequency.setValueAtTime(180, now);
    chargeOsc.frequency.exponentialRampToValueAtTime(4600, now + 0.82);

    const chargeFilter = ctx.createBiquadFilter();
    chargeFilter.type = 'lowpass';
    chargeFilter.frequency.setValueAtTime(800, now);
    chargeFilter.frequency.exponentialRampToValueAtTime(6000, now + 0.82);

    chargeGain.gain.setValueAtTime(0.05 * globalMasterVolume, now);
    chargeGain.gain.exponentialRampToValueAtTime(0.65 * globalMasterVolume, now + 0.8);
    chargeGain.gain.linearRampToValueAtTime(0.001, now + 0.84);

    chargeOsc.connect(chargeFilter);
    chargeFilter.connect(chargeGain);
    chargeGain.connect(ctx.destination);
    chargeOsc.start(now);
    chargeOsc.stop(now + 0.85);

    // 2. Heavy mechanical solenoid / relay trip CLACK at 0.84s
    const relayTime = now + 0.84;
    const relay = ctx.createOscillator();
    const relayGain = ctx.createGain();
    relay.type = 'triangle';
    relay.frequency.setValueAtTime(2200, relayTime);
    relay.frequency.exponentialRampToValueAtTime(200, relayTime + 0.03);
    relayGain.gain.setValueAtTime(0.8 * globalMasterVolume, relayTime);
    relayGain.gain.exponentialRampToValueAtTime(0.01, relayTime + 0.04);
    relay.connect(relayGain);
    relayGain.connect(ctx.destination);
    relay.start(relayTime);
    relay.stop(relayTime + 0.05);

    // 3. Massive 1000V electrical arc discharge explosive punch ("CRACK-BOOM")
    const zapTime = relayTime + 0.02;

    // Explosive sub-bass chest thump
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(130, zapTime);
    sub.frequency.exponentialRampToValueAtTime(24, zapTime + 0.4);
    subGain.gain.setValueAtTime(1.2 * globalMasterVolume, zapTime);
    subGain.gain.exponentialRampToValueAtTime(0.001, zapTime + 0.45);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(zapTime);
    sub.stop(zapTime + 0.5);

    // 60Hz buzzing mains hum arc
    const hum = ctx.createOscillator();
    const humGain = ctx.createGain();
    hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(60, zapTime);
    humGain.gain.setValueAtTime(0.9 * globalMasterVolume, zapTime);
    humGain.gain.exponentialRampToValueAtTime(0.01, zapTime + 0.22);
    hum.connect(humGain);
    humGain.connect(ctx.destination);
    hum.start(zapTime);
    hum.stop(zapTime + 0.25);

    // High energy electric spark explosion / plasma crackle
    const sparkSize = Math.floor(ctx.sampleRate * 0.4);
    const sparkBuf = ctx.createBuffer(1, sparkSize, ctx.sampleRate);
    const spd = sparkBuf.getChannelData(0);
    for (let i = 0; i < sparkSize; i++) {
      spd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
    }
    const spark = ctx.createBufferSource();
    spark.buffer = sparkBuf;
    const sparkFilter = ctx.createBiquadFilter();
    sparkFilter.type = 'highpass';
    sparkFilter.frequency.value = 1800;
    const sparkGain = ctx.createGain();
    sparkGain.gain.setValueAtTime(1.0 * globalMasterVolume, zapTime);
    sparkGain.gain.exponentialRampToValueAtTime(0.001, zapTime + 0.35);
    spark.connect(sparkFilter);
    sparkFilter.connect(sparkGain);
    sparkGain.connect(ctx.destination);
    spark.start(zapTime);
    spark.stop(zapTime + 0.38);

  } catch (e) {
    console.warn("Defibrillator sound failed:", e);
  }
};

export const playMedkitOpen = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Heavy industrial steel latches snapping open ("CLINK-CLACK")
    const latchTimes = [now, now + 0.085];
    const latchFreqs = [2600, 2050];
    latchTimes.forEach((lTime, idx) => {
      const lOsc = ctx.createOscillator();
      const lGain = ctx.createGain();
      lOsc.type = 'triangle';
      lOsc.frequency.setValueAtTime(latchFreqs[idx], lTime);
      lOsc.frequency.exponentialRampToValueAtTime(420, lTime + 0.045);
      lGain.gain.setValueAtTime(0.62 * globalMasterVolume, lTime);
      lGain.gain.exponentialRampToValueAtTime(0.008, lTime + 0.055);
      lOsc.connect(lGain);
      lGain.connect(ctx.destination);
      lOsc.start(lTime);
      lOsc.stop(lTime + 0.065);
    });

    // 2. Hinged painted-steel lid swinging open with subtle dry hinge creak
    const hingeSize = Math.floor(ctx.sampleRate * 0.28);
    const hingeBuf = ctx.createBuffer(1, hingeSize, ctx.sampleRate);
    const hd = hingeBuf.getChannelData(0);
    for (let i = 0; i < hingeSize; i++) hd[i] = (Math.random() * 2 - 1) * (1 - i / hingeSize);
    const hinge = ctx.createBufferSource();
    hinge.buffer = hingeBuf;
    const hingeFilter = ctx.createBiquadFilter();
    hingeFilter.type = 'bandpass';
    hingeFilter.frequency.setValueAtTime(750, now + 0.10);
    hingeFilter.frequency.exponentialRampToValueAtTime(1350, now + 0.34);
    hingeFilter.Q.value = 3.8;
    const hingeGain = ctx.createGain();
    hingeGain.gain.setValueAtTime(0.38 * globalMasterVolume, now + 0.10);
    hingeGain.gain.exponentialRampToValueAtTime(0.008, now + 0.36);
    hinge.connect(hingeFilter);
    hingeFilter.connect(hingeGain);
    hingeGain.connect(ctx.destination);
    hinge.start(now + 0.10);
    hinge.stop(now + 0.38);
  } catch (e) {
    console.warn("Medkit open sound failed:", e);
  }
};

export type MedkitSupplyStage =
  | 'SET_DOWN'
  | 'UNLATCH_L'
  | 'UNLATCH_R'
  | 'OPEN_LID'
  | 'SPRAY_SHAKE'
  | 'SPRAY'
  | 'GAUZE_RIP'
  | 'GAUZE_WRAP'
  | 'PILL_CAP'
  | 'PILL_POUR'
  | 'SWALLOW'
  | 'CLOSE';

export const playMedkitSupplySound = (stage: MedkitSupplyStage) => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const mv = globalMasterVolume;

    const triggerNoise = (
      startOffset: number,
      dur: number,
      filterType: BiquadFilterType,
      freqStart: number,
      freqEnd: number,
      q: number,
      peakGain: number,
      attack: number = 0.012,
      sparseMask: number = 1.0
    ) => {
      const sz = Math.max(64, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, sz, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < sz; i++) {
        d[i] = Math.random() <= sparseMask ? Math.random() * 2 - 1 : 0;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const flt = ctx.createBiquadFilter();
      flt.type = filterType;
      flt.frequency.setValueAtTime(freqStart, now + startOffset);
      if (freqEnd !== freqStart) {
        flt.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), now + startOffset + dur);
      }
      flt.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + startOffset);
      g.gain.linearRampToValueAtTime(Math.max(0.0005, peakGain * mv), now + startOffset + Math.min(attack, dur * 0.4));
      g.gain.exponentialRampToValueAtTime(0.0005, now + startOffset + dur);
      src.connect(flt);
      flt.connect(g);
      g.connect(ctx.destination);
      src.start(now + startOffset);
      src.stop(now + startOffset + dur + 0.02);
    };

    const triggerImpact = (
      startOffset: number,
      dur: number,
      type: OscillatorType,
      freqStart: number,
      freqEnd: number,
      peakGain: number
    ) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, now + startOffset);
      osc.frequency.exponentialRampToValueAtTime(Math.max(24, freqEnd), now + startOffset + dur);
      g.gain.setValueAtTime(Math.max(0.0005, peakGain * mv), now + startOffset);
      g.gain.exponentialRampToValueAtTime(0.0005, now + startOffset + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + dur + 0.015);
    };

    if (stage === 'SET_DOWN') {
      // Heavy stamped-steel base contacting solid oak table + brief internal tray settle
      triggerImpact(0, 0.085, 'triangle', 128, 44, 0.56);
      triggerNoise(0, 0.045, 'bandpass', 680, 320, 1.4, 0.34, 0.003);
      triggerNoise(0.042, 0.06, 'bandpass', 1150, 740, 2.1, 0.16, 0.005);
    } else if (stage === 'UNLATCH_L' || stage === 'UNLATCH_R') {
      const f = stage === 'UNLATCH_L' ? 2450 : 2180;
      triggerNoise(0, 0.022, 'bandpass', f * 0.7, f, 2.2, 0.32, 0.002);
      triggerImpact(0.008, 0.038, 'triangle', f, 410, 0.44);
    } else if (stage === 'OPEN_LID') {
      // Rubber gasket unseal + slow dry painted-steel hinge creak + soft open stop
      triggerNoise(0, 0.055, 'lowpass', 520, 220, 0.8, 0.22, 0.006);
      triggerNoise(0.04, 0.34, 'bandpass', 720, 1280, 4.2, 0.30, 0.03);
      triggerImpact(0.35, 0.045, 'triangle', 195, 78, 0.16);
    } else if (stage === 'SPRAY_SHAKE') {
      // Two crisp aluminum-canister liquid slosh + steel agitator ball taps
      triggerImpact(0.0, 0.024, 'triangle', 2750, 1450, 0.24);
      triggerNoise(0.0, 0.09, 'bandpass', 980, 680, 1.8, 0.24, 0.015);
      triggerImpact(0.13, 0.024, 'triangle', 2920, 1520, 0.22);
      triggerNoise(0.13, 0.09, 'bandpass', 1040, 720, 1.8, 0.22, 0.015);
    } else if (stage === 'SPRAY') {
      // Crisp nozzle press click + pressurized wet antiseptic mist spray
      triggerImpact(0, 0.025, 'triangle', 1780, 520, 0.30);
      triggerNoise(0.014, 0.26, 'bandpass', 4500, 3150, 1.8, 0.38, 0.018);
    } else if (stage === 'GAUZE_RIP') {
      // Sterile paper/foil wrapper rip + first strip pull
      triggerNoise(0, 0.22, 'highpass', 2850, 3600, 0.9, 0.36, 0.02, 0.36);
      triggerNoise(0.12, 0.20, 'bandpass', 1350, 950, 1.5, 0.22, 0.03);
    } else if (stage === 'GAUZE_WRAP') {
      // Deliberate two-pass woven cotton friction + tuck press click
      triggerNoise(0.0, 0.32, 'bandpass', 820, 680, 1.4, 0.30, 0.06);
      triggerNoise(0.36, 0.34, 'bandpass', 880, 710, 1.4, 0.32, 0.06);
      triggerImpact(0.72, 0.028, 'triangle', 1550, 560, 0.18);
    } else if (stage === 'PILL_CAP') {
      // Childproof push-down ratchet turn + hollow plastic cap pop + bottle shake
      triggerImpact(0.0, 0.022, 'triangle', 980, 360, 0.22);
      triggerImpact(0.08, 0.020, 'triangle', 1120, 410, 0.20);
      triggerImpact(0.18, 0.048, 'sine', 430, 145, 0.42);
      triggerNoise(0.18, 0.035, 'bandpass', 1500, 900, 1.5, 0.20, 0.004);
    } else if (stage === 'PILL_POUR') {
      // Tablets tumbling against plastic neck + two dry chalky tablet taps onto palm
      triggerNoise(0.0, 0.14, 'bandpass', 1650, 1100, 2.0, 0.18, 0.02);
      triggerImpact(0.07, 0.022, 'triangle', 2780, 1180, 0.24);
      triggerImpact(0.16, 0.020, 'triangle', 3120, 1340, 0.22);
    } else if (stage === 'SWALLOW') {
      // Muted dry throat swallow gulp + soft nasal exhale
      triggerImpact(0.04, 0.09, 'sine', 185, 62, 0.26);
      triggerNoise(0.16, 0.24, 'bandpass', 540, 360, 1.2, 0.15, 0.04);
    } else if (stage === 'CLOSE') {
      // Gasketed steel lid thud + staggered left/right clasp snaps
      triggerImpact(0, 0.085, 'triangle', 175, 48, 0.56);
      triggerNoise(0, 0.055, 'lowpass', 620, 240, 0.8, 0.26, 0.004);
      triggerImpact(0.095, 0.040, 'triangle', 2250, 520, 0.40);
      triggerImpact(0.185, 0.040, 'triangle', 2020, 480, 0.38);
    }
  } catch (e) {
    console.warn("Medkit supply sound failed:", e);
  }
};

export const playScalpelCut = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const masterVol = globalMasterVolume;

    // 1. Tactile metal blade seating click against the gun barrel
    const clickBufSize = Math.floor(ctx.sampleRate * 0.04);
    const clickBuf = ctx.createBuffer(1, clickBufSize, ctx.sampleRate);
    const clickData = clickBuf.getChannelData(0);
    for (let i = 0; i < clickBufSize; i++) {
      clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
    }
    const clickNoise = ctx.createBufferSource();
    clickNoise.buffer = clickBuf;
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = 1400;
    clickFilter.Q.value = 3.0;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.35 * masterVol, now + 0.05);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    clickNoise.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickNoise.start(now + 0.05);
    clickNoise.stop(now + 0.10);

    // 2. Gritty abrasive metal sawing strokes (filtered industrial friction noise, zero musical tones)
    const strokeTimes = [0.15, 0.42, 0.70, 0.98];
    strokeTimes.forEach((st, idx) => {
      const strokeStart = now + st;
      const strokeDur = 0.20;
      const strokeBufSize = Math.floor(ctx.sampleRate * strokeDur);
      const strokeBuf = ctx.createBuffer(1, strokeBufSize, ctx.sampleRate);
      const sData = strokeBuf.getChannelData(0);
      for (let i = 0; i < strokeBufSize; i++) {
        const progress = i / strokeBufSize;
        const envelope = Math.sin(progress * Math.PI);
        // Heavy abrasive rasping metal teeth friction
        sData[i] = (Math.random() * 2 - 1) * Math.pow(envelope, 1.2) * (0.75 + 0.25 * Math.sin(i * 0.2));
      }

      const sNoise = ctx.createBufferSource();
      sNoise.buffer = strokeBuf;
      const sFilter = ctx.createBiquadFilter();
      sFilter.type = 'bandpass';
      const baseFreq = 1600 + (idx % 2) * 250;
      sFilter.frequency.setValueAtTime(baseFreq, strokeStart);
      sFilter.frequency.linearRampToValueAtTime(baseFreq + 300, strokeStart + strokeDur * 0.5);
      sFilter.frequency.linearRampToValueAtTime(baseFreq, strokeStart + strokeDur);
      sFilter.Q.value = 4.0;

      const sGain = ctx.createGain();
      sGain.gain.setValueAtTime(0, strokeStart);
      sGain.gain.linearRampToValueAtTime((0.45 + idx * 0.05) * masterVol, strokeStart + strokeDur * 0.3);
      sGain.gain.exponentialRampToValueAtTime(0.001, strokeStart + strokeDur);

      sNoise.connect(sFilter);
      sFilter.connect(sGain);
      sGain.connect(ctx.destination);
      sNoise.start(strokeStart);
      sNoise.stop(strokeStart + strokeDur + 0.02);
    });

    // 3. Heavy industrial metal fracture snap & barrel shear (instant t=1.28s)
    const snapTime = now + 1.28;
    
    // Low-end concussive table jolt
    const thumpOsc = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thumpOsc.type = 'triangle';
    thumpOsc.frequency.setValueAtTime(110, snapTime);
    thumpOsc.frequency.exponentialRampToValueAtTime(40, snapTime + 0.12);
    thumpGain.gain.setValueAtTime(0.55 * masterVol, snapTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, snapTime + 0.14);
    thumpOsc.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thumpOsc.start(snapTime);
    thumpOsc.stop(snapTime + 0.15);

    // Sharp mechanical snap crack
    const snapBufSize = Math.floor(ctx.sampleRate * 0.07);
    const snapBuf = ctx.createBuffer(1, snapBufSize, ctx.sampleRate);
    const snapData = snapBuf.getChannelData(0);
    for (let i = 0; i < snapBufSize; i++) {
      snapData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    }
    const snapNoise = ctx.createBufferSource();
    snapNoise.buffer = snapBuf;
    const snapFilter = ctx.createBiquadFilter();
    snapFilter.type = 'bandpass';
    snapFilter.frequency.value = 1800;
    snapFilter.Q.value = 2.5;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.70 * masterVol, snapTime);
    snapGain.gain.exponentialRampToValueAtTime(0.001, snapTime + 0.08);
    snapNoise.connect(snapFilter);
    snapFilter.connect(snapGain);
    snapGain.connect(ctx.destination);
    snapNoise.start(snapTime);
    snapNoise.stop(snapTime + 0.09);

    // 4. Dull, heavy, non-musical wooden table drop clatter (zero tonal pitches, purely realistic noise impact)
    const drops = [
      { delay: 1.42, dur: 0.14, freq: 320, vol: 0.45 }, // Solid primary impact
      { delay: 1.60, dur: 0.08, freq: 420, vol: 0.20 }, // Muffled secondary bounce
    ];

    drops.forEach((d) => {
      const dTime = now + d.delay;
      const dBufSize = Math.floor(ctx.sampleRate * d.dur);
      const dBuf = ctx.createBuffer(1, dBufSize, ctx.sampleRate);
      const dData = dBuf.getChannelData(0);
      for (let i = 0; i < dBufSize; i++) {
        dData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
      }
      const dNoise = ctx.createBufferSource();
      dNoise.buffer = dBuf;
      const dFilter = ctx.createBiquadFilter();
      dFilter.type = 'lowpass';
      dFilter.frequency.value = d.freq;
      const dGain = ctx.createGain();
      dGain.gain.setValueAtTime(d.vol * masterVol, dTime);
      dGain.gain.exponentialRampToValueAtTime(0.001, dTime + d.dur);
      dNoise.connect(dFilter);
      dFilter.connect(dGain);
      dGain.connect(ctx.destination);
      dNoise.start(dTime);
      dNoise.stop(dTime + d.dur + 0.02);

      // Low wood thud component
      const woodOsc = ctx.createOscillator();
      const woodGain = ctx.createGain();
      woodOsc.type = 'sine';
      woodOsc.frequency.setValueAtTime(95, dTime);
      woodOsc.frequency.exponentialRampToValueAtTime(45, dTime + d.dur);
      woodGain.gain.setValueAtTime(d.vol * 0.5 * masterVol, dTime);
      woodGain.gain.exponentialRampToValueAtTime(0.001, dTime + d.dur);
      woodOsc.connect(woodGain);
      woodGain.connect(ctx.destination);
      woodOsc.start(dTime);
      woodOsc.stop(dTime + d.dur + 0.02);
    });

  } catch (e) {
    console.warn("Scalpel cut audio failed:", e);
  }
};

let cachedStrikeBuf: AudioBuffer | null = null;
let cachedFlameBuf: AudioBuffer | null = null;
let cachedSizzleBuf: AudioBuffer | null = null;
let cachedDragAirBuf: AudioBuffer | null = null;
let cachedExhaleBuf: AudioBuffer | null = null;

export const playZippoOpen = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Cam spring latch micro-click just before lid swings clear
    const camOsc = ctx.createOscillator();
    const camGain = ctx.createGain();
    camOsc.type = 'triangle';
    camOsc.frequency.setValueAtTime(1180, now);
    camOsc.frequency.exponentialRampToValueAtTime(420, now + 0.024);
    camGain.gain.setValueAtTime(0.45 * globalMasterVolume, now);
    camGain.gain.exponentialRampToValueAtTime(0.005, now + 0.028);
    camOsc.connect(camGain);
    camGain.connect(ctx.destination);
    camOsc.start(now);
    camOsc.stop(now + 0.032);

    // 2. Signature hollow brass Zippo lid open "CHING / CLINK" dual-harmonic ring
    const pingTime = now + 0.035;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const pingGain = ctx.createGain();
    oscA.type = 'sine';
    oscB.type = 'triangle';
    oscA.frequency.setValueAtTime(3280, pingTime);
    oscA.frequency.exponentialRampToValueAtTime(2840, pingTime + 0.14);
    oscB.frequency.setValueAtTime(5120, pingTime);
    oscB.frequency.exponentialRampToValueAtTime(4650, pingTime + 0.09);

    pingGain.gain.setValueAtTime(0.001, pingTime);
    pingGain.gain.linearRampToValueAtTime(0.55 * globalMasterVolume, pingTime + 0.004);
    pingGain.gain.exponentialRampToValueAtTime(0.004, pingTime + 0.16);

    oscA.connect(pingGain);
    oscB.connect(pingGain);
    pingGain.connect(ctx.destination);
    oscA.start(pingTime);
    oscB.start(pingTime);
    oscA.stop(pingTime + 0.17);
    oscB.stop(pingTime + 0.17);
  } catch (e) {
    console.warn("Zippo open sound failed:", e);
  }
};

export const playZippoStrike = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Serrated steel wheel scraping cerium flint + sharp spark snap
    const strikeSize = Math.floor(ctx.sampleRate * 0.16);
    if (!cachedStrikeBuf || cachedStrikeBuf.sampleRate !== ctx.sampleRate || cachedStrikeBuf.length !== strikeSize) {
      cachedStrikeBuf = ctx.createBuffer(1, strikeSize, ctx.sampleRate);
      const sd = cachedStrikeBuf.getChannelData(0);
      for (let i = 0; i < strikeSize; i++) {
        const t = i / strikeSize;
        const grit = Math.sin(i * 0.42) * 0.35 + (Math.random() * 2 - 1) * 0.65;
        sd[i] = grit * Math.pow(1 - t, 0.7) * (Math.random() > 0.22 ? 1 : 0.15);
      }
    }
    const spark = ctx.createBufferSource();
    spark.buffer = cachedStrikeBuf;
    const sparkFilter = ctx.createBiquadFilter();
    sparkFilter.type = 'bandpass';
    sparkFilter.frequency.setValueAtTime(4200, now);
    sparkFilter.frequency.exponentialRampToValueAtTime(5900, now + 0.11);
    sparkFilter.Q.value = 3.2;
    const sparkGain = ctx.createGain();
    sparkGain.gain.setValueAtTime(0.85 * globalMasterVolume, now);
    sparkGain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
    spark.connect(sparkFilter);
    sparkFilter.connect(sparkGain);
    sparkGain.connect(ctx.destination);
    spark.start(now);
    spark.stop(now + 0.16);

    // 2. Naphtha fuel vapor soft "WHOOMPH" bloom & steady warm wick hiss
    const flameTime = now + 0.055;
    const flameSize = Math.floor(ctx.sampleRate * 0.78);
    if (!cachedFlameBuf || cachedFlameBuf.sampleRate !== ctx.sampleRate || cachedFlameBuf.length !== flameSize) {
      cachedFlameBuf = ctx.createBuffer(1, flameSize, ctx.sampleRate);
      const fd = cachedFlameBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < fd.length; i++) {
        last = last * 0.65 + (Math.random() * 2 - 1) * 0.35;
        fd[i] = last;
      }
    }
    const flame = ctx.createBufferSource();
    flame.buffer = cachedFlameBuf;
    const flameFilter = ctx.createBiquadFilter();
    flameFilter.type = 'lowpass';
    flameFilter.frequency.setValueAtTime(1650, flameTime);
    flameFilter.frequency.exponentialRampToValueAtTime(420, flameTime + 0.28);
    flameFilter.frequency.linearRampToValueAtTime(520, flameTime + 0.72);
    const flameGain = ctx.createGain();
    flameGain.gain.setValueAtTime(0, flameTime);
    flameGain.gain.linearRampToValueAtTime(0.55 * globalMasterVolume, flameTime + 0.035);
    flameGain.gain.exponentialRampToValueAtTime(0.14 * globalMasterVolume, flameTime + 0.26);
    flameGain.gain.exponentialRampToValueAtTime(0.01, flameTime + 0.75);
    flame.connect(flameFilter);
    flameFilter.connect(flameGain);
    flameGain.connect(ctx.destination);
    flame.start(flameTime);
    flame.stop(flameTime + 0.78);
  } catch (e) {
    console.warn("Zippo strike sound failed:", e);
  }
};

export const playZippoClose = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Solid dampened brass lid impact "CLACK"
    const clackOsc = ctx.createOscillator();
    const clackGain = ctx.createGain();
    clackOsc.type = 'triangle';
    clackOsc.frequency.setValueAtTime(1850, now);
    clackOsc.frequency.exponentialRampToValueAtTime(320, now + 0.032);
    clackGain.gain.setValueAtTime(0.75 * globalMasterVolume, now);
    clackGain.gain.exponentialRampToValueAtTime(0.005, now + 0.045);
    clackOsc.connect(clackGain);
    clackGain.connect(ctx.destination);
    clackOsc.start(now);
    clackOsc.stop(now + 0.05);

    // 2. Case housing low resonance thud & spring detent click
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(290, now);
    thudOsc.frequency.exponentialRampToValueAtTime(95, now + 0.045);
    thudGain.gain.setValueAtTime(0.55 * globalMasterVolume, now);
    thudGain.gain.exponentialRampToValueAtTime(0.005, now + 0.05);
    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.start(now);
    thudOsc.stop(now + 0.055);
  } catch (e) {
    console.warn("Zippo close sound failed:", e);
  }
};

export const playCigaretteDrag = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Restricted filter draw air suction (quiet focused inhalation)
    const airSize = Math.floor(ctx.sampleRate * 0.9);
    if (!cachedDragAirBuf || cachedDragAirBuf.sampleRate !== ctx.sampleRate || cachedDragAirBuf.length !== airSize) {
      cachedDragAirBuf = ctx.createBuffer(1, airSize, ctx.sampleRate);
      const ad = cachedDragAirBuf.getChannelData(0);
      for (let i = 0; i < airSize; i++) {
        ad[i] = Math.random() * 2 - 1;
      }
    }
    const air = ctx.createBufferSource();
    air.buffer = cachedDragAirBuf;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.setValueAtTime(920, now);
    airFilter.frequency.linearRampToValueAtTime(1480, now + 0.45);
    airFilter.frequency.linearRampToValueAtTime(1100, now + 0.85);
    airFilter.Q.value = 2.4;
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0, now);
    airGain.gain.linearRampToValueAtTime(0.24 * globalMasterVolume, now + 0.14);
    airGain.gain.linearRampToValueAtTime(0.18 * globalMasterVolume, now + 0.65);
    airGain.gain.exponentialRampToValueAtTime(0.004, now + 0.88);
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(ctx.destination);
    air.start(now);
    air.stop(now + 0.9);

    // 2. Subtle dry cured tobacco & rolling paper ember crackle impulses
    const sizzleSize = Math.floor(ctx.sampleRate * 0.9);
    if (!cachedSizzleBuf || cachedSizzleBuf.sampleRate !== ctx.sampleRate || cachedSizzleBuf.length !== sizzleSize) {
      cachedSizzleBuf = ctx.createBuffer(1, sizzleSize, ctx.sampleRate);
      const szd = cachedSizzleBuf.getChannelData(0);
      for (let i = 0; i < szd.length; i++) {
        szd[i] = Math.random() > 0.94 ? (Math.random() * 2 - 1) * (0.4 + Math.random() * 0.6) : 0;
      }
    }
    const sizzle = ctx.createBufferSource();
    sizzle.buffer = cachedSizzleBuf;
    const sizzleFilter = ctx.createBiquadFilter();
    sizzleFilter.type = 'highpass';
    sizzleFilter.frequency.value = 3600;
    const sizzleGain = ctx.createGain();
    sizzleGain.gain.setValueAtTime(0, now);
    sizzleGain.gain.linearRampToValueAtTime(0.42 * globalMasterVolume, now + 0.16);
    sizzleGain.gain.exponentialRampToValueAtTime(0.01, now + 0.88);
    sizzle.connect(sizzleFilter);
    sizzleFilter.connect(sizzleGain);
    sizzleGain.connect(ctx.destination);
    sizzle.start(now);
    sizzle.stop(now + 0.9);
  } catch (e) {
    console.warn("Cigarette drag sound failed:", e);
  }
};

export const playCigaretteLighting = () => {
  playZippoOpen();
  setTimeout(() => playZippoStrike(), 150);
  setTimeout(() => playCigaretteDrag(), 340);
};

export const playSmokeExhale = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const bufferSize = Math.floor(ctx.sampleRate * 1.45);
    if (!cachedExhaleBuf || cachedExhaleBuf.sampleRate !== ctx.sampleRate || cachedExhaleBuf.length !== bufferSize) {
      cachedExhaleBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = cachedExhaleBuf.getChannelData(0);
      let pink = 0;
      for (let i = 0; i < bufferSize; i++) {
        pink = pink * 0.55 + (Math.random() * 2 - 1) * 0.45;
        data[i] = pink;
      }
    }

    // Layer 1: Warm chest / throat airflow body
    const exhaleBody = ctx.createBufferSource();
    exhaleBody.buffer = cachedExhaleBuf;
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.setValueAtTime(340, now);
    bodyFilter.frequency.linearRampToValueAtTime(760, now + 0.35);
    bodyFilter.frequency.exponentialRampToValueAtTime(220, now + 1.38);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0, now);
    bodyGain.gain.linearRampToValueAtTime(0.42 * globalMasterVolume, now + 0.18);
    bodyGain.gain.linearRampToValueAtTime(0.28 * globalMasterVolume, now + 0.65);
    bodyGain.gain.exponentialRampToValueAtTime(0.002, now + 1.42);

    exhaleBody.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    exhaleBody.start(now);
    exhaleBody.stop(now + 1.45);

    // Layer 2: Soft parted-lips breath hiss over the front of the exhale
    const exhaleLips = ctx.createBufferSource();
    exhaleLips.buffer = cachedExhaleBuf;
    const lipFilter = ctx.createBiquadFilter();
    lipFilter.type = 'bandpass';
    lipFilter.frequency.setValueAtTime(1320, now);
    lipFilter.frequency.exponentialRampToValueAtTime(640, now + 1.15);
    lipFilter.Q.value = 1.6;

    const lipGain = ctx.createGain();
    lipGain.gain.setValueAtTime(0, now);
    lipGain.gain.linearRampToValueAtTime(0.22 * globalMasterVolume, now + 0.12);
    lipGain.gain.exponentialRampToValueAtTime(0.002, now + 1.25);

    exhaleLips.connect(lipFilter);
    lipFilter.connect(lipGain);
    lipGain.connect(ctx.destination);
    exhaleLips.start(now);
    exhaleLips.stop(now + 1.3);
  } catch (e) {
    console.warn("Smoke exhale sound failed:", e);
  }
};

export const playSyringeSlam = () => {
  playSound('syringeSlam', true, 1.0);
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // 1. Aerodynamic downward stab whoosh
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.16);
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.7 * globalMasterVolume, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.17);
    osc.start(now);
    osc.stop(now + 0.18);

    // 2. Visceral sternum impact flesh thud & bone shock
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.connect(thudGain);
    thudGain.connect(ctx.destination);
    thud.type = 'sine';
    thud.frequency.setValueAtTime(120, now + 0.07);
    thud.frequency.linearRampToValueAtTime(22, now + 0.24);
    thudGain.gain.setValueAtTime(0, now);
    thudGain.gain.setValueAtTime(1.1 * globalMasterVolume, now + 0.07);
    thudGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    thud.start(now + 0.07);
    thud.stop(now + 0.32);

    // 3. High-pressure liquid epinephrine vascular hydraulic squirt & friction squeak
    const squirt = ctx.createOscillator();
    const squirtGain = ctx.createGain();
    squirt.connect(squirtGain);
    squirtGain.connect(ctx.destination);
    squirt.type = 'triangle';
    squirt.frequency.setValueAtTime(1200, now + 0.11);
    squirt.frequency.exponentialRampToValueAtTime(2600, now + 0.36);
    squirtGain.gain.setValueAtTime(0, now);
    squirtGain.gain.setValueAtTime(0.4 * globalMasterVolume, now + 0.11);
    squirtGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    squirt.start(now + 0.11);
    squirt.stop(now + 0.42);

    setTimeout(() => {
      try {
        osc.disconnect(); gain.disconnect();
        thud.disconnect(); thudGain.disconnect();
        squirt.disconnect(); squirtGain.disconnect();
      } catch (err) {}
    }, 500);
  } catch (e) {
    console.warn("Synth slam sound failed:", e);
  }
};

export const playThumpSound = () => {
  playSound('thump', true, 1.0);
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Deep seismic body collapse / floor thud frequency sweep
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, now);
    osc.frequency.exponentialRampToValueAtTime(16, now + 0.5);
    gain.gain.setValueAtTime(1.15 * globalMasterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.52);
    osc.start(now);
    osc.stop(now + 0.55);

    // 2. High-frequency wood table / floorboard rattling shock
    const board = ctx.createOscillator();
    const boardGain = ctx.createGain();
    board.connect(boardGain);
    boardGain.connect(ctx.destination);
    board.type = 'triangle';
    board.frequency.setValueAtTime(210, now);
    board.frequency.linearRampToValueAtTime(38, now + 0.15);
    boardGain.gain.setValueAtTime(0.5 * globalMasterVolume, now);
    boardGain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
    board.start(now);
    board.stop(now + 0.18);

    // 3. Secondary subtle dust / cloth flutter decay
    const dustSize = Math.floor(ctx.sampleRate * 0.25);
    const dustBuf = ctx.createBuffer(1, dustSize, ctx.sampleRate);
    const dd = dustBuf.getChannelData(0);
    for (let i = 0; i < dustSize; i++) dd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.08));
    const dust = ctx.createBufferSource();
    dust.buffer = dustBuf;
    const dustFilter = ctx.createBiquadFilter();
    dustFilter.type = 'lowpass';
    dustFilter.frequency.value = 600;
    const dustGain = ctx.createGain();
    dustGain.gain.setValueAtTime(0.3 * globalMasterVolume, now + 0.05);
    dustGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    dust.connect(dustFilter);
    dustFilter.connect(dustGain);
    dustGain.connect(ctx.destination);
    dust.start(now + 0.05);
    dust.stop(now + 0.3);

    setTimeout(() => {
      try {
        osc.disconnect(); gain.disconnect();
        board.disconnect(); boardGain.disconnect();
        dust.disconnect(); dustFilter.disconnect(); dustGain.disconnect();
      } catch (err) {}
    }, 600);
  } catch (e) {
    console.warn("Synth thump sound failed:", e);
  }
};



export const playGlassBreakSound = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    // High frequency noise burst for the glass shattering
    const bufferSize = ctx.sampleRate * 0.4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      // Create noisy, jagged wave representing glass shards
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.1));
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;
    
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 6000;
    bandpass.Q.value = 0.5;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 3000;
    
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(1.5 * globalMasterVolume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    noiseSource.connect(bandpass);
    bandpass.connect(highpass);
    highpass.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Also add a low thump for the bottle body hitting the ground
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.1);
    
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.8 * globalMasterVolume, ctx.currentTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    
    osc.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);

    noiseSource.start(ctx.currentTime);
  } catch (e) {
    console.error('Failed to play glass break sound', e);
  }
};

export const playGunDropSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // 1. Initial heavy wood table thud
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(160, now);
    thump.frequency.exponentialRampToValueAtTime(32, now + 0.18);
    thumpGain.gain.setValueAtTime(0.9 * globalMasterVolume, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    thump.start(now);
    thump.stop(now + 0.22);

    // 2. Heavy steel frame and cylinder rattling on hardwood
    const freqs = [780, 1150, 1820, 2400];
    freqs.forEach((freq, idx) => {
      const delay = idx * 0.035;
      const metalOsc = ctx.createOscillator();
      const metalGain = ctx.createGain();
      metalOsc.connect(metalGain);
      metalGain.connect(ctx.destination);
      metalOsc.type = 'sine';
      metalOsc.frequency.setValueAtTime(freq, now + delay);
      metalOsc.frequency.exponentialRampToValueAtTime(freq * 0.75, now + delay + 0.12);
      metalGain.gain.setValueAtTime(0, now);
      metalGain.gain.setValueAtTime((0.35 / (idx + 1)) * globalMasterVolume, now + delay);
      metalGain.gain.exponentialRampToValueAtTime(0.005, now + delay + 0.14);
      metalOsc.start(now + delay);
      metalOsc.stop(now + delay + 0.16);
    });

    // 3. Steel sliding scrape on wood
    const scrapeSize = Math.floor(ctx.sampleRate * 0.28);
    const scrapeBuf = ctx.createBuffer(1, scrapeSize, ctx.sampleRate);
    const d = scrapeBuf.getChannelData(0);
    for (let i = 0; i < scrapeSize; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.09));
    }
    const scrapeSrc = ctx.createBufferSource();
    scrapeSrc.buffer = scrapeBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.value = 3.0;
    const scrapeGain = ctx.createGain();
    scrapeGain.gain.setValueAtTime(0.5 * globalMasterVolume, now);
    scrapeGain.gain.exponentialRampToValueAtTime(0.01, now + 0.26);
    scrapeSrc.connect(filter);
    filter.connect(scrapeGain);
    scrapeGain.connect(ctx.destination);
    scrapeSrc.start(now);
    scrapeSrc.stop(now + 0.28);
  } catch (e) {
    console.warn("Gun drop sound failed:", e);
  }
};

export const playGunFloorClatter = (intensity = 1.0, bounceIndex = 0) => {
  if (bounceIndex >= 3) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const bounceAtten = bounceIndex === 0 ? 1.0 : bounceIndex === 1 ? 0.52 : 0.26;
    const amp = Math.max(0.06, Math.min(1.05, intensity)) * bounceAtten * globalMasterVolume;
    if (amp <= 0.01) return;
    const jitter = 0.93 + Math.random() * 0.14;

    // 1. Dry dense concrete masonry thud (short aperiodic lowpass impulse, zero hollow boom)
    const thudDur = bounceIndex === 0 ? 0.055 : 0.028;
    const thudBuf = makeViscousNoiseBuffer(ctx, thudDur, (_i, t, _sr, prev) => {
      const env = Math.exp(-t / (bounceIndex === 0 ? 0.011 : 0.006));
      const pulse = Math.sin(2 * Math.PI * (88 - t * 650) * t) * Math.exp(-t / 0.009);
      const brown = prev * 0.84 + (Math.random() * 2 - 1) * 0.16;
      return Math.tanh((pulse * 0.5 + brown * 2.1) * env * 1.6);
    });
    const thudSrc = ctx.createBufferSource();
    thudSrc.buffer = thudBuf;
    const thudLP = ctx.createBiquadFilter();
    thudLP.type = 'lowpass';
    thudLP.frequency.setValueAtTime((bounceIndex === 0 ? 220 : 180) * jitter, now);
    thudLP.frequency.exponentialRampToValueAtTime(52, now + thudDur);
    thudLP.Q.value = 0.7;
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(amp * 0.82, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + thudDur);
    thudSrc.connect(thudLP);
    thudLP.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudSrc.start(now);

    // 2. Hard forged-steel-on-concrete contact clack (broadband impulse through heavily damped bandpass, no sine chimes)
    const clackDur = bounceIndex === 0 ? 0.036 : 0.020;
    const clackBuf = makeViscousNoiseBuffer(ctx, clackDur, (_i, t) => {
      const transient = t < 0.0022 ? (Math.random() * 2 - 1) * 1.8 : 0;
      const body = (Math.random() * 2 - 1) * Math.exp(-t / (bounceIndex === 0 ? 0.0065 : 0.0038));
      return Math.tanh((transient + body) * 1.45);
    });

    const clackBands = bounceIndex === 0 ? [920, 2050] : [1150, 2400];
    clackBands.forEach((centerHz, idx) => {
      const src = ctx.createBufferSource();
      src.buffer = clackBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(centerHz * jitter, now);
      bp.frequency.exponentialRampToValueAtTime(centerHz * 0.72 * jitter, now + clackDur);
      bp.Q.value = idx === 0 ? 2.4 : 3.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp * (idx === 0 ? 0.65 : 0.42), now);
      g.gain.exponentialRampToValueAtTime(0.001, now + clackDur);
      src.connect(bp);
      bp.connect(g);
      g.connect(ctx.destination);
      src.start(now);
    });

    // 3. Dry internal crane/trigger shift click slightly after first concrete strike (no oscillator beep)
    if (bounceIndex === 0) {
      const latchDelay = 0.024 + Math.random() * 0.014;
      const latchDur = 0.018;
      const latchBuf = makeViscousNoiseBuffer(ctx, latchDur, (_i, t) => {
        return Math.tanh((Math.random() * 2 - 1) * Math.exp(-t / 0.0032) * 1.7);
      });
      const latchSrc = ctx.createBufferSource();
      latchSrc.buffer = latchBuf;
      const latchBP = ctx.createBiquadFilter();
      latchBP.type = 'bandpass';
      latchBP.frequency.setValueAtTime(1750 * jitter, now + latchDelay);
      latchBP.Q.value = 4.2;
      const latchGain = ctx.createGain();
      latchGain.gain.setValueAtTime(amp * 0.34, now + latchDelay);
      latchGain.gain.exponentialRampToValueAtTime(0.001, now + latchDelay + latchDur);
      latchSrc.connect(latchBP);
      latchBP.connect(latchGain);
      latchGain.connect(ctx.destination);
      latchSrc.start(now + latchDelay);
    }

    // 4. Brief abrasive grit skid on concrete (only on primary & first settle bounce)
    if (bounceIndex <= 1) {
      const skidDur = bounceIndex === 0 ? 0.095 : 0.042;
      const skidBuf = makeViscousNoiseBuffer(ctx, skidDur, (_i, t, _sr, prev) => {
        const env = Math.exp(-t / (skidDur * 0.34));
        const grit = Math.random() < 0.14 ? (Math.random() * 2 - 1) * 1.5 : 0;
        const sand = prev * 0.45 + (Math.random() * 2 - 1) * 0.55;
        return Math.tanh((sand + grit) * env);
      });
      const skidSrc = ctx.createBufferSource();
      skidSrc.buffer = skidBuf;
      const skidFilter = ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.setValueAtTime(1750 * jitter, now + 0.006);
      skidFilter.frequency.exponentialRampToValueAtTime(920, now + skidDur);
      skidFilter.Q.value = 1.9;
      const skidGain = ctx.createGain();
      skidGain.gain.setValueAtTime(amp * (bounceIndex === 0 ? 0.34 : 0.18), now + 0.006);
      skidGain.gain.exponentialRampToValueAtTime(0.001, now + skidDur);
      skidSrc.connect(skidFilter);
      skidFilter.connect(skidGain);
      skidGain.connect(ctx.destination);
      skidSrc.start(now + 0.005);
    }
  } catch (e) {
    console.warn("Gun floor clatter sound failed:", e);
  }
};

export const playShotgunPumpSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // Stroke 1: Racking backward (CHAK at now)
    // Metallic friction slide
    const slideSize = Math.floor(ctx.sampleRate * 0.12);
    const slideBuf = ctx.createBuffer(1, slideSize, ctx.sampleRate);
    const sd = slideBuf.getChannelData(0);
    for (let i = 0; i < slideSize; i++) sd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
    const slideSrc = ctx.createBufferSource();
    slideSrc.buffer = slideBuf;
    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'bandpass';
    slideFilter.frequency.value = 1800;
    slideFilter.Q.value = 2.5;
    const slideGain = ctx.createGain();
    slideGain.gain.setValueAtTime(0.85 * globalMasterVolume, now);
    slideGain.gain.exponentialRampToValueAtTime(0.01, now + 0.11);
    slideSrc.connect(slideFilter);
    slideFilter.connect(slideGain);
    slideGain.connect(ctx.destination);
    slideSrc.start(now);

    // Mechanical latch click 1
    const click1 = ctx.createOscillator();
    const click1Gain = ctx.createGain();
    click1.connect(click1Gain);
    click1Gain.connect(ctx.destination);
    click1.type = 'triangle';
    click1.frequency.setValueAtTime(950, now + 0.03);
    click1.frequency.exponentialRampToValueAtTime(280, now + 0.09);
    click1Gain.gain.setValueAtTime(0.7 * globalMasterVolume, now + 0.03);
    click1Gain.gain.exponentialRampToValueAtTime(0.01, now + 0.10);
    click1.start(now + 0.03);
    click1.stop(now + 0.11);

    // Stroke 2: Slamming forward into battery (CHIK at now + 0.22s)
    const forwardTime = now + 0.22;
    const slam = ctx.createOscillator();
    const slamGain = ctx.createGain();
    slam.connect(slamGain);
    slamGain.connect(ctx.destination);
    slam.type = 'sine';
    slam.frequency.setValueAtTime(220, forwardTime);
    slam.frequency.exponentialRampToValueAtTime(45, forwardTime + 0.15);
    slamGain.gain.setValueAtTime(1.1 * globalMasterVolume, forwardTime);
    slamGain.gain.exponentialRampToValueAtTime(0.01, forwardTime + 0.16);
    slam.start(forwardTime);
    slam.stop(forwardTime + 0.18);

    // Heavy breach lockup click
    const lock = ctx.createOscillator();
    const lockGain = ctx.createGain();
    lock.connect(lockGain);
    lockGain.connect(ctx.destination);
    lock.type = 'triangle';
    lock.frequency.setValueAtTime(1850, forwardTime);
    lock.frequency.exponentialRampToValueAtTime(420, forwardTime + 0.08);
    lockGain.gain.setValueAtTime(0.9 * globalMasterVolume, forwardTime);
    lockGain.gain.exponentialRampToValueAtTime(0.01, forwardTime + 0.09);
    lock.start(forwardTime);
    lock.stop(forwardTime + 0.1);

    // Shell seating metallic chime
    const shellChime = ctx.createOscillator();
    const shellGain = ctx.createGain();
    shellChime.connect(shellGain);
    shellGain.connect(ctx.destination);
    shellChime.type = 'sine';
    shellChime.frequency.setValueAtTime(2600, forwardTime + 0.02);
    shellChime.frequency.exponentialRampToValueAtTime(1200, forwardTime + 0.18);
    shellGain.gain.setValueAtTime(0.4 * globalMasterVolume, forwardTime + 0.02);
    shellGain.gain.exponentialRampToValueAtTime(0.005, forwardTime + 0.2);
    shellChime.start(forwardTime + 0.02);
    shellChime.stop(forwardTime + 0.22);
  } catch (e) {
    console.warn("Shotgun pump sound failed:", e);
  }
};

export const playShotgunBlastSound = () => {
  playSound('gunshot', true, 1.0);
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // 1. Earth-shattering Sub-Bass Concussion (12-gauge close quarters boom)
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(18, now + 0.75);
    subGain.gain.setValueAtTime(1.5 * globalMasterVolume, now);
    subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    sub.start(now);
    sub.stop(now + 0.85);

    // 2. Massive Gunpowder Explosion Noise Burst
    const blastSize = Math.floor(ctx.sampleRate * 0.9);
    const blastBuf = ctx.createBuffer(1, blastSize, ctx.sampleRate);
    const bd = blastBuf.getChannelData(0);
    for (let i = 0; i < blastSize; i++) {
      bd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.18));
    }
    const blastSrc = ctx.createBufferSource();
    blastSrc.buffer = blastBuf;
    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowpass';
    lowFilter.frequency.setValueAtTime(2800, now);
    lowFilter.frequency.exponentialRampToValueAtTime(180, now + 0.6);
    const blastGain = ctx.createGain();
    blastGain.gain.setValueAtTime(1.4 * globalMasterVolume, now);
    blastGain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
    blastSrc.connect(lowFilter);
    lowFilter.connect(blastGain);
    blastGain.connect(ctx.destination);
    blastSrc.start(now);

    // 3. Supersonic Detonation Snap (high-frequency crack)
    const crack = ctx.createOscillator();
    const crackGain = ctx.createGain();
    crack.connect(crackGain);
    crackGain.connect(ctx.destination);
    crack.type = 'sawtooth';
    crack.frequency.setValueAtTime(3200, now);
    crack.frequency.exponentialRampToValueAtTime(140, now + 0.08);
    crackGain.gain.setValueAtTime(1.0 * globalMasterVolume, now);
    crackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.09);
    crack.start(now);
    crack.stop(now + 0.1);

    // 4. Heavy Steel Barrel Ringing Echo
    const ring = ctx.createOscillator();
    const ringGain = ctx.createGain();
    ring.connect(ringGain);
    ringGain.connect(ctx.destination);
    ring.type = 'sine';
    ring.frequency.setValueAtTime(540, now);
    ringGain.gain.setValueAtTime(0.45 * globalMasterVolume, now);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    ring.start(now);
    ring.stop(now + 1.25);
  } catch (e) {
    console.warn("Shotgun blast sound failed:", e);
  }
};

export const playDealerSadisticLaugh = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // Guttural demonic low-pitch laughter cadence: 3 sinister chuckle pulses
    const pulses = [0, 0.22, 0.44];
    pulses.forEach((offset, idx) => {
      const pTime = now + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      const baseFreq = 95 - idx * 8;
      osc.frequency.setValueAtTime(baseFreq, pTime);
      osc.frequency.linearRampToValueAtTime(baseFreq - 15, pTime + 0.16);

      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(0.35 * globalMasterVolume, pTime);
      gain.gain.exponentialRampToValueAtTime(0.005, pTime + 0.18);

      osc.start(pTime);
      osc.stop(pTime + 0.2);
    });

    // Eerie harmonic resonant drone chime
    const drone = ctx.createOscillator();
    const droneGain = ctx.createGain();
    drone.connect(droneGain);
    droneGain.connect(ctx.destination);
    drone.type = 'sine';
    drone.frequency.setValueAtTime(220, now);
    drone.frequency.exponentialRampToValueAtTime(110, now + 0.9);
    droneGain.gain.setValueAtTime(0.25 * globalMasterVolume, now);
    droneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    drone.start(now);
    drone.stop(now + 1.0);
  } catch (e) {
    console.warn("Dealer sadistic laugh failed:", e);
  }
};

let lastBloodDripSfxTime = 0;
let bloodDripWindowStartMs = 0;
let bloodDripWindowCount = 0;

/**
 * Generates an organic pink/brown-weighted noise sample step.
 */
const makeViscousNoiseBuffer = (
  ctx: AudioContext,
  durationSec: number,
  buildSample: (i: number, t: number, sr: number, prev: number) => number
): AudioBuffer => {
  const sr = ctx.sampleRate;
  const len = Math.max(64, Math.floor(sr * durationSec));
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const sample = buildSample(i, i / sr, sr, prev);
    prev = sample;
    data[i] = Math.max(-1, Math.min(1, sample));
  }
  return buf;
};

/**
 * Realistic viscous blood droplet impact onto oak table, concrete floor, revolver steel, or shallow pooling blood.
 * Built from transient contact-line physics (hydrodynamic contact snap, heavily damped surface micro-knock,
 * and thick non-Newtonian crown spread) rather than pitched synth sweeps.
 */
export const playBloodDrip = (
  surface: 'table' | 'floor' | 'gun' = 'table',
  intensity: number = 0.65
) => {
  const s = getControllerSettings();
  if (s.bloodEffectsEnabled === false) return;

  const nowMs = performance.now();
  // Natural irregular spacing + finite clotting budget so dripping stays audible then tapers to silence
  if (nowMs - lastBloodDripSfxTime < 78 + Math.random() * 62) return;
  if (nowMs - bloodDripWindowStartMs > 5200) {
    bloodDripWindowStartMs = nowMs;
    bloodDripWindowCount = 0;
  }
  if (bloodDripWindowCount >= 14) return;
  bloodDripWindowCount++;
  lastBloodDripSfxTime = nowMs;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const taper = Math.max(0.28, 1.0 - Math.max(0, bloodDripWindowCount - 3) * 0.068);
    const mass = Math.max(0.15, Math.min(1.0, intensity));
    const vol = mass * taper * 0.50 * globalMasterVolume;
    if (vol <= 0.005) return;

    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.setValueAtTime((Math.random() - 0.5) * 0.62, now);
      panner.connect(ctx.destination);
    }
    const outNode: AudioNode = panner || ctx.destination;

    const hitsPoolingWet = surface !== 'gun' && bloodDripWindowCount > 2 && Math.random() < 0.42;
    const pitchJit = 0.86 + Math.random() * 0.28;

    // 1. Instantaneous hydrodynamic contact-line snap + surface-coupled wet splat (zero tonal sweep)
    const impactDur = surface === 'gun' ? 0.022 : 0.032 + mass * 0.012;
    const impactBuf = makeViscousNoiseBuffer(ctx, impactDur, (_i, t, _sr, prev) => {
      // Microsecond-scale surface tension rupture spike at t = 0
      const contactTick = t < 0.0014 ? (Math.random() * 2 - 1) * 1.9 : 0;
      const bodyDecay = surface === 'gun' ? 0.0032 : surface === 'table' ? 0.0052 : 0.0045;
      const env = Math.exp(-t / (bodyDecay + mass * 0.0025));
      const white = Math.random() * 2 - 1;
      // Heavy viscous low-mid texture
      const brown = prev * 0.72 + white * 0.28;
      // Damped oak/concrete/steel micro-impulse (very short 4-6ms, non-ringing)
      const surfHz =
        surface === 'gun'
          ? 1480 * pitchJit
          : hitsPoolingWet
            ? 390 * pitchJit
            : surface === 'table'
              ? 245 * pitchJit
              : 165 * pitchJit;
      const surfKnock = Math.sin(2 * Math.PI * surfHz * t) * Math.exp(-t / (hitsPoolingWet ? 0.0065 : 0.0038));
      const wetWeight = hitsPoolingWet ? 0.45 : 0.30;
      return Math.tanh((contactTick + surfKnock * wetWeight + brown * 1.65) * env * (1.35 + mass));
    });

    const impactSrc = ctx.createBufferSource();
    impactSrc.buffer = impactBuf;

    const impactFilter = ctx.createBiquadFilter();
    impactFilter.type = 'bandpass';
    const centerFreq =
      surface === 'gun'
        ? 1950 * pitchJit
        : hitsPoolingWet
          ? 620 * pitchJit
          : surface === 'table'
            ? 560 * pitchJit
            : 360 * pitchJit;
    impactFilter.frequency.setValueAtTime(centerFreq, now);
    impactFilter.Q.setValueAtTime(surface === 'gun' ? 1.7 : hitsPoolingWet ? 1.85 : 1.05, now);

    const impactGain = ctx.createGain();
    impactGain.gain.setValueAtTime(vol, now);
    impactGain.gain.exponentialRampToValueAtTime(0.001, now + impactDur);

    impactSrc.connect(impactFilter);
    impactFilter.connect(impactGain);
    impactGain.connect(outNode);
    impactSrc.start(now);

    // 2. Viscous liquid crown spread + subtle thick meniscus settle (for pooling / mid-heavy drops)
    if (mass > 0.28) {
      const wetDur = 0.026 + mass * 0.022;
      const wetBuf = makeViscousNoiseBuffer(ctx, wetDur, (_i, t, _sr, prev) => {
        const smearEnv = Math.exp(-t / (0.0065 + mass * 0.004));
        const bubbleBurst =
          hitsPoolingWet && Math.abs(t - 0.009) < 0.0035
            ? Math.sin(2 * Math.PI * (480 * pitchJit) * (t - 0.006)) * Math.exp(-Math.pow((t - 0.009) / 0.0022, 2)) * 0.65
            : 0;
        const microSplat = prev * 0.52 + (Math.random() * 2 - 1) * 0.48;
        return Math.tanh((microSplat * smearEnv * 1.35 + bubbleBurst) * 1.25);
      });

      const wetSrc = ctx.createBufferSource();
      wetSrc.buffer = wetBuf;

      const wetBand = ctx.createBiquadFilter();
      wetBand.type = 'bandpass';
      wetBand.frequency.setValueAtTime(
        (surface === 'gun' ? 2900 : surface === 'table' ? 1420 : 880) * pitchJit,
        now
      );
      wetBand.Q.setValueAtTime(0.85, now);

      const wetGain = ctx.createGain();
      wetGain.gain.setValueAtTime(vol * 0.48, now);
      wetGain.gain.exponentialRampToValueAtTime(0.0008, now + wetDur);

      wetSrc.connect(wetBand);
      wetBand.connect(wetGain);
      wetGain.connect(outNode);
      wetSrc.start(now);
    }

    // 3. Occasional micro-satellite droplet tick breaking off a heavy drop
    if (mass > 0.58 && Math.random() < 0.45) {
      const satDelay = 0.018 + Math.random() * 0.022;
      const satDur = 0.014;
      const satBuf = makeViscousNoiseBuffer(ctx, satDur, (_i, t, _sr, prev) => {
        const env = Math.exp(-t / 0.0032);
        return Math.tanh((prev * 0.55 + (Math.random() * 2 - 1) * 0.45) * env * 1.5);
      });
      const satSrc = ctx.createBufferSource();
      satSrc.buffer = satBuf;
      const satFilter = ctx.createBiquadFilter();
      satFilter.type = 'bandpass';
      satFilter.frequency.setValueAtTime((surface === 'table' ? 1150 : 720) * pitchJit, now + satDelay);
      satFilter.Q.value = 1.2;
      const satGain = ctx.createGain();
      satGain.gain.setValueAtTime(vol * 0.30, now + satDelay);
      satGain.gain.exponentialRampToValueAtTime(0.001, now + satDelay + satDur);
      satSrc.connect(satFilter);
      satFilter.connect(satGain);
      satGain.connect(outNode);
      satSrc.start(now + satDelay);
    }
  } catch (e) {
    // Silent fallback
  }
};

/**
 * Gritty, photorealistic acoustic gore impact & high-pressure arterial rupture:
 * Combines a sub-acoustic chest/flesh hydrostatic thud, non-linear serrated liquid tearing,
 * discrete clot-chunk micro-impacts onto wood/concrete, and irregular gravity runoff drips.
 */
export const playBloodImpactSplatter = (intensity: number = 1.0) => {
  const s = getControllerSettings();
  if (s.bloodEffectsEnabled === false) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const amt = Math.max(0.2, Math.min(1.4, intensity));
    const vol = amt * globalMasterVolume;
    if (vol <= 0.005) return;

    // 1. Aperiodic damped hydrostatic flesh/cavity impact thud (zero tonal synth oscillator)
    const thudDur = 0.095;
    const thudBuf = makeViscousNoiseBuffer(ctx, thudDur, (_i, t, _sr, prev) => {
      const shockEnv = Math.exp(-t / 0.019);
      const subPulse = Math.sin(2 * Math.PI * (62 - t * 220) * t) * Math.exp(-t / 0.016);
      const brown = prev * 0.86 + (Math.random() * 2 - 1) * 0.14;
      return Math.tanh((subPulse * 0.6 + brown * 2.2) * shockEnv * 1.8);
    });
    const thudSrc = ctx.createBufferSource();
    thudSrc.buffer = thudBuf;

    const thudLP = ctx.createBiquadFilter();
    thudLP.type = 'lowpass';
    thudLP.frequency.setValueAtTime(420, now);
    thudLP.frequency.exponentialRampToValueAtTime(85, now + thudDur);
    thudLP.Q.setValueAtTime(0.85, now);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.75 * vol, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + thudDur);

    thudSrc.connect(thudLP);
    thudLP.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudSrc.start(now);

    // 2. Pressurized wet tissue rupture & uneven arterial splatter bursts across stereo field
    const sprayDur = 0.28;
    // Generate random physical clot impact timestamps inside the burst window
    const clotTimes = [0.006, 0.019, 0.034, 0.052, 0.078, 0.112, 0.148].map(
      (base) => base + (Math.random() - 0.5) * 0.008
    );

    const buildGushLayer = (panOffset: number, delaySec: number, gainScale: number, formantStart: number) => {
      const startAt = now + delaySec;
      const gushBuf = makeViscousNoiseBuffer(ctx, sprayDur, (_i, t, _sr, prev) => {
        const baseEnv = Math.exp(-t / (0.048 + amt * 0.024));
        const white = Math.random() * 2 - 1;
        // Heavy brown/pink viscous texture
        const viscous = prev * 0.62 + white * 0.38;

        // Irregular fibrous tearing & wet cavitation spikes (clots slapping surfaces)
        let clotImpulse = 0;
        for (let c = 0; c < clotTimes.length; c++) {
          const dt = t - clotTimes[c];
          if (dt >= 0 && dt < 0.011) {
            clotImpulse += Math.exp(-dt / 0.0028) * (Math.random() * 2 - 1) * 1.45;
          }
        }
        // Hydrostatic turbulent flutter (non-periodic)
        const flutter = 0.55 + 0.45 * Math.sin(t * 95 + Math.cos(t * 210) * 2.2);
        return Math.tanh((viscous * baseEnv * flutter * 1.7 + clotImpulse) * 1.4);
      });

      const src = ctx.createBufferSource();
      src.buffer = gushBuf;

      // Dual parallel wet formants: thick slurry (~420->180Hz) + wet tear/spray (formantStart->360Hz)
      const wetCore = ctx.createBiquadFilter();
      wetCore.type = 'bandpass';
      wetCore.frequency.setValueAtTime(520, startAt);
      wetCore.frequency.exponentialRampToValueAtTime(175, startAt + sprayDur);
      wetCore.Q.setValueAtTime(1.5, startAt);

      const sprayBand = ctx.createBiquadFilter();
      sprayBand.type = 'bandpass';
      sprayBand.frequency.setValueAtTime(formantStart, startAt);
      sprayBand.frequency.exponentialRampToValueAtTime(340, startAt + sprayDur);
      sprayBand.Q.setValueAtTime(0.9, startAt);

      const gNode = ctx.createGain();
      gNode.gain.setValueAtTime(0.72 * vol * gainScale, startAt);
      gNode.gain.exponentialRampToValueAtTime(0.002, startAt + sprayDur);

      const pNode = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      if (pNode) {
        pNode.pan.setValueAtTime(panOffset, startAt);
        gNode.connect(pNode);
        pNode.connect(ctx.destination);
      } else {
        gNode.connect(ctx.destination);
      }

      src.connect(wetCore);
      src.connect(sprayBand);
      wetCore.connect(gNode);
      sprayBand.connect(gNode);
      src.start(startAt);
    };

    // Primary exit-wound pressure burst + delayed wet table/wall splash reflection
    buildGushLayer(-0.18 + Math.random() * 0.12, 0.0, 1.0, 2100);
    buildGushLayer(0.22 - Math.random() * 0.12, 0.032 + Math.random() * 0.018, 0.72, 1450);

    // 3. Reset clotting window on fresh trauma impact and schedule irregular post-splatter drips
    bloodDripWindowStartMs = performance.now();
    bloodDripWindowCount = 0;
    const dripCount = Math.min(4, Math.max(2, Math.round(amt * 2.5)));
    let accDelay = 160;
    for (let d = 0; d < dripCount; d++) {
      accDelay += 140 + Math.random() * 195;
      const dDelay = accDelay;
      const surface: 'table' | 'floor' = d % 3 === 2 ? 'floor' : 'table';
      const dropMass = 0.42 + Math.random() * 0.48;
      setTimeout(() => {
        playBloodDrip(surface, dropMass);
      }, dDelay);
    }
  } catch (e) {
    // Silent fallback
  }
};



