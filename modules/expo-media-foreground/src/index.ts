import { Platform } from 'react-native';
import { type EventSubscription } from 'expo-modules-core';
import ExpoMediaForeground from './ExpoMediaForeground';

export interface ForegroundContent {
    title: string;
    text: string;
    isPlaying: boolean;
    showControls: boolean;
    playLabel: string;
    pauseLabel: string;
    stopLabel: string;
    prevLabel: string;
    nextLabel: string;
    positionMs?: number;
    durationMs?: number;
    artworkUri?: string;
}

function toOptions(content: ForegroundContent) {
    return {
        ...content,
        positionMs: content.positionMs ?? 0,
        durationMs: content.durationMs ?? 0,
        artworkUri: content.artworkUri ?? '',
    };
}

/**
 * Starts the casting foreground service. It keeps the app process alive while
 * casting and shows the single casting notification with playback controls.
 * No-op on non-Android platforms.
 */
export function startMediaForeground(content: ForegroundContent): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return ExpoMediaForeground.startMediaForeground(toOptions(content));
}

/**
 * Updates the casting notification content while the service is running.
 * No-op on non-Android platforms.
 */
export function updateMediaForeground(content: ForegroundContent): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return ExpoMediaForeground.updateMediaForeground(toOptions(content));
}

/**
 * Stops the casting foreground service and removes its notification.
 * No-op on non-Android platforms.
 */
export function stopMediaForeground(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return ExpoMediaForeground.stopMediaForeground();
}

export function isMediaForegroundActive(): boolean {
    if (Platform.OS !== 'android') return false;
    return ExpoMediaForeground.isMediaForegroundActive();
}

export type CastAction = 'play' | 'pause' | 'stop' | 'previous' | 'next' | 'seek';

/**
 * Subscribes to the actions triggered from the notification or the system media
 * player. The position is in milliseconds and only meaningful for the seek action.
 */
export function addCastActionListener(
    listener: (action: CastAction, positionMs: number) => void
): EventSubscription {
    return ExpoMediaForeground.addListener('onCastAction', (payload: { action: CastAction; position: number }) => {
        listener(payload.action, payload.position);
    });
}
