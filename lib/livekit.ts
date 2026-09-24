// Thin LiveKit client wrapper (dynamic import so the app builds without the package installed).
// Handles mic, camera and screen-share publishing, plus exposing remote video tracks for the stage.

export type StageTrack = {
  identity: string;
  source: "camera" | "screen";
  attach: (el: HTMLVideoElement) => void;
  detach: () => void;
};

export type LkRoom = {
  disconnect: () => void;
  setMic: (on: boolean) => Promise<void>;
  setCamera: (on: boolean) => Promise<void>;
  /** Returns false when the browser refused (mobile has no screen capture at all). */
  setScreen: (on: boolean) => Promise<boolean>;
  /** Flip between the front (selfie) and back camera. Returns false if it couldn't switch. */
  flipCamera: () => Promise<boolean>;
  // iOS Safari blocks audio until a user gesture — call this from a tap so people can be heard.
  startAudio: () => Promise<void>;
};

/**
 * Screen capture is DESKTOP-ONLY on the web.
 * Android Chrome exposes `getDisplayMedia` but always rejects it with NotAllowedError, and
 * iOS/iPadOS Safari (which every iOS browser is built on) doesn't implement it at all. So on
 * a phone the share button can never work through the WebView — it needs a native
 * MediaProjection (Android) / ReplayKit (iOS) implementation. We detect it up front so the UI
 * can say so instead of silently doing nothing.
 */
export function screenShareSupported(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) return false;
  // Coarse pointer + touch ⇒ phone/tablet, where the API exists but always rejects.
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  return !touch;
}

export async function joinLiveKit(
  url: string,
  token: string,
  onSpeakers: (identities: string[]) => void,
  onTracks?: (tracks: StageTrack[]) => void,
  micOnJoin = false,
  /**
   * Called with `true` when the browser is refusing to play remote audio.
   *
   * Phones and tablets block audio playback until the page has had a real user gesture.
   * `room.startAudio()` is fired when someone toggles their mic, but a LISTENER who joins
   * and taps nothing never triggers it — so they sit in a room that looks fine and hear
   * total silence, with nothing on screen to explain it. The room screen uses this to show
   * a "tap to enable sound" button, which supplies the gesture.
   */
  onAudioBlocked?: (blocked: boolean) => void
): Promise<LkRoom | null> {
  try {
    const lk = await import("livekit-client");
    const room = new lk.Room();

    room.on(lk.RoomEvent.ActiveSpeakersChanged, (speakers: Array<{ identity: string }>) => {
      onSpeakers(speakers.map((s) => s.identity));
    });

    type Pub = { track?: { attach: (el: HTMLVideoElement) => void; detach: () => void }; source?: string; kind?: string };
    const collect = () => {
      if (!onTracks) return;
      const out: StageTrack[] = [];
      const add = (identity: string, pub: Pub) => {
        // Capture the track object itself. `pub.track` goes undefined the moment a track is
        // unpublished, and the detach closure used to read it lazily → "Cannot read 'detach'
        // of undefined", which crashed the whole room. Holding the track ref (and guarding
        // attach/detach) keeps it safe across publish/unpublish.
        const track = pub?.track;
        if (!track || pub.kind !== "video") return;
        out.push({
          identity,
          source: pub.source === "screen_share" ? "screen" : "camera",
          attach: (el: HTMLVideoElement) => { try { track.attach(el); } catch { /* gone */ } },
          detach: () => { try { track.detach(); } catch { /* gone */ } },
        });
      };
      room.remoteParticipants.forEach((p: { identity: string; trackPublications: Map<string, unknown> }) => {
        p.trackPublications.forEach((pub: unknown) => add(p.identity, pub as Pub));
      });
      room.localParticipant.trackPublications.forEach((pub: unknown) => add(room.localParticipant.identity, pub as Pub));
      onTracks(out);
    };

    // Remote AUDIO must be played explicitly. Relying on the SDK's implicit autoplay is what
    // made people inaudible (nothing here ever attached their audio). We attach each incoming
    // audio track to a hidden <audio> element in the page and kick playback (iOS needs the tap
    // that toggleMic already does via startAudio()).
    type RemoteTrack = { kind?: string; attach: () => HTMLMediaElement; detach: () => HTMLMediaElement[] };

    /**
     * Every audio element we've attached, so a later "enable sound" tap can retry ALL of
     * them. Retrying only the newest one leaves earlier speakers silent forever.
     */
    const audioEls = new Set<HTMLAudioElement>();

    const attachAudio = (track: RemoteTrack) => {
      try {
        if (track?.kind !== "audio") return;
        const el = track.attach() as HTMLAudioElement;
        el.setAttribute("data-prfet-audio", "1");
        el.autoplay = true;
        // Some Android WebView builds refuse playback outright unless the element is
        // explicitly not muted and is treated as an inline player.
        el.muted = false;
        el.setAttribute("playsinline", "true");
        document.body.appendChild(el);
        audioEls.add(el);

        const p = el.play();
        if (p) {
          p.catch((e) => {
            // THIS is the real signal, and it used to be swallowed.
            //
            // room.canPlaybackAudio reports on LiveKit's own elements. We attach our own,
            // so the SDK can report "playback is fine" while this element was blocked —
            // and AudioPlaybackStatusChanged never fires. The listener then hears nothing,
            // sees no prompt, and the only thing that fixes it is opening their own mic,
            // because getUserMedia happens to satisfy the autoplay policy as a side effect.
            console.warn("[live] remote audio blocked:", e && (e as Error).name);
            onAudioBlocked?.(true);
            // Retry shortly. The page is often primed a moment later — by AudioUnlock
            // catching a tap, or by the SDK's own startAudio landing — and without this
            // the sound stayed off until the listener happened to tap again.
            let tries = 0;
            const again = setInterval(() => {
              tries++;
              el.play()
                .then(() => { clearInterval(again); onAudioBlocked?.(false); })
                .catch(() => { if (tries >= 10) clearInterval(again); });
            }, 1000);
          });
        }
        room.startAudio().catch(() => {});
      } catch { /* ignore */ }
    };

    /** Retry every attached element. Must be called from a real tap to count as a gesture. */
    const resumeAudio = async () => {
      try { await room.startAudio(); } catch { /* already allowed */ }
      let allOk = true;
      for (const el of audioEls) {
        try {
          el.muted = false;
          await el.play();
        } catch (e) {
          allOk = false;
          console.warn("[live] resume failed:", e && (e as Error).name);
        }
      }
      onAudioBlocked?.(!allOk);
    };
    const onSub = (track: RemoteTrack) => { attachAudio(track); collect(); };
    const onUnsub = (track: RemoteTrack) => {
      try { if (track?.kind === "audio") (track.detach() || []).forEach((el) => el.remove()); } catch { /* ignore */ }
      collect();
    };

    // Register handlers BEFORE connecting, so tracks that ALREADY exist in the room when we
    // join fire TrackSubscribed and get picked up — otherwise the remote camera stayed blank
    // until you published your own track and re-triggered a scan.
    // Fires whenever the browser starts or stops allowing playback. `canPlaybackAudio` is
    // false while blocked; we report the inverse so the UI can prompt for the tap.
    if (onAudioBlocked) {
      room.on(lk.RoomEvent.AudioPlaybackStatusChanged, () => {
        onAudioBlocked(!room.canPlaybackAudio);
      });
    }

    room.on(lk.RoomEvent.TrackSubscribed, onSub);
    room.on(lk.RoomEvent.TrackUnsubscribed, onUnsub);
    room.on(lk.RoomEvent.LocalTrackPublished, collect);
    room.on(lk.RoomEvent.LocalTrackUnpublished, collect);
    room.on(lk.RoomEvent.ParticipantDisconnected, collect);
    room.on(lk.RoomEvent.TrackPublished, collect); // a remote publishes; subscribe follows

    await room.connect(url, token);
    // Only publish the mic if the host already allows this person to speak.
    if (micOnJoin) await room.localParticipant.setMicrophoneEnabled(true);

    // Sweep whatever was already there the moment we joined (audio + video).
    room.remoteParticipants.forEach((p: { trackPublications: Map<string, unknown> }) => {
      p.trackPublications.forEach((pub: unknown) => {
        const tr = (pub as { track?: RemoteTrack }).track;
        if (tr?.kind === "audio") attachAudio(tr);
      });
    });
    collect();

    // Report the state we're ACTUALLY in, right after joining.
    //
    // AudioPlaybackStatusChanged only fires on a *change*. A listener who joins into a
    // blocked state never gets that event, so the prompt never appeared and the room was
    // silent with nothing on screen to explain it. Checked slightly late so the play()
    // promises above have had a chance to settle.
    setTimeout(() => {
      if (!room.canPlaybackAudio) onAudioBlocked?.(true);
    }, 600);

    // Which lens the phone camera is using. Start on the front (selfie) camera.
    let facing: "user" | "environment" = "user";

    return {
      disconnect: () => { try { room.disconnect(); } catch { /* ignore */ } },
      setMic: (on: boolean) => room.localParticipant.setMicrophoneEnabled(on),
      // After enabling the camera/screen, refresh the stage IMMEDIATELY so YOUR OWN video
      // shows right away — don't wait for a remote participant's event to trigger a rescan.
      // A second delayed sweep covers the track needing a beat to become ready.
      setCamera: async (on: boolean) => { await room.localParticipant.setCameraEnabled(on, { facingMode: facing }); collect(); setTimeout(collect, 400); },

      setScreen: async (on: boolean) => {
        if (on && !screenShareSupported()) {
          console.warn("[live] screen share unavailable on this device (mobile browsers have no getDisplayMedia)");
          return false;
        }
        try {
          await room.localParticipant.setScreenShareEnabled(on);
          collect(); setTimeout(collect, 400);
          return true;
        } catch (e) {
          // NotAllowedError also fires when the person cancels the picker — not an error.
          console.warn("[live] screen share failed:", e);
          return false;
        }
      },

      /**
       * Flip front/back.
       *
       * `setCameraEnabled(false)` then `(true, {facingMode})` was unreliable: the browser
       * often handed back the SAME camera, so the button appeared dead. `restartTrack` on the
       * existing publication is the supported way to swap lenses, so try that first and only
       * fall back to the republish dance.
       *
       * If the camera is currently OFF, turn it on with the new lens — pressing flip should
       * always do something visible rather than silently toggling an internal variable.
       */
      flipCamera: async () => {
        facing = facing === "user" ? "environment" : "user";
        try {
          if (!room.localParticipant.isCameraEnabled) {
            await room.localParticipant.setCameraEnabled(true, { facingMode: facing });
            collect(); setTimeout(collect, 400);
            return true;
          }

          type Restartable = { restartTrack?: (o: { facingMode: string }) => Promise<void> };
          const pubs = room.localParticipant.videoTrackPublications as Map<string, { source?: string; track?: Restartable }>;
          let track: Restartable | undefined;
          pubs.forEach((p) => { if (p.source !== "screen_share" && p.track?.restartTrack) track = p.track; });

          if (track?.restartTrack) {
            await track.restartTrack({ facingMode: facing });
          } else {
            await room.localParticipant.setCameraEnabled(false);
            await room.localParticipant.setCameraEnabled(true, { facingMode: facing });
          }
          collect(); setTimeout(collect, 400);
          return true;
        } catch (e) {
          console.warn("[live] camera flip failed:", e);
          facing = facing === "user" ? "environment" : "user"; // undo, we didn't switch
          return false;
        }
      },
      // Retries every attached element, not just LiveKit's internal state — see resumeAudio.
      startAudio: resumeAudio,
    };
  } catch {
    return null;
  }
}
