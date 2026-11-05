"""Render, align, post-process and verify the final VO lines; write vo.json.
Run from anywhere: python -I voiceover/make_vo.py VO_DIR (writes VO_DIR/vo0N.wav and vo.json)"""
import sys, os, json, re, subprocess, tempfile, warnings
warnings.filterwarnings("ignore")
VO = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(VO, "raw"), exist_ok=True)
os.chdir(VO)
import numpy as np, soundfile as sf, soxr
from scipy.signal import butter, sosfilt, lfilter
from scipy.ndimage import minimum_filter1d
import synth3                      # loads Kokoro-82M (KModel) once
from lines import LINES

VOICE = "af_heart"
DEFAULT_SPEED = 0.95
OVERRIDES = {  # per-line engine settings
    "vo01": {"speed": 1.11},                         # 1.0 runs 7.1 s > 6.6 s budget
    "vo02": {"context_after": dict((l[0], l[2]) for l in LINES)["vo03"]},  # short-utterance mitigation
    # model put a 0.33 s pause inside "...back to the thread | the request came from"
    # (folded into the final /d/, 12 frames); cap /d/ at 5 frames and the space at 2
    "vo06": {"word_caps": {"thread": [5, 2]}},
}

def caps_for(toks, word_caps):
    """[[token_index, max_frames]] for the final phoneme of each named word and the space after it."""
    out, i = [], 1
    for t in toks:
        n = len(t.phonemes or "")
        if t.text in word_caps:
            out += [[i + n - 1, word_caps[t.text][0]], [i + n, word_caps[t.text][1]]]
        i += n + (1 if t.whitespace else 0)
    return out
SR_IN, SR_OUT, SPF = 24000, 48000, 600
PAD, TRIM_DB = 0.030, -50.0
TARGET_I, TP_MAX, TP_CEIL = -16.0, -1.5, -1.75
PUNCT = ".,:;!?"
LEAD = 2  # frames (25 ms each)

# ---------------- alignment ----------------
def word_spans(tokens, pred, audio):
    """Spoken-token spans (seconds, raw render time) from Kokoro's predicted durations,
    edges tightened to where the signal is above -45 dB (drops pause frames the model
    folds into a word's last phoneme)."""
    cum = np.concatenate([[0], np.cumsum(pred)])           # frame boundary of token k
    i = 1                                                   # pred index 0 is <bos>
    spans = []
    for t in tokens:
        n = len(t.phonemes or "")
        if n and t.phonemes not in PUNCT:
            # the decoder's audio leads the duration alignment by ~2 frames (measured
            # median 55 ms at pause boundaries, scripts/lagprobe.py; kokoro's own
            # join_timestamps uses 3 frames), so shift spans earlier by LEAD frames
            s = max(0, cum[i] - LEAD) * SPF
            e = max(0, cum[i + n] - LEAD) * SPF
            spans.append([t.text, s, e])
        i += n + (1 if t.whitespace else 0)
    hop = 120  # 5 ms
    rms = np.array([np.sqrt(np.mean(audio[k:k + 2 * hop] ** 2)) for k in range(0, len(audio) - 2 * hop, hop)])
    db = 20 * np.log10(rms / rms.max() + 1e-12)
    out = []
    for w, s, e in spans:
        a, b = s // hop, min(len(db), e // hop)
        loud = np.where(db[a:b] > -45)[0]
        if len(loud):
            s2, e2 = (a + loud[0]) * hop, (a + loud[-1]) * hop + 2 * hop
        else:
            s2, e2 = s, e
        out.append((w, s2 / SR_IN, min(e2, e) / SR_IN))
    return out

def script_words(src, spans):
    """Group spoken tokens back onto the script's own words (MikeGC <- Mike+GC, @MikeGC <- at+Mike+GC)."""
    res, j = [], 0
    for w in src.split():
        label = w.strip(PUNCT)
        target = re.sub(r"^@", "at", label).replace("-", "").replace("'", "").lower()
        acc, s0 = "", None
        while acc != target:
            tw, s, e = spans[j]; j += 1
            s0 = s if s0 is None else s0
            acc += tw.replace("-", "").replace("'", "").lower()
            if len(acc) > len(target) or not target.startswith(acc):
                raise RuntimeError(f"alignment mismatch at {w!r}: {acc!r}")
        res.append({"word": label, "start_s": s0, "end_s": e})
    assert j == len(spans), "unconsumed spoken tokens"
    return res

# ---------------- post ----------------
def trim(y):
    hop = int(0.005 * SR_IN); win = 2 * hop
    rms = np.array([np.sqrt(np.mean(y[k:k + win] ** 2)) for k in range(0, len(y) - win, hop)])
    db = 20 * np.log10(rms / rms.max() + 1e-12)
    on = np.where(db > TRIM_DB)[0]
    s = max(0, on[0] * hop - int(PAD * SR_IN))
    e = min(len(y), on[-1] * hop + win + int(PAD * SR_IN))
    out = y[s:e].astype(np.float64).copy()
    f = int(0.005 * SR_IN)
    ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, f))
    out[:f] *= ramp; out[-f:] *= ramp[::-1]
    return out, s

def phase_rotate(x, sr):
    """Broadcast-style phase rotator: three 2nd-order all-pass sections (120/250/400 Hz,
    Q 0.7). Magnitude response is flat; it only makes the asymmetric voice waveform
    more symmetric, lowering the crest factor so the limiter has less to do."""
    for f in (120, 250, 400):
        w0 = 2 * np.pi * f / sr; al = np.sin(w0) / (2 * 0.7); c = np.cos(w0)
        x = lfilter([1 - al, -2 * c, 1 + al], [1 + al, -2 * c, 1 - al], x)
    return x

def tp_limit(x, ceil_db):
    """Look-ahead true-peak limiter: gain computed on a 4x oversampled copy in 1 ms
    blocks, ~2 ms attack ramp, 50 ms release; returns (y, max gain reduction dB)."""
    os_ = 4
    up = soxr.resample(x, SR_OUT, SR_OUT * os_, quality="VHQ")
    c = 10 ** (ceil_db / 20)
    need = np.minimum(1.0, c / (np.abs(up) + 1e-12))
    B = SR_OUT * os_ // 1000
    nb = int(np.ceil(len(need) / B))
    need = np.pad(need, (0, nb * B - len(need)), constant_values=1.0).reshape(nb, B).min(1)
    g = minimum_filter1d(need, 5)
    rel, att = 1 - np.exp(-1 / 50.0), 1 - np.exp(-1 / 2.0)
    for k in range(1, nb):
        g[k] = min(g[k], g[k - 1] + (1 - g[k - 1]) * rel)
    for k in range(nb - 2, -1, -1):
        g[k] = min(g[k], g[k + 1] + (1 - g[k + 1]) * att)
    tb = (np.arange(nb) + 0.5) * 1e-3
    gs = np.interp(np.arange(len(x)) / SR_OUT, tb, g)
    return x * gs, float(-20 * np.log10(g.min())), float((g < 10 ** (-1 / 20)).mean())

def ebur(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af",
                        "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True)
    s = r.stderr[r.stderr.rindex("Summary:"):]
    return (float(re.search(r"I:\s+(-?[\d.]+) LUFS", s).group(1)),
            float(re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", s).group(1)))

def post(raw, out):
    x, s0 = trim(raw)
    x = sosfilt(butter(2, 70, "highpass", fs=SR_IN, output="sos"), x)
    x = phase_rotate(x, SR_IN)
    x = soxr.resample(x, SR_IN, SR_OUT, quality="VHQ")
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.join(td, "m.wav")
        sf.write(tmp, x, SR_OUT, subtype="FLOAT")
        I0, tp0 = ebur(tmp)
        gain = TARGET_I - I0
        for _ in range(6):
            y, gr, gr_frac = tp_limit(x * 10 ** (gain / 20), TP_CEIL)
            sf.write(out, y, SR_OUT, subtype="PCM_24")
            I, tp = ebur(out)
            if abs(I - TARGET_I) <= 0.05 and tp <= TP_MAX:
                break
            gain += TARGET_I - I
    return {"trim_start_s": s0 / SR_IN, "pre_I": I0, "pre_TP": tp0, "gain_db": round(gain, 2),
            "limiter_max_gr_db": round(gr, 2), "limiter_time_over_1db_pct": round(100 * gr_frac, 1), "I": I, "TP": tp, "dur": len(y) / SR_OUT}

# ---------------- main ----------------
lines_out = []
for name, src, spoken, budget in LINES:
    cfg = {"text": spoken, "voice": VOICE, "speed": DEFAULT_SPEED, "out": f"raw/final_{name}.wav"}
    cfg.update(OVERRIDES.get(name, {}))
    p = synth3.pipe_for(VOICE)
    ps_line, toks = p.g2p(spoken)
    if "word_caps" in cfg:
        cfg["dur_caps"] = caps_for(toks, cfg.pop("word_caps"))
    r = synth3.render(cfg)                      # writes raw 24 kHz float render
    raw, _ = sf.read(cfg["out"], dtype="float32")
    pred = np.array(r["pred"])
    assert r["phonemes"] == ps_line
    spans = word_spans(toks, pred, raw)
    words = script_words(src, spans)
    final = f"{name}.wav"
    pr = post(raw, final)
    dur = pr["dur"]
    for w in words:
        w["start_s"] = round(max(0.0, w["start_s"] - pr["trim_start_s"]), 3)
        w["end_s"] = round(min(dur, w["end_s"] - pr["trim_start_s"]), 3)
    lines_out.append({
        "file": f"{name}.wav", "text_script": src, "text_spoken": spoken,
        "phonemes": ps_line, "speed": cfg["speed"],
        "context_after": cfg.get("context_after"), "dur_caps": cfg.get("dur_caps"),
        "duration_s": round(dur, 3), "budget_s": budget, "air_s": round(budget - dur, 3),
        "integrated_lufs": pr["I"], "true_peak_dbtp": pr["TP"],
        "post": {k: pr[k] for k in ("pre_I", "pre_TP", "gain_db", "limiter_max_gr_db", "limiter_time_over_1db_pct")},
        "words": words})
    print(name, round(dur, 3), "/", budget, pr, flush=True)

json.dump(lines_out, open("raw/lines_out.json", "w"), indent=1, ensure_ascii=False)

import importlib.metadata as md
doc = {
  "project": "Product launch film - scratch (temporary) voiceover",
  "engine": {
    "name": "Kokoro (StyleTTS2-based neural TTS), run on CPU with PyTorch",
    "python_package": f"kokoro {md.version('kokoro')} (Apache-2.0)",
    "g2p": f"misaki {md.version('misaki')} (Apache-2.0), American English lexicon + spaCy en_core_web_sm {md.version('en_core_web_sm')} (MIT) for POS; espeak-ng fallback was loaded but not needed for any word in these lines",
    "torch": md.version("torch"),
    "inference_note": "KModel weights and modules unchanged; integer frame durations allocated by cumulative rounding so `speed` is applied linearly (stock per-token rounding barely shortens speech for speeds 1.05-1.12). See scripts/synth3.py.",
  },
  "model": {
    "repo": "huggingface.co/hexgrad/Kokoro-82M",
    "revision": "f3ff3571791e39611d31c381e3a41a3af07b4987",
    "weights": "kokoro-v1_0.pth (Kokoro v1.0, 82M params)",
    "weights_sha256": "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4",
    "license": "Apache-2.0 (model card: 'Apache-licensed model ... can be deployed anywhere from production environments to personal projects')",
    "training_data_note": "Model card: trained on permissive/non-copyrighted audio (public domain, Apache/MIT-licensed audio, synthetic audio from closed TTS providers). CC BY attributions listed on the card (Koniwa CC BY 3.0, SIWIS CC BY 4.0) relate to the Japanese and French voices, not af_heart.",
  },
  "voice": {
    "id": "af_heart", "accent": "American English, female",
    "file": "voices/af_heart.pt", "sha256": "0ab5709b8ffab19bfd849cd11d98f75b60af7733253ad0d67b12382a102cb4ff",
    "license": "Apache-2.0 (ships in the Kokoro-82M repo)",
    "upstream_grade": "A (highest in VOICES.md)",
    "auditioned": ["af_heart", "af_bella", "bf_emma", "am_michael", "bm_george", "bf_isabella", "am_fenrir", "bm_fable"],
  },
  "speed_default": DEFAULT_SPEED,
  "pronunciation": {
    "MikeOSS": "input 'Mike OSS' -> mˈIk ˌOˌɛsˈɛs (Mike O-S-S)",
    "MikeGC": "input 'Mike GC' -> mˈIk ʤˌisˈi (Mike G-C)",
    "@MikeGC": "input 'at Mike GC' -> æt mˈIk ʤˌisˈi",
  },
  "post": {
    "chain": "trim to 30 ms head/tail (threshold -50 dB re loudest 10 ms frame, 5 ms edge fades) -> 70 Hz 2nd-order Butterworth high-pass -> phase rotator (3 all-pass sections 120/250/400 Hz; flat magnitude, lowers crest factor) -> soxr VHQ resample 24 -> 48 kHz -> linear gain to -16.0 LUFS + look-ahead true-peak limiter (4x oversampled, ceiling -1.75 dBTP), gain iterated against ffmpeg ebur128 -> 48 kHz mono PCM 24-bit. No reverb, no EQ beyond the high-pass.",
    "why_not_loudnorm": "Raw TTS peak-to-loudness ratio is 16-20 dB, above the 14.5 dB that -16 LUFS / -1.5 dBTP allows, so ffmpeg loudnorm linear mode fell back to dynamic mode (and missed the target on vo02). Linear gain + a brief true-peak limiter keeps the read uncompressed; limiter max gain reduction is listed per line.",
    "measured_with": "ffmpeg ebur128 (peak=true)",
  },
  "word_timing_method": "From the engine itself: Kokoro's predicted per-phoneme durations (25 ms frames), grouped onto words with misaki's tokens, shifted 2 frames earlier (decoder output leads the alignment by ~55 ms, measured at pause boundaries), word edges next to pauses tightened to where the signal is above -45 dB, then offset by the trim so times are relative to the start of the final WAV. Script words are reported (MikeGC = 'Mike'+'GC', @MikeGC = 'at'+'Mike'+'GC'); punctuation is stripped. Checked against exact acoustic pause edges (within +/-30 ms) and Whisper small.en word timestamps (median |diff| ~50 ms).",
  "lines": [{k: l[k] for k in ("file", "text_spoken", "duration_s", "speed", "words")} |
            {k: l[k] for k in ("text_script", "phonemes", "context_after", "dur_caps", "budget_s", "air_s",
                                "integrated_lufs", "true_peak_dbtp", "post") if l.get(k) is not None}
            for l in lines_out],
}
for l in doc["lines"]:
    if l.get("context_after"):
        l["context_note"] = ("Rendered in one pass followed by the vo03 text, then cut in the silent gap after "
                             "'Intake.' Kokoro reads very short sentences with a rising end (it rose ~6 st on "
                             "'Intake' when rendered alone); in context it lands as a calm statement.")
    if l.get("dur_caps"):
        l["prosody_note"] = ("The model put a 0.33 s silence between 'thread' and 'the request came from' "
                             "(no comma in the script). Capped the predicted duration of the final /d/ of "
                             "'thread' (12 -> 5 frames) and the following space (4 -> 2) so it reads as one phrase.")
    if l["speed"] > 1.0:
        l["speed_note"] = ("Raised from 0.95 for this line only: at 1.0 it runs 7.1 s, over the 6.6 s budget; "
                           "1.11 is the slowest that leaves ~0.1 s of air.")
json.dump(doc, open("vo.json", "w"), indent=2, ensure_ascii=False)
print("wrote vo.json")
