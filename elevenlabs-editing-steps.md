# Editing your videos with ElevenLabs — Steps

You hate editing, so use **ElevenLabs Studio 3.0** (their AI audio + video editor). It has an
AI agent that does most of the work, plus one-click captions and AI noise reduction.

## What it covers vs. doesn't

| Your goal | ElevenLabs? |
|---|---|
| Enhance / clean audio (remove noise, reverb) | ✅ Yes — Studio noise reduction OR Voice Isolator |
| Captions / subtitles | ✅ Yes — one-click auto-captions, 29 languages, editable style |
| Trim / cut / arrange clips | ✅ Yes — AI agent + timeline |
| Zoom-in effects | ⚠️ Limited — Studio isn't really built for animated Ken-Burns zooms |
| Upscale / enhance VIDEO quality | ❌ No — needs Topaz Video AI or similar |
| Smooth motion (frame interpolation) | ❌ No — needs ffmpeg / Topaz |

---

## Route A — Studio 3.0 (recommended, all-in-one)

1. Go to https://elevenlabs.io/studio and sign in (or create a free account).
2. Open **Studio** and start a new project; **upload your video file(s)**.
3. **Let the AI agent help:** describe what you want in plain English, e.g.
   "Clean up the audio, remove background noise, and add captions at the bottom."
4. **Captions:** click auto-captions → it transcribes and adds them. Tweak font/timing/style.
5. **Audio:** turn on AI noise reduction to remove background noise, reverb, distractions.
6. **Trim/arrange** any clips on the timeline (or ask the agent to do it).
7. **Export** the finished video. Export captions separately as SRT/VTT if you want them.

> Note: free accounts have monthly limits; audio tools are priced per minute, so check your
> plan before processing long videos.

---

## Route B — Just clean the audio (Voice Isolator)

If you only want studio-clean audio and will edit video elsewhere:

1. Go to https://elevenlabs.io/voice-isolator
2. Upload your audio (or the video's audio). Supports WAV, MP3, FLAC, OGG, AAC; up to 1 hr / 500MB.
3. It auto-separates speech from background noise — download the clean track.
4. Drop the clean audio back over your video in your editor.

---

## For the parts ElevenLabs can't do

- **Zoom-in effects:** use the Remotion setup from before, or any editor with keyframes
  (CapCut/Premiere/Resolve do pan-zoom easily).
- **Upscale / smooth:** ffmpeg or an AI upscaler.
  - Smooth to 60fps: `ffmpeg -i in.mp4 -filter:v "minterpolate=fps=60" out.mp4`
  - Serious upscale/denoise: Topaz Video AI (paid) or a free Real-ESRGAN/RIFE workflow.

**Suggested order:** clean audio + captions in ElevenLabs → upscale/smooth with ffmpeg/Topaz
→ add zoom effects in an editor → export final.
