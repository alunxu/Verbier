/**
 * experience.js — Become the Conductor main application orchestrator.
 *
 * Coordinates the state machine across screens:
 *   welcome → picker → loading → tutorial (optional) → demo
 *
 * Wires up:
 *   - MusicLensEngine (audio effect chain + 3-source playback)
 *   - LensHandTracker (MediaPipe webcam pipeline)
 *   - LensGestureMapper (landmarks → 8 effect parameters)
 *   - LensOverlayRenderer (canvas HUD on top of the video)
 *   - Slider fallback panel
 */

import { MusicLensEngine } from './audio-engine.js';
import { LensHandTracker } from './hand-camera.js';
import { LensGestureMapper } from './gesture-to-sound.js';
import { LensOverlayRenderer } from './live-overlay.js';

// Verbier festival archive photos served via Vite's external mount at /verbier-photos.
// URL-encoded so spaces / parentheses / accents resolve correctly.
const VP = (relPath) => '/verbier-photos/' + relPath.split('/').map(encodeURIComponent).join('/');
const PHOTO = {
  // landscapes (Lieux & Paysages)
  panorama1: VP('Lieux & Paysages/Verbier04_(c)Shapiro.JPG'),
  panorama2: VP('Lieux & Paysages/Verbier06_(c)Shapiro.jpg'),
  tentScenery1: VP('Lieux & Paysages/VFTent_Scenery-4_(c)Shapiro.jpg'),
  tentScenery2: VP('Lieux & Paysages/VFTent_Scenery-6_(c)Shapiro.jpg'),
  tentLandscape: VP('Lieux & Paysages/Tent_Paysage-10_(c)Shapiro.jpg'),
  vincentRiba: VP('Lieux & Paysages/IMG_0204 (c) Vincent Riba.jpg'),
  // 2022 concert (Combins, Noseda + Fedorova + VFO)
  concert1: VP('2022/CONCERTS/15072022_Combins_Noseda&Fedorova&VFO/Mainstage/150722_Combins_Noseda&Fedorova&VFO_NicolasBrodard/WEB/150722 _combins_noseda&fedorova&vfo_03__R7A6216_(c)nicolasbrodard_noseda.jpg'),
  concert2: VP('2022/CONCERTS/15072022_Combins_Noseda&Fedorova&VFO/Mainstage/150722_Combins_Noseda&Fedorova&VFO_NicolasBrodard/WEB/150722 _combins_noseda&fedorova&vfo_04__R7A6223_(c)nicolasbrodard_noseda.jpg'),
  concert3: VP('2022/CONCERTS/15072022_Combins_Noseda&Fedorova&VFO/Mainstage/150722_Combins_Noseda&Fedorova&VFO_NicolasBrodard/WEB/150722 _combins_noseda&fedorova&vfo_01__R7A6187_(c)nicolasbrodard_noseda_vfo.jpg'),
  pianoEglise: VP('2022/EVENTS/21072022_PianoPletnev_eglise_JanoshOurtilane/HD/21072022_eglise_PianoPletnev_JanoshOurtilane-15.jpg'),
  // Wide concert hall shot with the Verbier Festival logo visible
  combinsHall: VP('2022/CONCERTS/15072022_Combins_Noseda&Fedorova&VFO/Mainstage/150722_Combins_NOSEDA_FEDOROVA_@LucienGrandjean/HD/15072022_19h_salledescombins_©LucienGrandjean-15_noseda_fedorova_vfo.jpg'),
};

// Slideshow rotation through the festival background
const PICKER_BG_PHOTOS = [
  PHOTO.panorama1, PHOTO.tentScenery1, PHOTO.concert1, PHOTO.combinsHall,
  PHOTO.tentLandscape, PHOTO.panorama2, PHOTO.concert3, PHOTO.tentScenery2,
  PHOTO.vincentRiba,
];

const PIECE_META = {
  Mozart: {
    composer: 'Wolfgang Amadeus Mozart',
    title: 'Don Giovanni · Overture',
    subtitle: 'K. 527',
    duration: '5:27',
    video: '/lens-media/Mozart/VIDEO_AUDIO/Mozart_Video.mp4',
    posterTone: ['#7b80f7', '#f78b7b'],
  },
  Haydn: {
    composer: 'Joseph Haydn',
    title: 'Die Schöpfung · Nr. 28',
    subtitle: 'Vollendet ist das große Werk',
    duration: '2:35',
    video: '/lens-media/Haydn/VIDEO_AUDIO/Haydn_video.mp4',
    posterTone: ['#f5a623', '#7bd5f7'],
  },
  Beethoven: {
    composer: 'Ludwig van Beethoven',
    title: 'Symphony excerpt',
    subtitle: 'tutti orchestra',
    duration: '1:00',
    video: '/lens-media/Beethoven/VIDEO_AUDIO/Beethoven_video.mp4',
    posterTone: ['#f06c9b', '#7c6cf0'],
  },
  Mozart_40: {
    composer: 'Wolfgang Amadeus Mozart',
    title: 'Symphony No. 40 · I. Molto Allegro',
    subtitle: 'K. 550 · G minor',
    duration: '14:41',
    video: null,
    posterPhoto: PHOTO.concert1,
    posterTone: ['#3a4ed8', '#f06c9b'],
  },
  Mozart_Haffner: {
    composer: 'Wolfgang Amadeus Mozart',
    title: 'Symphony No. 35 "Haffner" · I. Allegro',
    subtitle: 'K. 385 · D major',
    duration: '5:38',
    video: null,
    posterPhoto: PHOTO.concert2,
    posterTone: ['#4ecdc4', '#7c6cf0'],
  },
  Schubert: {
    composer: 'Franz Schubert',
    title: 'Symphony No. 9 "The Great" · I',
    subtitle: 'D. 944 · C major',
    duration: '3:30',
    video: null,
    posterPhoto: PHOTO.combinsHall,    // wide orchestra shot from Verbier Combins hall
    posterTone: ['#f5a623', '#f06c9b'],
  },
};

/**
 * Tutorial steps. Each step demonstrates ONE gesture with audible feedback.
 *   detector(state) → 0..1 — how strongly the gesture is being performed
 *   apply(engine, t)         — drive engine setters using detector value
 *   cleanup(engine)          — reset the controlled effect to neutral
 *
 * The tutorial holds a meter for HOLD_TARGET seconds when detector >= 0.5;
 * once full, it auto-advances. Users can also skip with the Next button.
 */
const TUTORIAL_STEPS = [
  {
    emoji: '👋',
    title: 'Wave hello',
    instruction: 'Hold BOTH hands up to the camera. Both skeletons need to be tracked before we can begin.',
    hint: 'No effect yet — just confirm the camera sees both your hands.',
    detector: ({ hands }) => (hands?.Left && hands?.Right) ? 1 : 0,
    apply: () => {},
    cleanup: () => {},
  },
  {
    emoji: '🌟',
    title: 'Raise LEFT hand',
    instruction: 'Lift your LEFT hand smoothly — passing the camera horizon already starts to brighten.',
    hint: 'Listen: violins and high winds gain sparkle in proportion to your hand height.',
    detector: ({ hands }) => {
      if (!hands?.Left) return 0;
      const y = hands.Left[0].y;
      // Maps so y=0.5 (frame middle, "camera horizon") → 0.64, comfortably
      // above the meter's hold threshold; y=0.95 → 0; y=0.25 → 1.
      return Math.max(0, Math.min(1, (0.95 - y) / 0.7));
    },
    apply: (engine, t) => engine.setEqHigh(t * 24),
    cleanup: (engine) => engine.setEqHigh(0),
  },
  {
    emoji: '🎺',
    title: 'Sweep LEFT hand ACROSS',
    instruction: 'Sweep your LEFT hand past the screen midline toward the RIGHT side.',
    hint: 'Listen: melody and brass come closer as your hand crosses the centerline.',
    detector: ({ hands }) => {
      if (!hands?.Left) return 0;
      // Cross-body: LEFT hand crossing the midline toward display-RIGHT
      // (after CSS scaleX(-1) flip, display-right = LOW raw x).
      // Triggers as soon as the hand passes raw x ≈ 0.55 (just past center).
      const x = hands.Left[0].x;
      return Math.max(0, Math.min(1, (0.55 - x) / 0.25));
    },
    apply: (engine, t) => engine.setEqMid(t * 24),
    cleanup: (engine) => engine.setEqMid(0),
  },
  {
    emoji: '✊',
    title: 'CLOSE your LEFT fist',
    instruction: 'Make a tight fist with your LEFT hand to thicken the bass.',
    hint: 'Listen: cellos and basses gain real weight when you close your fist.',
    detector: ({ gestures }) => gestures?.leftFistClosed ? 1 : 0,
    apply: (engine, t) => engine.setEqLow(t * 24),       // full boost
    cleanup: (engine) => engine.setEqLow(0),
  },
  {
    emoji: '⛪',
    title: 'Raise RIGHT hand',
    instruction: 'Lift your RIGHT hand smoothly — past the camera horizon, you start opening the room.',
    hint: 'Listen: instruments gain space and tail in proportion to your hand height.',
    detector: ({ hands }) => {
      if (!hands?.Right) return 0;
      const y = hands.Right[0].y;
      return Math.max(0, Math.min(1, (0.95 - y) / 0.7));
    },
    apply: (engine, t) => engine.setReverbWet(t),
    cleanup: (engine) => engine.setReverbWet(0),
  },
  {
    emoji: '↔',
    title: 'Sweep RIGHT hand ACROSS',
    instruction: 'Sweep your RIGHT hand past the screen midline toward the LEFT side.',
    hint: 'Listen: the orchestra spreads wider as your hand crosses the centerline.',
    detector: ({ hands }) => {
      if (!hands?.Right) return 0;
      // Cross-body: RIGHT hand crossing midline toward display-LEFT
      // (display-left = HIGH raw x after CSS flip).
      const x = hands.Right[0].x;
      return Math.max(0, Math.min(1, (x - 0.45) / 0.25));
    },
    apply: (engine, t) => engine.setStereoWidth(1 + t * 2),  // up to 3.0
    cleanup: (engine) => engine.setStereoWidth(1),
  },
  {
    emoji: '🌊',
    title: 'CLOSE your RIGHT fist',
    instruction: 'Make a tight fist with your RIGHT hand to remove the attacks — only sustained tones remain.',
    hint: 'Listen: bowing softens, percussion fades, only the harmony hangs.',
    detector: ({ gestures }) => gestures?.rightFistClosed ? 1 : 0,
    apply: (engine, t) => engine.setHpssMix(0.5 + t * 0.5),
    cleanup: (engine) => engine.setHpssMix(0.5),
  },
  {
    emoji: '🤲',
    title: 'BOTH hands together — crescendo',
    instruction: 'Raise both hands together to grow the master volume; lower together for a hush.',
    hint: 'Listen: the whole orchestra rises and falls with you across the full range.',
    detector: ({ hands }) => {
      if (!hands?.Left || !hands?.Right) return 0;
      const avgY = (hands.Left[0].y + hands.Right[0].y) / 2;
      return Math.max(0, Math.min(1, (0.95 - avgY) / 0.7));
    },
    apply: (engine, t) => engine.setMasterGain(0.25 + t * 1.45),    // 0.25 → 1.7
    cleanup: (engine) => engine.setMasterGain(0.85),
  },
  {
    emoji: '⚡',
    title: 'Bring BOTH hands closer',
    instruction: 'Move both hands toward each other to compress the dynamics.',
    hint: 'Listen: soft details come forward as you squeeze the orchestra closer together.',
    detector: ({ gestures }) => {
      if (gestures?.handSpread === null || gestures?.handSpread === undefined) return 0;
      return Math.max(0, Math.min(1, 1 - gestures.handSpread));
    },
    apply: (engine, t) => engine.setCompressor(t),
    cleanup: (engine) => engine.setCompressor(0),
  },
];

const TUTORIAL_HOLD_TARGET_S = 4.5;  // seconds of "doing the gesture" before auto-advance — generous so users have time to react and listen

class App {
  constructor() {
    this.state = 'welcome';
    this.skipTutorial = false;
    this.engine = null;
    this.tracker = null;
    this.mapper = null;
    this.tutorialOverlay = null;
    this.tutorialStep = 0;
    this.tutorialHoldTime = 0;
    this.tutorialLastFrameTime = 0;
    this._tutorialResolve = null;
    this.overlay = null;
    this.currentPiece = null;
    this.cameraActive = false;
    this.overlayVisible = true;
    this.slidersVisible = false;
    this.gestureControlEnabled = true;  // disabled while user drags sliders
    this._lastFrameState = null;
    this._lastFrameTime = 0;

    this._bindEvents();
  }

  // ──────────────────────────────────────────────────────────────────
  //  State / screens
  // ──────────────────────────────────────────────────────────────────

  go(state) {
    this.state = state;
    document.querySelectorAll('.screen').forEach(el =>
      el.classList.toggle('active', el.id === `screen-${state}`));
    // Show the global "← Back" everywhere except the loading screen — the
    // user should always be able to bail out to the role-choice page.
    const gb = document.getElementById('global-back');
    if (gb) {
      const showBack = (state !== 'loading');
      gb.classList.toggle('visible', showBack);
    }
    // Location indicator — final breadcrumb segment changes per screen
    const loc = document.getElementById('loc-current');
    if (loc) {
      const labels = {
        welcome:     'Welcome',
        picker:      'Choose a Piece',
        loading:     'Loading',
        tutorial:    'Tutorial',
        demo:        this.currentPiece ? this._displayPieceName(this.currentPiece)
                                       : 'Perform',
      };
      loc.textContent = labels[state] || state;
    }
  }

  // Compact display name for the breadcrumb when on demo screen
  _displayPieceName(key) {
    const m = PIECE_META[key];
    if (!m) return 'Perform';
    return m.title.length > 36 ? m.title.slice(0, 34) + '…' : m.title;
  }

  _startBgSlideshow() {
    if (this._bgTimer) return;
    this._bgIdx = 0;
    this._bgSlot = 0;
    const slides = document.querySelectorAll('.picker-bg-slide');
    if (!slides.length) return;
    // First slide
    slides[0].style.backgroundImage = `url("${PICKER_BG_PHOTOS[0]}")`;
    slides[0].classList.add('active');
    // Rotate every 5.5 s with cross-fade
    this._bgTimer = setInterval(() => {
      this._bgIdx = (this._bgIdx + 1) % PICKER_BG_PHOTOS.length;
      const next = (this._bgSlot + 1) % 2;
      slides[next].style.backgroundImage = `url("${PICKER_BG_PHOTOS[this._bgIdx]}")`;
      slides[next].classList.add('active');
      slides[this._bgSlot].classList.remove('active');
      this._bgSlot = next;
    }, 5500);
  }

  _stopBgSlideshow() {
    if (this._bgTimer) { clearInterval(this._bgTimer); this._bgTimer = null; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  Event bindings
  // ──────────────────────────────────────────────────────────────────

  _bindEvents() {
    // Welcome screen
    $('#btn-begin').onclick = () => { this.skipTutorial = false; this.go('picker'); };
    $('#btn-quick-start').onclick = () => { this.skipTutorial = true; this.go('picker'); };

    // Piece picker — built dynamically from PIECE_META
    this._buildPieceRail();

    // Tutorial buttons
    $('#tut-next').onclick = () => this._tutorialAdvance(+1);
    $('#tut-back').onclick = () => this._tutorialAdvance(-1);
    $('#tut-skip-all').onclick = () => this._tutorialEnd();

    // Demo toolbar
    $('#btn-toggle-sliders').onclick = () => this._toggleSliders();
    $('#btn-toggle-overlay').onclick = () => this._toggleOverlay();
    $('#btn-pause').onclick = () => this._togglePause();
    $('#btn-back').onclick = () => this._goBackToPicker();

    // Presets — clicked from the demo toolbar
    document.querySelectorAll('.demo-presets button').forEach(b => {
      b.onclick = () => {
        this._applyPresetByName(b.dataset.preset, { source: 'click' });
      };
    });

    // Slider fallback
    this._bindSliders();

    // No-camera banner dismiss
    $('#btn-camera-dismiss').onclick = () => {
      $('#no-camera-banner').style.display = 'none';
      $('#slider-panel').classList.remove('hidden');
      this.slidersVisible = true;
    };
  }

  _bindSliders() {
    // Mapping each slider key → the canonical param name used by mapper.smoothed
    // so the HUD reflects slider edits as well as gesture edits.
    const SLIDER_TO_PARAM = {
      low: 'eqLow', mid: 'eqMid', high: 'eqHigh',
      rev: 'reverb', wid: 'width', hpss: 'hpss',
      cmp: 'comp', mst: 'master',
    };
    const SLIDER_TO_MAPPER_FN = {
      low: v => v, mid: v => v, high: v => v,
      rev: v => v / 100, wid: v => v, hpss: v => v,
      cmp: v => v / 100, mst: v => v / 100,
    };
    const hookup = (id, fn, fmt) => {
      const slider = $(`#r-${id}`);
      const valueEl = $(`#v-${id}`);
      const onChange = () => {
        if (!this.engine) return;
        this.gestureControlEnabled = false;
        const v = parseFloat(slider.value);
        fn(v);
        valueEl.textContent = fmt(v);
        // Also update mapper smoothed so HUD shows correct value
        if (this.mapper) {
          this.mapper.smoothed[SLIDER_TO_PARAM[id]] = SLIDER_TO_MAPPER_FN[id](v);
        }
      };
      slider.addEventListener('input', onChange);
      slider.addEventListener('change', () => {
        clearTimeout(this._reenableTimer);
        this._reenableTimer = setTimeout(() => {
          this.gestureControlEnabled = true;
          this._toast('Gesture control resumed');
        }, 2000);
      });
      return { slider, valueEl, fmt };
    };
    this._sliders = {
      low: hookup('low',  v => this.engine.setEqLow(v),    v => v.toFixed(1) + ' dB'),
      mid: hookup('mid',  v => this.engine.setEqMid(v),    v => v.toFixed(1) + ' dB'),
      high:hookup('high', v => this.engine.setEqHigh(v),   v => v.toFixed(1) + ' dB'),
      rev: hookup('rev',  v => this.engine.setReverbWet(v/100), v => Math.round(v) + '%'),
      wid: hookup('wid',  v => this.engine.setStereoWidth(v),   v => v.toFixed(2)),
      hpss:hookup('hpss', v => this.engine.setHpssMix(v),       v => v.toFixed(2)),
      cmp: hookup('cmp',  v => this.engine.setCompressor(v/100), v => Math.round(v) + '%'),
      mst: hookup('mst',  v => this.engine.setMasterGain(v/100), v => Math.round(v) + '%'),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Piece rail (horizontal scroll picker)
  // ──────────────────────────────────────────────────────────────────

  _ensurePreviewAudio() {
    if (this._previewAudio) return this._previewAudio;
    const a = new Audio();
    a.preload = 'auto';
    a.crossOrigin = 'anonymous';
    a.volume = 0;
    this._previewAudio = a;
    this._previewKey = null;
    return a;
  }

  _startCardPreview(pieceKey) {
    this._stopCardPreview();    // cancel any running fade
    const a = this._ensurePreviewAudio();
    // 30-second 96 kbps mp3 clip pre-extracted at 25 s into the piece —
    // tiny (~350 KB), loads almost instantly, plays the moment hover starts.
    const url = `/lens-assets/${pieceKey}/preview.mp3`;
    const switching = this._previewKey !== pieceKey;
    if (switching) {
      a.src = url;
      this._previewKey = pieceKey;
      try { a.currentTime = 0; } catch {}
    } else {
      // Same piece re-hovered: rewind to start of the preview clip
      try { a.currentTime = 0; } catch {}
    }
    a.volume = 0;
    a.play().catch(() => { /* autoplay blocked → silent */ });
    // Fade in to 0.55 over ~300 ms (slightly louder for clear preview feel)
    let v = 0;
    const TARGET = 0.55;
    this._previewFade = setInterval(() => {
      v = Math.min(TARGET, v + 0.07);
      a.volume = v;
      if (v >= TARGET) { clearInterval(this._previewFade); this._previewFade = null; }
    }, 35);
  }

  _stopCardPreview() {
    if (this._previewFade) { clearInterval(this._previewFade); this._previewFade = null; }
    const a = this._previewAudio;
    if (!a || a.paused) return;
    let v = a.volume;
    this._previewFade = setInterval(() => {
      v = Math.max(0, v - 0.07);
      a.volume = v;
      if (v <= 0) {
        clearInterval(this._previewFade);
        this._previewFade = null;
        try { a.pause(); } catch {}
      }
    }, 30);
  }

  _buildPieceRail() {
    const rail = $('#piece-rail');
    if (!rail) return;
    rail.innerHTML = '';
    Object.entries(PIECE_META).forEach(([key, meta]) => {
      const card = document.createElement('button');
      card.className = 'piece-card';
      card.dataset.piece = key;

      const hero = document.createElement('div');
      hero.className = 'hero';
      if (meta.video) {
        const v = document.createElement('video');
        v.src = meta.video;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = 'metadata';
        hero.appendChild(v);
        // Play preview video on hover, pause on leave
        card.addEventListener('mouseenter', () => {
          try { v.currentTime = 4; v.play(); } catch {}
        });
        card.addEventListener('mouseleave', () => {
          try { v.pause(); v.currentTime = 4; } catch {}
        });
      } else if (meta.posterPhoto) {
        // Real Verbier festival photo as hero
        const poster = document.createElement('div');
        poster.className = 'photo-poster';
        poster.style.backgroundImage = `url("${meta.posterPhoto}")`;
        hero.appendChild(poster);
      } else {
        const poster = document.createElement('div');
        poster.className = 'gradient-poster';
        const [c1, c2] = meta.posterTone || ['#7b80f7', '#f78b7b'];
        poster.style.background =
          `radial-gradient(circle at 30% 30%, ${c1}55, transparent 60%),
           radial-gradient(circle at 70% 70%, ${c2}55, transparent 60%),
           linear-gradient(135deg, ${c1}22, ${c2}22)`;
        const initials = (meta.composer || '').split(' ')
          .map(s => s[0]).filter(c => /[A-Z]/.test(c)).join('');
        poster.textContent = initials || '♪';
        hero.appendChild(poster);
      }

      // Audio preview on hover/focus — shared single HTMLAudioElement so we
      // never pile up overlapping previews. Plays a snippet from ~25 s in
      // (past intros) and fades in/out for a polished feel.
      const startPreview = () => this._startCardPreview(key);
      const stopPreview = () => this._stopCardPreview();
      card.addEventListener('mouseenter', startPreview);
      card.addEventListener('mouseleave', stopPreview);
      card.addEventListener('focus', startPreview);
      card.addEventListener('blur', stopPreview);

      const metaWrap = document.createElement('div');
      metaWrap.className = 'meta';
      metaWrap.innerHTML = `
        <div class="composer">${meta.composer}</div>
        <div class="title">${meta.title}</div>
        <div class="footer">
          <span>${meta.subtitle || ''}</span>
          <span class="duration">${meta.duration || ''}</span>
        </div>
      `;
      card.appendChild(hero);
      card.appendChild(metaWrap);
      card.onclick = () => this._loadPiece(key);
      rail.appendChild(card);
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  Loading flow
  // ──────────────────────────────────────────────────────────────────

  async _loadPiece(pieceKey) {
    this.currentPiece = pieceKey;
    this.go('loading');
    $('#loading-text').textContent = `Loading ${pieceKey}…`;
    $('#loading-bar').style.width = '5%';

    try {
      if (!this.engine) {
        this.engine = new MusicLensEngine();
        await this.engine.init();
      }
      $('#loading-bar').style.width = '15%';

      const baseUrl = `/lens-assets/${pieceKey}`;
      const manifest = await (await fetch(`${baseUrl}/manifest.json`)).json();
      $('#loading-bar').style.width = '30%';

      const t0 = performance.now();
      await this.engine.loadPiece(manifest, baseUrl);
      const dt = ((performance.now() - t0) / 1000).toFixed(1);
      $('#loading-bar').style.width = '70%';
      $('#loading-text').textContent =
        `Decoded in ${dt}s · ${manifest.duration.toFixed(0)}s @ ${manifest.sample_rate}Hz`;

      // Reset to Original preset for a fresh starting point. Apply via the
      // App-level helper so the mapper + sliders + button highlight stay
      // in sync (engine.applyPreset alone wouldn't reset mapper.smoothed).
      this._applyPresetByName('Original');

      // Bind video element to the piece (or hide it for audio-only pieces)
      const meta = PIECE_META[pieceKey];
      const videoEl = $('#performance-video');
      const videoHost = $('#video-host');
      if (meta.video) {
        videoEl.src = meta.video;
        videoEl.load();
        videoEl.style.display = '';
        if (videoHost) videoHost.style.background = '';
      } else {
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.style.display = 'none';
        // Decorative gradient stand-in for audio-only pieces
        if (videoHost) {
          const [c1, c2] = meta.posterTone || ['#7b80f7', '#f78b7b'];
          videoHost.style.background =
            `radial-gradient(circle at 30% 30%, ${c1}33, transparent 50%),
             radial-gradient(circle at 70% 70%, ${c2}33, transparent 50%),
             linear-gradient(135deg, #050a18, #0d1530)`;
        }
      }
      $('#demo-composer').textContent = meta.composer;
      $('#demo-title').textContent = meta.title;

      $('#loading-bar').style.width = '100%';
      await new Promise(r => setTimeout(r, 250));

      if (this.skipTutorial) {
        await this._enterDemo();
      } else {
        await this._runTutorial();
      }
    } catch (e) {
      console.error('Load failed:', e);
      $('#loading-text').textContent = `Error: ${e.message}`;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  Tutorial: guided one-gesture-at-a-time intro
  // ──────────────────────────────────────────────────────────────────

  async _runTutorial() {
    this.go('tutorial');
    $('#ghost-canvas')?.classList.add('shown');

    // Make sure camera + tracker are running. If denied, skip tutorial.
    const camOk = await this._initCameraAndTracker();
    if (!camOk) {
      this._toast('Camera unavailable — skipping tutorial');
      this.slidersVisible = true;
      $('#slider-panel')?.classList.remove('hidden');
      await this._enterDemo();
      return;
    }

    // Create gesture mapper (so the demo screen will reuse it later)
    if (!this.mapper) {
      this.mapper = new LensGestureMapper(this.engine);
    }
    // Disable mapper auto-driving — the tutorial controls effects directly
    this.mapper.setEnabled(false);

    // Set up overlay renderer for hand skeleton in tutorial
    if (!this.tutorialOverlay) {
      this.tutorialOverlay = new LensOverlayRenderer($('#tutorial-overlay-canvas'));
    }

    // Background: the actual performance video (or a gradient fallback for
    // audio-only pieces) so the tutorial feels like rehearsing inside the
    // concert. Will be re-shown on the demo screen at the same currentTime.
    const meta = PIECE_META[this.currentPiece];
    const tutBg = $('#tutorial-bg-video');
    const tutFallback = $('#tutorial-bg-fallback');
    if (meta?.video) {
      tutBg.src = meta.video;
      tutBg.style.display = '';
      tutFallback.style.display = 'none';
      try { tutBg.currentTime = 0; await tutBg.play(); } catch {}
    } else {
      tutBg.removeAttribute('src');
      tutBg.load();
      tutBg.style.display = 'none';
      const [c1, c2] = meta?.posterTone || ['#7b80f7', '#f78b7b'];
      tutFallback.style.display = '';
      tutFallback.style.background =
        `radial-gradient(circle at 30% 30%, ${c1}55, transparent 60%),
         radial-gradient(circle at 70% 70%, ${c2}55, transparent 60%),
         linear-gradient(135deg, #050a18, #0d1530)`;
    }

    // Apply the Original baseline so each tutorial step starts neutral
    this._applyPresetByName('Original');

    // Start audio engine playback so the user hears effect changes
    this.engine.play(0);

    // Re-attach tracker to feed the tutorial frame handler
    this.tracker.start(state => this._onTutorialFrame(state));
    // Ghost overlay for selfie segmentation — same as demo
    this.tracker.onSegment = (mask, video) => this._drawGhost(mask, video);

    // Begin step 0
    this.tutorialStep = 0;
    this.tutorialHoldTime = 0;
    this.tutorialLastFrameTime = performance.now();
    this._showTutorialStep(0);

    // Wait until tutorial completes (resolved by _tutorialEnd or last step)
    await new Promise(resolve => { this._tutorialResolve = resolve; });

    // Cleanup current step's effect
    TUTORIAL_STEPS[this.tutorialStep]?.cleanup?.(this.engine);
    // Re-apply Original so demo starts from a clean baseline
    this._applyPresetByName('Original');

    // Re-enable mapper for free-play in demo
    this.mapper.setEnabled(true);

    await this._enterDemo();
  }

  _showTutorialStep(idx) {
    if (idx < 0 || idx >= TUTORIAL_STEPS.length) return;
    // Cleanup the previous step's effect before showing the next
    if (this.tutorialStep !== idx && TUTORIAL_STEPS[this.tutorialStep]?.cleanup) {
      TUTORIAL_STEPS[this.tutorialStep].cleanup(this.engine);
    }
    this.tutorialStep = idx;
    this.tutorialHoldTime = 0;
    // Suppression window: ignore detector input for 400ms after step change
    // so a leftover pose from the previous step can't auto-advance us.
    this.tutorialSuppressUntil = performance.now() + 400;
    const step = TUTORIAL_STEPS[idx];
    $('#tut-step-num').textContent = idx + 1;
    $('#tut-total').textContent = TUTORIAL_STEPS.length;
    $('#tut-emoji').textContent = step.emoji;
    $('#tut-title').textContent = step.title;
    $('#tut-instruction').textContent = step.instruction;
    $('#tut-listen-hint').textContent = step.hint || '';
    $('#tut-meter-fill').style.width = '0%';
    $('#tut-back').disabled = (idx === 0);
    $('#tut-next').textContent = (idx === TUTORIAL_STEPS.length - 1)
      ? 'Finish ✓' : 'Next →';
  }

  _tutorialAdvance(delta) {
    const next = this.tutorialStep + delta;
    if (next >= TUTORIAL_STEPS.length) {
      this._tutorialEnd();
    } else if (next >= 0) {
      this._showTutorialStep(next);
    }
  }

  _tutorialEnd() {
    if (this._tutorialResolve) {
      this._tutorialResolve();
      this._tutorialResolve = null;
    }
  }

  _onTutorialFrame(state) {
    if (this.state !== 'tutorial') return;
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (!step) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.tutorialLastFrameTime) / 1000);
    this.tutorialLastFrameTime = now;

    const detected = step.detector(state);
    step.apply(this.engine, detected);

    // Suppress meter input briefly after a step change (avoids
    // auto-advancing on a leftover pose from the previous step).
    const suppressed = now < (this.tutorialSuppressUntil || 0);

    // Hold meter — require detector >= 0.6 (deliberate gesture, not a
    // resting position that happens to land just over 0.5)
    const HOLD_THRESHOLD = 0.6;
    if (!suppressed && detected >= HOLD_THRESHOLD) {
      this.tutorialHoldTime = Math.min(TUTORIAL_HOLD_TARGET_S,
        this.tutorialHoldTime + dt);
    } else {
      this.tutorialHoldTime = Math.max(0, this.tutorialHoldTime - dt * 0.6);
    }
    const pct = (this.tutorialHoldTime / TUTORIAL_HOLD_TARGET_S) * 100;
    const fill = $('#tut-meter-fill');
    if (fill) fill.style.width = pct + '%';

    if (this.tutorialHoldTime >= TUTORIAL_HOLD_TARGET_S) {
      this.tutorialHoldTime = 0;  // reset before advancing
      this._tutorialAdvance(+1);
    }

    // Render hand skeleton overlay
    if (this.tutorialOverlay) {
      this.tutorialOverlay.render({
        hands: state.hands,
        gestures: state.gestures,
        params: null,
        vuLevel: this.engine.getMasterRms(),
        fps: state.fps,
      });
    }
  }

  async _initCameraAndTracker() {
    if (!this.tracker) {
      this.tracker = new LensHandTracker();
      const webcamVideo = $('#webcam-video');
      const result = await this.tracker.init(webcamVideo);
      if (!result.success) {
        this.cameraActive = false;
        // Show banner only if we're going to enter demo with no camera
        return false;
      }
      this.cameraActive = true;
      return true;
    }
    return this.cameraActive;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Demo screen entry
  // ──────────────────────────────────────────────────────────────────

  async _enterDemo() {
    this.go('demo');

    // Initialize overlay renderer
    if (!this.overlay) {
      this.overlay = new LensOverlayRenderer($('#overlay-canvas'));
    }

    // Initialize gesture mapper if not yet, then seed its smoothed state
    // from the engine's current values (so the HUD doesn't snap to zero on
    // first render after a preset was applied during loading).
    if (!this.mapper) {
      this.mapper = new LensGestureMapper(this.engine);
    }
    if (this.engine) {
      const e = this.engine;
      this.mapper.smoothed.eqLow = e.eqLow.gain.value;
      this.mapper.smoothed.eqMid = e.eqMid.gain.value;
      this.mapper.smoothed.eqHigh = e.eqHigh.gain.value;
      this.mapper.smoothed.master = e.master.gain.value;
      // The other params are derived; leave their defaults
    }

    // If a tracker exists from calibration, just stop its callback (we'll
    // restart with the demo callback). Don't re-init webcam — that would
    // trigger a second permission prompt.
    if (this.tracker && this.cameraActive) {
      this.tracker.onFrame = null;
    } else if (!this.tracker && this.cameraActive) {
      // Path: camera was meant to be active but tracker never created
      this.tracker = new LensHandTracker();
      const result = await this.tracker.init($('#webcam-video'));
      if (!result.success) this.cameraActive = false;
    }

    if (!this.cameraActive) {
      $('#no-camera-banner').style.display = 'block';
    } else {
      $('#no-camera-banner').style.display = 'none';
      this.tracker.start(state => this._onFrame(state));
      // Ghost overlay: segmented webcam person blended over the video
      this.tracker.onSegment = (mask, video) => this._drawGhost(mask, video);
    }

    // Start audio + (optional) video. Hand off currentTime from the tutorial
    // background video so playback feels continuous.
    const videoEl = $('#performance-video');
    const hasVideo = videoEl && videoEl.style.display !== 'none' && videoEl.src;
    const tutBg = $('#tutorial-bg-video');
    const handoffTime = (tutBg && tutBg.src && !tutBg.paused) ? tutBg.currentTime : 0;
    if (hasVideo) {
      try {
        videoEl.currentTime = handoffTime;
        await videoEl.play();
      } catch (e) {
        console.warn('Video autoplay blocked:', e);
      }
    }
    // Stop the tutorial bg video now that demo's own video is running
    if (tutBg) { try { tutBg.pause(); } catch {} }
    this.engine.play(handoffTime);
    $('#ghost-canvas')?.classList.add('shown');

    if (this._syncTimer) clearInterval(this._syncTimer);
    if (hasVideo) {
      this._syncTimer = setInterval(() => {
        if (!this.engine.isPlaying) return;
        const audioT = this.engine.getCurrentTime();
        const drift = videoEl.currentTime - audioT;
        if (Math.abs(drift) > 0.4) {
          videoEl.currentTime = audioT;
        } else if (Math.abs(drift) > 0.08) {
          videoEl.playbackRate = drift > 0 ? 0.96 : 1.04;
        } else {
          videoEl.playbackRate = 1.0;
        }
      }, 250);
    }

    // Render loop for overlay HUD
    this._loopRender();
  }

  // Per-frame from hand tracker
  _onFrame(state) {
    if (this.gestureControlEnabled) {
      this.mapper.update(state.hands, state.gestures);
    }
    this._lastFrameState = state;
    this._lastFrameTime = performance.now();
  }

  _loopRender() {
    if (this.state !== 'demo') return;
    requestAnimationFrame(() => this._loopRender());
    if (!this.overlay) return;

    const params = this.mapper ? this.mapper.getCurrentParams()
                               : this._readEngineParams();
    const vu = this.engine ? this.engine.getMasterRms() : 0;
    const stale = (performance.now() - this._lastFrameTime) > 250;
    const hands = (stale || !this._lastFrameState) ? null : this._lastFrameState.hands;
    const gestures = (stale || !this._lastFrameState) ? null : this._lastFrameState.gestures;
    const fps = this._lastFrameState?.fps || 0;

    if (this.overlayVisible) {
      this.overlay.render({ hands, gestures, params, vuLevel: vu, fps });
    } else {
      this.overlay.ctx.clearRect(0, 0, this.overlay.canvas.width, this.overlay.canvas.height);
    }

    // Real-time waveform visualizer (pre vs post effects)
    this._drawVisualizer();

    // Live gesture operation labels
    this._updateGestureLabels(params);

    // Sync sliders to actual gesture-driven params (so user sees state)
    if (this.gestureControlEnabled && this.slidersVisible) {
      this._syncSlidersFromMapper(params);
    }
  }

  /**
   * Convert the smoothed param state into a list of human-readable
   * "what's happening right now" chips. Each chip has a stable `key` so
   * the DOM can diff frame-to-frame without churning.
   */
  _describeParams(p) {
    const out = [];
    // EQ
    if (p.eqLow > 3) out.push({ key: 'low', cat: 'low', icon: '🎸', text: 'Bass boost', value: `+${p.eqLow.toFixed(1)} dB` });
    else if (p.eqLow < -3) out.push({ key: 'low', cat: 'low', icon: '🎸', text: 'Bass cut', value: `${p.eqLow.toFixed(1)} dB` });
    if (p.eqMid > 3) out.push({ key: 'mid', cat: 'mid', icon: '🎺', text: 'Mid push', value: `+${p.eqMid.toFixed(1)} dB` });
    else if (p.eqMid < -3) out.push({ key: 'mid', cat: 'mid', icon: '🎺', text: 'Mid scoop', value: `${p.eqMid.toFixed(1)} dB` });
    if (p.eqHigh > 3) out.push({ key: 'high', cat: 'high', icon: '✨', text: 'Treble brighten', value: `+${p.eqHigh.toFixed(1)} dB` });
    else if (p.eqHigh < -3) out.push({ key: 'high', cat: 'high', icon: '✨', text: 'Treble dim', value: `${p.eqHigh.toFixed(1)} dB` });
    // Reverb
    if (p.reverb > 0.10) {
      out.push({ key: 'reverb', cat: 'reverb', icon: '⛪', text: 'Reverb opening', value: `${Math.round(p.reverb * 100)}%` });
    }
    // Stereo width (1.0 is neutral)
    if (p.width > 1.15) out.push({ key: 'width', cat: 'width', icon: '↔️', text: 'Stereo widening', value: `×${p.width.toFixed(2)}` });
    else if (p.width < 0.85) out.push({ key: 'width', cat: 'width', icon: '↔️', text: 'Stereo narrowing', value: `×${p.width.toFixed(2)}` });
    // HPSS (0.5 is neutral mix)
    if (p.hpss > 0.6) out.push({ key: 'hpss', cat: 'hpss', icon: '🌊', text: 'Smoothing attacks', value: p.hpss.toFixed(2) });
    else if (p.hpss < 0.4) out.push({ key: 'hpss', cat: 'hpss', icon: '🥁', text: 'Boosting transients', value: p.hpss.toFixed(2) });
    // Compressor
    if (p.comp > 0.15) out.push({ key: 'comp', cat: 'comp', icon: '⚡', text: 'Compressing dynamics', value: `${Math.round(p.comp * 100)}%` });
    // Master gain (0.85 is neutral)
    if (p.master > 1.05) out.push({ key: 'master', cat: 'master', icon: '🔊', text: 'Crescendo', value: `×${p.master.toFixed(2)}` });
    else if (p.master < 0.65) out.push({ key: 'master', cat: 'master', icon: '🔉', text: 'Diminuendo', value: `×${p.master.toFixed(2)}` });
    return out;
  }

  _updateGestureLabels(p) {
    const container = $('#gesture-feedback');
    if (!container || !p) return;
    const desired = this._describeParams(p);
    const desiredKeys = new Set(desired.map(d => d.key));

    // Remove chips that are no longer wanted (with exit animation)
    container.querySelectorAll('.gesture-chip').forEach(el => {
      if (!desiredKeys.has(el.dataset.key) && !el.classList.contains('exit')) {
        el.classList.add('exit');
        setTimeout(() => el.remove(), 320);
      }
    });

    // Add or update chips that should exist
    desired.forEach(d => {
      let el = container.querySelector(`.gesture-chip[data-key="${d.key}"]:not(.exit)`);
      if (!el) {
        el = document.createElement('div');
        el.className = `gesture-chip cat-${d.cat}`;
        el.dataset.key = d.key;
        el.innerHTML = `<span class="ch-icon">${d.icon}</span>` +
                       `<span class="ch-text"></span>` +
                       `<span class="ch-value"></span>`;
        container.appendChild(el);
      }
      const tEl = el.querySelector('.ch-text');
      const vEl = el.querySelector('.ch-value');
      if (tEl.textContent !== d.text) tEl.textContent = d.text;
      if (vEl.textContent !== d.value) vEl.textContent = d.value;
    });
  }

  _drawVisualizer() {
    const canvas = $('#vis-canvas');
    if (!canvas || !this.engine || !this.engine.isPlaying) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== cssW * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // FFT bin count = fftSize / 2
    const N = this.engine.analyserPre.frequencyBinCount;
    if (!this._visBufferPre || this._visBufferPre.length !== N) {
      this._visBufferPre = new Float32Array(N);
      this._visBufferPost = new Float32Array(N);
    }
    const pre = this.engine.getPreSpectrum(this._visBufferPre);
    const post = this.engine.getPostSpectrum(this._visBufferPost);
    if (!pre || !post) return;

    const sr = this.engine.ctx.sampleRate;
    const fft = this.engine.analyserPre.fftSize;
    const F_LO = 40;       // Hz — show 40 Hz to 16 kHz on log axis
    const F_HI = 16000;
    const DB_LO = -90;
    const DB_HI = -10;
    const logLo = Math.log10(F_LO), logHi = Math.log10(F_HI);
    const xToFreq = (x) => Math.pow(10, logLo + (x / cssW) * (logHi - logLo));
    const dbToY = (db) => {
      const t = Math.max(0, Math.min(1, (db - DB_LO) / (DB_HI - DB_LO)));
      return cssH - t * (cssH - 4);
    };

    // Light grid: octave markers at 100 Hz, 1 kHz, 10 kHz
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    [100, 1000, 10000].forEach(f => {
      const x = ((Math.log10(f) - logLo) / (logHi - logLo)) * cssW;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();
    });

    // Build the points along the curve once per dataset
    const buildPoints = (data) => {
      const points = [];
      let lastX = -2;
      for (let x = 0; x <= cssW; x += 1) {
        const f = xToFreq(x);
        const bin = Math.round(f * fft / sr);
        if (bin <= 0 || bin >= N) continue;
        const db = data[bin];
        if (!isFinite(db)) continue;
        if (x - lastX < 1) continue;     // dedupe
        points.push([x, dbToY(db)]);
        lastX = x;
      }
      return points;
    };

    const drawArea = (data, fillRgba, strokeRgba, lineWidth) => {
      const pts = buildPoints(data);
      if (pts.length < 2) return;
      // Filled area below the curve
      ctx.fillStyle = fillRgba;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], cssH);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], cssH);
      ctx.closePath();
      ctx.fill();
      // Stroke just the top curve
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.strokeStyle = strokeRgba;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };

    // High-contrast palette: COOL CYAN for the original, WARM CORAL for the
    // reorchestrated — complementary hues so the difference is unmistakable.
    drawArea(pre,  'rgba(94, 215, 245, 0.18)', 'rgba(94, 215, 245, 1.0)',  1.5);   // cyan
    drawArea(post, 'rgba(255, 140, 90, 0.32)', 'rgba(255, 140, 90, 1.0)',  1.8);   // coral
  }

  /**
   * Composite the segmented webcam person onto the full-screen ghost canvas
   * so they appear, mirrored & translucent, "inside" the music video.
   *
   * @param {MPMask} mask - selfie segmentation result (categoryMask)
   * @param {HTMLVideoElement} video - the webcam <video> element
   */
  _drawGhost(mask, video) {
    if (!mask || !video || video.readyState < 2) return;
    const canvas = $('#ghost-canvas');
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || window.innerWidth;
    const H = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Pull the soft confidence mask (0..1 per pixel)
    let confData;
    try { confData = mask.getAsFloat32Array(); } catch { return; }
    const mw = mask.width, mh = mask.height;
    if (!this._maskCanvas || this._maskCanvas.width !== mw) {
      this._maskCanvas = document.createElement('canvas');
      this._maskCanvas.width = mw;
      this._maskCanvas.height = mh;
      this._maskImageData = this._maskCanvas.getContext('2d')
        .createImageData(mw, mh);
    }
    // Map confidence → soft alpha:
    //   below 0.20 → fully transparent (background)
    //   above 0.85 → fully opaque (clearly person)
    //   in between → smoothstep + gamma curve so the silhouette feathers
    //                naturally and aliasing noise around the edge dies down
    const data = this._maskImageData.data;
    const lo = 0.20, hi = 0.85;
    for (let i = 0, j = 0; i < confData.length; i++, j += 4) {
      const c = confData[i];
      let a;
      if (c <= lo)       a = 0;
      else if (c >= hi)  a = 1;
      else {
        const t = (c - lo) / (hi - lo);
        a = t * t * (3 - 2 * t);    // smoothstep
        a = Math.pow(a, 0.7);        // crispen mid range
      }
      data[j] = 255; data[j + 1] = 255; data[j + 2] = 255;
      data[j + 3] = (a * 255) | 0;
    }
    const maskCtx = this._maskCanvas.getContext('2d');
    maskCtx.clearRect(0, 0, mw, mh);
    maskCtx.putImageData(this._maskImageData, 0, 0);

    // Draw the mirrored webcam, fitted "cover" to canvas
    const vidAR = (video.videoWidth || 4) / (video.videoHeight || 3);
    const canvasAR = W / H;
    let dw, dh, dx, dy;
    if (canvasAR > vidAR) { dw = W; dh = W / vidAR; dx = 0;        dy = (H - dh) / 2; }
    else                  { dh = H; dw = H * vidAR; dx = (W - dw) / 2; dy = 0; }

    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);             // mirror horizontally so it tracks user
    // After scaleX(-1), x coords are reversed; recompute draw rect
    const drawX = W - dx - dw;
    ctx.drawImage(video, drawX, dy, dw, dh);
    // Apply mask only where person was detected. A small Gaussian blur on
    // the mask itself smooths the silhouette edge without softening the
    // person's interior.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.filter = 'blur(2px)';
    ctx.drawImage(this._maskCanvas, drawX, dy, dw, dh);
    ctx.filter = 'none';
    ctx.restore();
  }

  // Read params from engine when mapper isn't doing it
  _readEngineParams() {
    if (!this.engine) return null;
    return {
      eqLow: this.engine.eqLow.gain.value,
      eqMid: this.engine.eqMid.gain.value,
      eqHigh: this.engine.eqHigh.gain.value,
      reverb: this.engine.gainWet.gain.value, // approximation
      width: this.engine.gLL.gain.value,      // approximation, not exact
      hpss: 0.5, // can't easily reverse-derive
      comp: 0,
      master: this.engine.master.gain.value,
    };
  }

  /**
   * Apply a preset everywhere: engine + mapper smoothed state + sliders +
   * preset button highlight. Single source of truth so cross-piece state
   * stays consistent.
   */
  _applyPresetByName(name, { source = 'auto' } = {}) {
    if (!this.engine) return;
    const p = this.engine.applyPreset(name);

    // Highlight the active preset button
    document.querySelectorAll('.demo-presets button').forEach(x =>
      x.classList.toggle('active', x.dataset.preset === name));

    // Sync the gesture mapper's smoothed state
    if (this.mapper) {
      this.mapper.smoothed.eqLow = p.eqLow;
      this.mapper.smoothed.eqMid = p.eqMid;
      this.mapper.smoothed.eqHigh = p.eqHigh;
      this.mapper.smoothed.reverb = p.reverb;
      this.mapper.smoothed.width = p.width;
      this.mapper.smoothed.hpss = p.hpss;
      this.mapper.smoothed.comp = p.comp;
      this.mapper.smoothed.master = p.master;
    }

    // Sync sliders
    this._syncSlidersFromPreset(p);

    // If the preset came from a user click, suspend gesture control briefly
    // so the mapper doesn't immediately overwrite the preset back to a
    // gesture-driven value
    if (source === 'click') {
      this.gestureControlEnabled = false;
      clearTimeout(this._reenableTimer);
      this._reenableTimer = setTimeout(() => {
        this.gestureControlEnabled = true;
      }, 2000);
      this._toast(`Preset: ${name}`);
    }
  }

  _syncSlidersFromPreset(p) {
    const sliderVals = {
      low: p.eqLow,
      mid: p.eqMid,
      high: p.eqHigh,
      rev: p.reverb * 100,
      wid: p.width,
      hpss: p.hpss,
      cmp: p.comp * 100,
      mst: p.master * 100,
    };
    Object.entries(sliderVals).forEach(([key, val]) => {
      const s = this._sliders[key];
      if (!s) return;
      s.slider.value = val;
      s.valueEl.textContent = s.fmt(val);
    });
  }

  _syncSlidersFromMapper(params) {
    const set = (key, value) => {
      const s = this._sliders[key];
      if (!s) return;
      // Don't update value text every frame to avoid layout thrash
      if (Math.abs(parseFloat(s.slider.value) - value) > 0.01) {
        s.slider.value = value;
        s.valueEl.textContent = s.fmt(value);
      }
    };
    set('low', params.eqLow);
    set('mid', params.eqMid);
    set('high', params.eqHigh);
    set('rev', params.reverb * 100);
    set('wid', params.width);
    set('hpss', params.hpss);
    set('cmp', params.comp * 100);
    set('mst', params.master * 100);
  }

  // ──────────────────────────────────────────────────────────────────
  //  UI button handlers
  // ──────────────────────────────────────────────────────────────────

  _toggleSliders() {
    this.slidersVisible = !this.slidersVisible;
    $('#slider-panel').classList.toggle('hidden', !this.slidersVisible);
    $('#btn-toggle-sliders').classList.toggle('active', this.slidersVisible);
  }
  _toggleOverlay() {
    this.overlayVisible = !this.overlayVisible;
    $('#btn-toggle-overlay').classList.toggle('active', this.overlayVisible);
  }
  _togglePause() {
    if (!this.engine) return;
    if (this.engine.isPlaying) {
      this.engine.pause();
      $('#performance-video').pause();
      $('#btn-pause').textContent = '▶ Play';
    } else {
      const t = this.engine.startBufferTime;
      this.engine.play(t);
      $('#performance-video').play().catch(() => {});
      $('#btn-pause').textContent = '⏸ Pause';
    }
  }
  async _goBackToPicker() {
    if (this._syncTimer) clearInterval(this._syncTimer);
    // Keep tracker alive — just unhook the callback. Tearing it down would
    // require requesting webcam permission again on the next piece.
    if (this.tracker) {
      this.tracker.onFrame = null;
      this.tracker.onSegment = null;
    }
    if (this.engine) this.engine.stop();
    const v = $('#performance-video');
    v.pause();
    v.removeAttribute('src');
    v.load();
    const tutBg = $('#tutorial-bg-video');
    if (tutBg) {
      tutBg.pause();
      tutBg.removeAttribute('src');
      tutBg.load();
    }
    $('#ghost-canvas')?.classList.remove('shown');
    this.go('picker');
  }

  _toast(msg, ms = 1800) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('visible'), ms);
  }
}

function $(sel) { return document.querySelector(sel); }

// Boot
const _app = new App();
// Sync the global Back button with the initial screen state (the HTML
// already marks #screen-welcome .active, but go() hasn't been called yet)
document.getElementById('global-back')?.classList.add('visible');
// Expose for debugging in browser console
if (typeof window !== 'undefined') window.__lensApp = _app;
