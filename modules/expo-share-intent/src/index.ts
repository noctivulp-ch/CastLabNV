import { type EventSubscription } from 'expo-modules-core';
import ExpoShareIntent from './ExpoShareIntent';

export interface SharedItem {
    uri: string;
    name: string;
    mimeType: string;
}

export function getPendingShare(): Promise<SharedItem[]> {
    return ExpoShareIntent.getPendingShare();
}

export function addShareListener(
    listener: (payload: { items: SharedItem[] }) => void
): EventSubscription {
    return ExpoShareIntent.addListener('onShareIntent', listener);
}
