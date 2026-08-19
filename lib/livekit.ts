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
  setScreen: (on: boolean) => Promise<void>;
  // iOS Safari blocks audio until a user gesture — call this from a tap so people can be heard.
  startAudio: () => Promise<void>;
};

export async function joinLiveKit(
  url: string,
  token: string,
  onSpeakers: (identities: string[]) => void,
  onTracks?: (tracks: StageTrack[]) => void,
  micOnJoin = false
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
    const attachAudio = (track: RemoteTrack) => {
      try {
        if (track?.kind !== "audio") return;
        const el = track.attach();
        el.setAttribute("data-prfet-audio", "1");
        (el as HTMLAudioElement).autoplay = true;
        document.body.appendChild(el);
        const p = (el as HTMLAudioElement).play();
        if (p) p.catch(() => {});
        room.startAudio().catch(() => {});
      } catch { /* ignore */ }
    };
    const onSub = (track: RemoteTrack) => { attachAudio(track); collect(); };
    const onUnsub = (track: RemoteTrack) => {
      try { if (track?.kind === "audio") (track.detach() || []).forEach((el) => el.remove()); } catch { /* ignore */ }
      collect();
    };

    // Register handlers BEFORE connecting, so tracks that ALREADY exist in the room when we
    // join fire TrackSubscribed and get picked up — otherwise the remote camera stayed blank
    // until you published your own track and re-triggered a scan.
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

    return {
      disconnect: () => { try { room.disconnect(); } catch { /* ignore */ } },
      setMic: (on: boolean) => room.localParticipant.setMicrophoneEnabled(on),
      setCamera: (on: boolean) => room.localParticipant.setCameraEnabled(on),
      setScreen: (on: boolean) => room.localParticipant.setScreenShareEnabled(on),
      startAudio: async () => { try { await room.startAudio(); } catch { /* already allowed */ } },
    };
  } catch {
    return null;
  }
}
