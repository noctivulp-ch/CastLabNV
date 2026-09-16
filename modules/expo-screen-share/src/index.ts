import { type EventSubscription } from 'expo-modules-core';
import ExpoScreenShare from './ExpoScreenShare';

export function requestScreenShare(port: number): Promise<void> {
    return ExpoScreenShare.requestScreenShare(port);
}

export function requestAudioShare(port: number): Promise<void> {
    return ExpoScreenShare.requestAudioShare(port);
}

export function stopScreenShare(): Promise<void> {
    return ExpoScreenShare.stopScreenShare();
}

export function isScreenSharing(): boolean {
    return ExpoScreenShare.isScreenSharing();
}

export type ScreenShareEvent =
    'onScreenShareStarted' | 'onScreenShareStopped' | 'onScreenShareError' | 'onAudioSilence';

export function addScreenShareListener(
    event: ScreenShareEvent,
    listener: (payload: Record<string, any>) => void
): EventSubscription {
    return ExpoScreenShare.addListener(event, listener);
}
