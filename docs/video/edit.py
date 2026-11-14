# Cuts the marked scenes out of the raw recording, lays each voice line at the
# start of its scene, and renders an MP4 (H.264 + AAC) with short fades.
import json, subprocess, sys, os
d = sys.argv[1]
m = json.load(open(os.path.join(d, "marks.json")))
raw, marks = m["raw"], m["marks"]
out = os.path.join(d, "going-rate-demo.mp4")

inputs = ["-i", raw] + sum([["-i", os.path.join(d, "vo", s["vo"])] for s in marks], [])
parts, labels = [], []
for i, s in enumerate(marks):
    length = s["end"] - s["start"]
    parts.append(f"[0:v]trim=start={s['start']:.3f}:end={s['end']:.3f},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v{i}]")
    # voice line + silence, exactly the scene's length
    parts.append(f"[{i+1}:a]aresample=48000,apad,atrim=0:{length:.3f},asetpts=PTS-STARTPTS[a{i}]")
    labels.append(f"[v{i}][a{i}]")
total = sum(s["end"] - s["start"] for s in marks)
parts.append(f"{''.join(labels)}concat=n={len(marks)}:v=1:a=1[vc][ac]")
parts.append(f"[vc]fade=t=in:st=0:d=0.5,fade=t=out:st={total-0.6:.3f}:d=0.6[vout]")
parts.append(f"[ac]loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={total-0.6:.3f}:d=0.6[aout]")
cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "[aout]",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out]
subprocess.run(cmd, check=True)
print(out, f"{total:.1f}s")
