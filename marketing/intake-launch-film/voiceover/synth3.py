"""Kokoro-82M renderer (hexgrad/Kokoro-82M via the `kokoro` package's KModel/KPipeline).

Differences from KModel.forward: integer frame durations are allocated by
cumulative rounding of the predicted (speed-scaled) float durations, so the
`speed` value is honoured linearly. Stock per-token rounding barely changes
length for speeds of 1.05-1.12 because most predicted durations sit near 2.0
frames. Everything else (BERT, prosody predictor, F0/N, decoder) is unchanged.

Optional `context_after`: text rendered after the line in the same pass (so a
very short line gets in-context prosody); the audio is cut in the middle of the
pause between the line's final punctuation and the context.

Usage: synth3.py JOBS.json RESULTS.json
job: {text, voice, speed, out, context_after?, dur_caps?}
dur_caps: [[token_index, max_frames], ...] caps the predicted duration of single
tokens (index into the model's token sequence, 0 = <bos>) to shorten a pause the
model folded into a word-final phoneme.
"""
import sys, json, warnings
warnings.filterwarnings("ignore")
import numpy as np, soundfile as sf, torch
from kokoro import KPipeline, KModel

REPO = "hexgrad/Kokoro-82M"
SPF = 600  # samples per duration frame at 24 kHz
torch.set_num_threads(4)
torch.manual_seed(0)
model = KModel(repo_id=REPO).eval()
pipes = {}

def pipe_for(voice):
    lang = voice[0]
    if lang not in pipes:
        pipes[lang] = KPipeline(lang_code=lang, repo_id=REPO, model=model)
    return pipes[lang]

@torch.no_grad()
def kforward(ps, ref_s, speed, caps=None):
    m = model
    ids = [m.vocab[c] for c in ps if c in m.vocab]
    toks = [c for c in ps if c in m.vocab]
    input_ids = torch.LongTensor([[0, *ids, 0]])
    L = torch.full((1,), input_ids.shape[-1], dtype=torch.long)
    mask = torch.arange(L.max()).unsqueeze(0).expand(1, -1).type_as(L)
    mask = torch.gt(mask + 1, L.unsqueeze(1))
    bert_dur = m.bert(input_ids, attention_mask=(~mask).int())
    d_en = m.bert_encoder(bert_dur).transpose(-1, -2)
    s = ref_s[:, 128:]
    d = m.predictor.text_encoder(d_en, s, L, mask)
    x, _ = m.predictor.lstm(d)
    dur = torch.sigmoid(m.predictor.duration_proj(x)).sum(-1).squeeze() / speed
    for k, mx in (caps or {}).items():
        dur[k] = min(float(dur[k]), float(mx))
    # cumulative rounding, min 1 frame per token
    c = torch.round(torch.cumsum(dur, 0))
    pred = torch.diff(c, prepend=torch.zeros(1)).long()
    pred = pred.clamp(min=1)
    idx = torch.repeat_interleave(torch.arange(input_ids.shape[1]), pred)
    aln = torch.zeros((input_ids.shape[1], idx.shape[0]))
    aln[idx, torch.arange(idx.shape[0])] = 1
    aln = aln.unsqueeze(0)
    en = d.transpose(-1, -2) @ aln
    F0, N = m.predictor.F0Ntrain(en, s)
    t_en = m.text_encoder(input_ids, L, mask)
    audio = m.decoder(t_en @ aln, F0, N, ref_s[:, :128]).squeeze()
    return audio.numpy(), pred.numpy(), ['<s>', *toks, '</s>']

def render(job):
    p = pipe_for(job["voice"])
    pack = p.load_voice(job["voice"])
    ps_line, _ = p.g2p(job["text"])
    ps = ps_line
    if job.get("context_after"):
        ps_ctx, _ = p.g2p(job["context_after"])
        ps = ps_line + " " + ps_ctx
    caps = {int(k): v for k, v in job.get("dur_caps") or []}
    a, pred, toks = kforward(ps, pack[len(ps) - 1], job["speed"], caps)
    cut = None
    if job.get("context_after"):
        n_line = len([c for c in ps_line if c in model.vocab])
        # search window: from the line's last phoneme (before final punctuation)
        # to the end of the space token that separates it from the context
        lo = int(pred[: n_line].sum()) * SPF
        hi = int(pred[: n_line + 2].sum()) * SPF
        hop = 240  # 10 ms
        seg = a[lo:hi]
        db = np.array([20 * np.log10(np.sqrt(np.mean(seg[i:i + hop] ** 2)) + 1e-9)
                       for i in range(0, len(seg) - hop, hop)])
        quiet = db < -60
        best, run, best_span = 0, 0, (0, 0)
        for i, q in enumerate(quiet):
            run = run + 1 if q else 0
            if run > best:
                best, best_span = run, (i - run + 1, i + 1)
        if best == 0:
            raise RuntimeError("no silent gap found for context cut")
        cut = lo + ((best_span[0] + best_span[1]) // 2) * hop
        a = a[:cut]
    sf.write(job["out"], a, 24000, subtype="FLOAT")
    return {**job, "phonemes": ps_line, "phonemes_full_pass": ps, "n_tokens": len(ps),
            "frames": int(pred.sum()), "pred": [int(v) for v in pred], "raw_dur": round(len(a) / 24000, 3), "cut_sample": cut}

if __name__ == "__main__":
    jobs = json.load(open(sys.argv[1]))
    res = [render(j) for j in jobs]
    json.dump(res, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
    for r in res:
        print(r["out"], r["speed"], r["raw_dur"], r["phonemes"])
