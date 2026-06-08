"""
align.py — score ↔ audio alignment via chroma DTW.

Shared module used by verify_score_alignment.py and score_informed_separate.py.

Key design choices:
- CENS chroma: normalized statistics, robust to dynamics/orchestration.
- subseq DTW: audio may have silence/applause before/after the score.
- Step constraint [[1,1],[1,2],[2,1]]: forbids path "plateaus" (cases where
  DTW walks purely horizontal/vertical, stuck at a single time).
- Weights [1, 2, 2]: diagonal step is preferred over 1:2 / 2:1 ratio steps.
"""

import numpy as np
import librosa
import pretty_midi


DEFAULT_FS = 25.0
DEFAULT_STEP_SIZES = np.array([[1, 1], [1, 2], [2, 1]])
DEFAULT_WEIGHTS = np.array([1.0, 2.0, 2.0])


def midi_chroma(pm, fs=DEFAULT_FS, ignore_programs=None):
    """CENS-like chroma from MIDI (pitch-class activity, L2-normalized)."""
    chroma = pm.get_chroma(fs=fs)
    if ignore_programs:
        # Subtract contributions from unwanted instruments (e.g. ghost "Piano")
        for inst in pm.instruments:
            if inst.program in ignore_programs:
                chroma -= _one_instrument_chroma(inst, fs=fs, length=chroma.shape[1])
        chroma = np.maximum(chroma, 0)
    # L2 normalize each column, with epsilon floor for empty frames
    chroma = chroma + 1e-6
    chroma = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-12)
    times = np.arange(chroma.shape[1]) / fs
    return chroma, times


def _one_instrument_chroma(inst, fs, length):
    """Helper: chroma contribution of one instrument."""
    ch = np.zeros((12, length), dtype=np.float32)
    for note in inst.notes:
        pc = note.pitch % 12
        f0 = int(np.floor(note.start * fs))
        f1 = int(np.ceil(note.end * fs))
        f0, f1 = max(0, f0), min(length, f1)
        if f1 > f0:
            ch[pc, f0:f1] += note.velocity / 127.0
    return ch


def audio_chroma(y, sr, fs=DEFAULT_FS):
    """CENS chroma on audio, resampled to target frame rate fs."""
    hop = max(1, int(round(sr / fs)))
    ch = librosa.feature.chroma_cens(y=y, sr=sr, hop_length=hop)
    # Trim to exact times
    ch = ch + 1e-6
    ch = ch / (np.linalg.norm(ch, axis=0, keepdims=True) + 1e-12)
    times = librosa.frames_to_time(np.arange(ch.shape[1]), sr=sr, hop_length=hop)
    return ch, times


def dtw_align(score_chroma, audio_chroma, subseq=True,
              step_sizes=DEFAULT_STEP_SIZES, weights=DEFAULT_WEIGHTS,
              metric='cosine'):
    """
    Align score chroma to audio chroma via DTW.
    Returns warp path wp (N, 2) in FRAME indices: [score_frame, audio_frame].
    """
    D, wp = librosa.sequence.dtw(
        X=score_chroma, Y=audio_chroma,
        metric=metric,
        step_sizes_sigma=step_sizes,
        weights_add=np.zeros(len(step_sizes)),
        weights_mul=weights,
        subseq=subseq,
    )
    wp = wp[::-1]  # librosa returns reverse order
    return D, wp


def warp_to_seconds(wp, fs):
    """Convert frame warp path to seconds."""
    return wp.astype(np.float64) / fs


def make_score_to_audio_mapper(wp_s):
    """Return a callable that maps score_time → audio_time."""
    xs = wp_s[:, 0]
    ys = wp_s[:, 1]
    # Enforce monotonic xs for np.interp correctness
    # (DTW path may have duplicate xs due to step constraints)
    # Use cummax of ys to enforce forward-only mapping
    ys_mono = np.maximum.accumulate(ys)
    def mapper(t):
        return np.interp(t, xs, ys_mono)
    return mapper


def alignment_quality(wp_s):
    """Compute a few summary stats about the warp path."""
    score_duration = wp_s[-1, 0] - wp_s[0, 0]
    audio_duration = wp_s[-1, 1] - wp_s[0, 1]
    slope = audio_duration / max(score_duration, 1e-6)
    # Deviation from the linear-tempo-ratio diagonal
    expected = slope * (wp_s[:, 0] - wp_s[0, 0]) + wp_s[0, 1]
    mean_dev = float(np.mean(np.abs(wp_s[:, 1] - expected)))
    max_dev = float(np.max(np.abs(wp_s[:, 1] - expected)))
    # Detect plateaus: consecutive frames with same score_time OR same audio_time
    dscore = np.diff(wp_s[:, 0])
    daudio = np.diff(wp_s[:, 1])
    frac_plateau = float(np.mean((dscore < 1e-3) | (daudio < 1e-3)))
    return {
        'slope': slope,
        'mean_dev': mean_dev,
        'max_dev': max_dev,
        'frac_plateau': frac_plateau,
        'score_range': (wp_s[0, 0], wp_s[-1, 0]),
        'audio_range': (wp_s[0, 1], wp_s[-1, 1]),
    }
