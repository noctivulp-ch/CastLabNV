/**
 * Lightweight event bus for cross-screen communication.
 * Used to pass data between screens without non-serializable navigation params.
 */
import {DeviceEventEmitter} from 'react-native';
import {Asset} from 'expo-media-library';

const ASSETS_SELECTED = 'MediaSelector:assetsSelected';

export const EventBus = {
    emitAssetsSelected: (assets: Asset[]) => {
        DeviceEventEmitter.emit(ASSETS_SELECTED, assets);
    },
    onAssetsSelected: (callback: (assets: Asset[]) => void) => {
        return DeviceEventEmitter.addListener(ASSETS_SELECTED, callback);
    },
};
