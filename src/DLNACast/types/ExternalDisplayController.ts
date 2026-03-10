export interface ExternalDisplayController {
    play(): void;

    pause(): void;

    seek(position: number): void;

    setVolume(volume: number): void;

    mute(muted: boolean): void;

    stop(): void;
}
