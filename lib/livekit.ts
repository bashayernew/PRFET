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
    await room.connect(url, token);
    // Only publish the mic if the host already allows this person to speak.
    if (micOnJoin) await room.localParticipant.setMicrophoneEnabled(true);

    room.on(lk.RoomEvent.ActiveSpeakersChanged, (speakers: Array<{ identity: string }>) => {
      onSpeakers(speakers.map((s) => s.identity));
    });

    type Pub = { track?: { attach: (el: HTMLVideoElement) => void; detach: () => void }; source?: string; kind?: string };
    const collect = () => {
      if (!onTracks) return;
      const out: StageTrack[] = [];
      const add = (identity: string, pub: Pub) => {
        if (!pub?.track || pub.kind !== "video") return;
        out.push({
          identity,
          source: pub.source === "screen_share" ? "screen" : "camera",
          attach: (el: HTMLVideoElement) => pub.track!.attach(el),
          detach: () => pub.track!.detach(),
        });
      };
      room.remoteParticipants.forEach((p: { identity: string; trackPublications: Map<string, unknown> }) => {
        p.trackPublications.forEach((pub: unknown) => add(p.identity, pub as Pub));
      });
      room.localParticipant.trackPublications.forEach((pub: unknown) => add(room.localParticipant.identity, pub as Pub));
      onTracks(out);
    };

    room.on(lk.RoomEvent.TrackSubscribed, collect);
    room.on(lk.RoomEvent.TrackUnsubscribed, collect);
    room.on(lk.RoomEvent.LocalTrackPublished, collect);
    room.on(lk.RoomEvent.LocalTrackUnpublished, collect);
    room.on(lk.RoomEvent.ParticipantDisconnected, collect);

    return {
      disconnect: () => { try { room.disconnect(); } catch { /* ignore */ } },
      setMic: (on: boolean) => room.localParticipant.setMicrophoneEnabled(on),
      setCamera: (on: boolean) => room.localParticipant.setCameraEnabled(on),
      setScreen: (on: boolean) => room.localParticipant.setScreenShareEnabled(on),
    };
  } catch {
    return null;
  }
}
