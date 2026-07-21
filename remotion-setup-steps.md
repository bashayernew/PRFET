# Remotion + Claude Code — Setup & Editing Steps (Windows)

## 0. Prerequisite — Node.js
You need Node 18+ installed. Check in a terminal (PowerShell or Windows Terminal):

```
node -v
npm -v
```

If you get an error, install Node LTS from https://nodejs.org first, then reopen the terminal.

---

## Install steps

**Step 1 — Add the Remotion skills (one-time, global).**
```
npx -y skills@latest add remotion-dev/skills -g -y
```

**Step 2 — Create the project folder.**
```
npx create-video@latest --yes --blank my-video
```

**Step 3 — Go into the folder.**
```
cd my-video
```

**Step 4 — Install dependencies (takes ~1–2 min).**
```
npm i
```

**Step 5 — Start Remotion Studio (live preview in your browser).**
```
npm run dev
```
Leave this running. It opens the studio where you'll see the video render live.

**Step 6 — Open a SECOND terminal window**, then go back into the folder:
```
cd my-video
```

**Step 7 — Install Claude Code (Windows command — the screenshot cut this off):**
```
npm install -g @anthropic-ai/claude-code
```
Then start it from inside the project:
```
claude
```
(No `sudo` on Windows — that's Mac-only.)

---

## Editing your videos

Put your source video files inside the `public/` folder of `my-video`. Then, in the Claude Code terminal, describe what you want, e.g.:

- "Import public/clip.mp4 and add a slow zoom-in on the first 5 seconds."
- "Transcribe the audio and add styled captions at the bottom."

Remotion handles **zoom effects** and **captions** well.

### For audio enhancement, quality/upscaling, and smoothing
These are NOT Remotion features. Do them as a separate ffmpeg pass.

Install ffmpeg (e.g. `winget install Gyan.FFmpeg`), then:

- **Light audio cleanup / loudness normalize:**
  ```
  ffmpeg -i in.mp4 -af "afftdn,loudnorm" -c:v copy out.mp4
  ```
- **Smoother motion (frame interpolation to 60fps):**
  ```
  ffmpeg -i in.mp4 -filter:v "minterpolate=fps=60" out.mp4
  ```
- **Upscaling / serious denoise:** ffmpeg is limited here — an AI tool (Topaz Video AI, or a free RIFE/Real-ESRGAN workflow) gives better results.

A clean order: enhance/upscale source with ffmpeg → drop the cleaned file into Remotion → add zoom + captions → render final.
