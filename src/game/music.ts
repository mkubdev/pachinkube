/**
 * Background music: the lofi girl live stream through the YouTube IFrame API.
 *
 * Nothing from YouTube loads until the player is toggled on (privacy, and the
 * embed script is heavy), and browsers only allow audio after a user gesture,
 * so the toggle itself is the gesture. Volume persists per browser.
 */
export type StationId = "lofi" | "dnb";
export const STATIONS: Record<StationId, { name: string; videoId: string }> = {
  lofi: { name: "lofi", videoId: "e_VYjS29Cfo" },
  dnb: { name: "dnb", videoId: "M5dzl_NIK-0" },
};
const KEY = "pachinkube.music.v1";

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  setVolume(v: number): void;
  loadVideoById(id: string): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export class Music {
  private player: YTPlayer | null = null;
  private loading = false;
  playing = false;
  volume = 40;
  station: StationId = "lofi";
  onChange: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { volume?: number; station?: StationId };
        this.volume = Math.max(0, Math.min(100, Number(saved.volume) || 40));
        if (saved.station && saved.station in STATIONS) this.station = saved.station;
      }
    } catch {
      /* no persistence: fine */
    }
  }

  /** Switch station; starts playing if it was not already. */
  setStation(id: StationId): void {
    if (!(id in STATIONS)) return;
    this.station = id;
    this.persist();
    if (this.player) {
      this.player.loadVideoById(STATIONS[id].videoId);
      this.playing = true;
      this.onChange?.();
      return;
    }
    if (!this.playing) this.toggle();
    else this.onChange?.();
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ volume: this.volume, station: this.station }));
    } catch {
      /* ignore */
    }
  }

  toggle(): void {
    if (this.playing) {
      this.player?.pauseVideo();
      this.playing = false;
      this.onChange?.();
      return;
    }
    this.playing = true;
    this.onChange?.();
    if (this.player) this.player.playVideo();
    else void this.load();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(100, v));
    this.player?.setVolume(this.volume);
    this.persist();
    this.onChange?.();
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    await new Promise<void>((resolve) => {
      if (window.YT?.Player) return resolve();
      window.onYouTubeIframeAPIReady = () => resolve();
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      document.head.appendChild(s);
    });
    const host = document.createElement("div");
    host.id = "yt-music";
    host.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none";
    document.body.appendChild(host);
    this.player = new window.YT!.Player(host, {
      videoId: STATIONS[this.station].videoId,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1 },
      events: {
        onReady: (e: { target: YTPlayer }) => {
          e.target.setVolume(this.volume);
          if (this.playing) e.target.playVideo();
        },
        onStateChange: (e: { data: number }) => {
          // 1 = playing, 2 = paused; keep the UI honest if YouTube changes state.
          if (e.data === 1) this.playing = true;
          if (e.data === 2) this.playing = false;
          this.onChange?.();
        },
      },
    });
  }
}
