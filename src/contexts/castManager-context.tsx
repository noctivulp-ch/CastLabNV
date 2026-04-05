import React, {createContext, Dispatch, ReactNode, useContext, useEffect, useReducer} from "react";
import {CastManager, PlaybackState} from "../DLNACast/CastManager";
import {Device} from "../DLNACast/types/Device";
import {MediaInfo} from "../DLNACast/types/MediaInfo";
import {CastConfig} from "../DLNACast/config/CastConfig";
import {useDispatch} from 'react-redux';
import {clearCast, setCurrentAsset} from '../store/slice/castSlice';
import {LogService} from '../services/LogService';

const castManager = new CastManager();

type ContextProviderProps = {
    children?: ReactNode
}

// State interface
interface CastState {
    isConnected: boolean;
    connectedDevice: Device | null;
    devices: Device[];
    progress: number;
    error: string | null;
    playbackState: PlaybackState;
    isSearching: boolean;
    castingStarted: boolean;
    currentMediaInfo: MediaInfo | null;
}

// Action types
type CastAction =
    | { type: 'CONNECTED'; device: Device }
    | { type: 'DISCONNECTED' }
    | { type: 'DEVICE_ADDED'; device: Device }
    | { type: 'DEVICES_CLEARED' }
    | { type: 'PROGRESS_CHANGED'; progress: number }
    | { type: 'STATE_CHANGED'; playbackState: PlaybackState }
    | { type: 'ERROR'; error: string }
    | { type: 'CLEAR_ERROR' }
    | { type: 'SEARCH_STARTED' }
    | { type: 'SEARCH_STOPPED' }
    | { type: 'CASTING_STARTED' }
    | { type: 'CASTING_STOPPED' }
    | { type: 'MEDIA_CAST'; mediaInfo: MediaInfo }
    | { type: 'DEVICE_REMOVED'; device: Device };

// Initial state
const initialState: CastState = {
    isConnected: false,
    connectedDevice: null,
    devices: [],
    progress: 0,
    error: null,
    playbackState: {
        position: 0,
        duration: 1000,
        isPlaying: false,
        volume: 0.5,
        muted: false
    },
    isSearching: false,
    castingStarted: false,
    currentMediaInfo: null,
};

// Reducer function
const castReducer = (state: CastState, action: CastAction): CastState => {
    switch (action.type) {
        case 'CONNECTED':
            return {
                ...state,
                isConnected: true,
                connectedDevice: action.device,
                error: null, // Clear any previous errors
            };

        case 'DISCONNECTED':
            return {
                ...state,
                isConnected: false,
                connectedDevice: null,
                castingStarted: false,
                progress: 0,
                playbackState: {
                    ...initialState.playbackState
                },
            };

        case 'DEVICE_ADDED':
            return {
                ...state,
                devices: [
                    ...state.devices.filter(d => d.id !== action.device.id),
                    action.device
                ].sort((a, b) => a.name.localeCompare(b.name)), // Keep devices sorted by name
            };

        case 'DEVICE_REMOVED':
            return {
                ...state,
                devices: state.devices.filter(d => d.id !== action.device.id),
            };

        case 'DEVICES_CLEARED':
            return {
                ...state,
                devices: [],
            };

        case 'PROGRESS_CHANGED':
            return {
                ...state,
                progress: action.progress,
            };

        case 'STATE_CHANGED':
            return {
                ...state,
                playbackState: action.playbackState,
                // Update progress from playback state if available
                progress: action.playbackState.position,
            };

        case 'ERROR':
            return {
                ...state,
                error: action.error,
            };

        case 'CLEAR_ERROR':
            return {
                ...state,
                error: null,
            };

        case 'SEARCH_STARTED':
            return {
                ...state,
                isSearching: true,
                devices: state.devices.filter(d => d.protocol === 'external-display'), // Keep external displays
                error: null, // Clear any search-related errors
            };

        case 'SEARCH_STOPPED':
            return {
                ...state,
                isSearching: false,
            };

        case 'CASTING_STARTED':
            return {
                ...state,
                castingStarted: true,
                error: null, // Clear any previous casting errors
            };

        case 'CASTING_STOPPED':
            return {
                ...state,
                castingStarted: false,
                progress: 0,
            };

        case 'MEDIA_CAST':
            return {
                ...state,
                currentMediaInfo: action.mediaInfo,
            };

        default:
            return state;
    }
};

// Context interface
interface CastManagerContextProps {
    // State
    isConnected: boolean;
    isSearching: boolean;
    castingStarted: boolean;
    connectedDevice: Device | null;
    devices: Device[];
    progress: number;
    error: string | null;
    playbackState: PlaybackState;
    currentMediaInfo: MediaInfo | null;
    isExternalDisplay: boolean;

    // Actions
    castManager: CastManager;
    dispatch: Dispatch<CastAction>;

    // Helper functions
    clearError: () => void;
    setProgress: (progress: number) => void;
}

const CastManagerContext = createContext<CastManagerContextProps>({} as CastManagerContextProps);

const CastManagerContextProvider = ({children}: ContextProviderProps) => {
    const [state, dispatch] = useReducer(castReducer, initialState);
    const reduxDispatch = useDispatch(); // Add Redux dispatch

    // Event handlers
    const onDisconnected = () => {
        dispatch({type: 'DISCONNECTED'});
        // Clear Redux cast state when disconnected
        reduxDispatch(clearCast());
    };

    const onConnected = (device: Device) => {
        dispatch({type: 'CONNECTED', device});
    };

    const onDeviceAdded = (device: Device) => {
        dispatch({type: 'DEVICE_ADDED', device});
    };

    const onProgressChanged = (newProgress: number | null) => {
        if (newProgress !== null && newProgress >= 0) {
            dispatch({type: 'PROGRESS_CHANGED', progress: newProgress});
        }
    };

    const onError = (message: string) => {
        if (message && message.trim()) {
            dispatch({type: 'ERROR', error: message});

            // Auto-clear error after configured delay for non-critical errors
            if (!message.toLowerCase().includes('network') && !message.toLowerCase().includes('connection')) {
                setTimeout(() => {
                    dispatch({type: 'CLEAR_ERROR'});
                }, CastConfig.ERROR_AUTO_DISMISS_DELAY);
            }
        }
    };

    const onStateChanged = (playbackState: PlaybackState) => {
        dispatch({type: 'STATE_CHANGED', playbackState});
    };

    const onSearchStarted = (): void => {
        dispatch({type: 'SEARCH_STARTED'});
    };

    const onSearchStopped = (): void => {
        dispatch({type: 'SEARCH_STOPPED'});
    };

    const onCastingStarted = (): void => {
        dispatch({type: 'CASTING_STARTED'});
    };

    const onCastingStopped = (): void => {
        dispatch({type: 'CASTING_STOPPED'});
    };

    const onDeviceRemoved = (device: Device) => {
        dispatch({type: 'DEVICE_REMOVED', device});
    };

    const onDeviceCapabilityUpdated = (device: Device) => {
        // Update device in the list
        dispatch({type: 'DEVICE_ADDED', device});

        // If it's the current device, this will trigger UI updates
        if (state.connectedDevice?.id === device.id) {
            dispatch({type: 'CONNECTED', device});
        }
    };

    // Handle media cleared event to update Redux state
    const onMediaCleared = () => {
        reduxDispatch(setCurrentAsset(null));
        dispatch({type: 'CASTING_STOPPED'});
    };

    const onMediaCast = (mediaInfo: MediaInfo) => {
        dispatch({type: 'MEDIA_CAST', mediaInfo});
    };

    // Helper functions
    const clearError = () => {
        dispatch({type: 'CLEAR_ERROR'});
    };

    const setProgress = (progress: number) => {
        if (progress >= 0) {
            dispatch({type: 'PROGRESS_CHANGED', progress});
        }
    };

    // Setup event listeners
    useEffect(() => {
        const eventHandlers = {
            'disconnected': onDisconnected,
            'connected': onConnected,
            'deviceAdded': onDeviceAdded,
            'deviceRemoved': onDeviceRemoved,
            'progressChanged': onProgressChanged,
            'stateChanged': onStateChanged,
            'error': onError,
            'searchStarted': onSearchStarted,
            'searchStopped': onSearchStopped,
            'castingStarted': onCastingStarted,
            'castingStopped': onCastingStopped,
            'deviceCapabilityUpdated': onDeviceCapabilityUpdated,
            'mediaCleared': onMediaCleared,
            'mediaCast': onMediaCast,
        };

        // Add all listeners
        Object.entries(eventHandlers).forEach(([event, handler]) => {
            castManager.on(event, handler);
        });

        // Cleanup function
        return () => {
            Object.entries(eventHandlers).forEach(([event, handler]) => {
                castManager.removeListener(event, handler);
            });
        };
    }, [reduxDispatch]);

    // Cleanup cast manager on unmount
    useEffect(() => {
        return () => {
            castManager.cleanup();
        };
    }, []);

    const contextValue: CastManagerContextProps = {
        // State
        isConnected: state.isConnected,
        isSearching: state.isSearching,
        castingStarted: state.castingStarted,
        connectedDevice: state.connectedDevice,
        devices: state.devices,
        progress: state.progress,
        error: state.error,
        playbackState: state.playbackState,
        currentMediaInfo: state.currentMediaInfo,
        isExternalDisplay: state.connectedDevice?.protocol === 'external-display',

        // Actions
        castManager,
        dispatch,

        // Helper functions
        clearError,
        setProgress,
    };

    return (
        <CastManagerContext.Provider value={contextValue}>
            {children}
        </CastManagerContext.Provider>
    );
};

export default CastManagerContextProvider;

export const useCastManager = () => {
    const context = useContext(CastManagerContext);
    if (!context) {
        throw new Error('useCastManager must be used within a CastManagerContextProvider');
    }
    return context;
};

// Custom hooks for specific functionalities
export const useCastConnection = () => {
    const {isConnected, connectedDevice, castManager} = useCastManager();

    const connect = async (device: Device) => {
        try {
            await castManager.connect(device);
        } catch (error) {
            LogService.error('Connection', `Failed to connect to device: ${error}`);
        }
    };

    const disconnect = async () => {
        try {
            await castManager.disconnect();
        } catch (error) {
            LogService.error('Connection', `Failed to disconnect: ${error}`);
        }
    };

    return {
        isConnected,
        connectedDevice,
        connect,
        disconnect,
    };
};

export const useCastSearch = () => {
    const {isSearching, devices, castManager} = useCastManager();

    const startSearch = async (duration?: number) => {
        try {
            await castManager.startSearch(duration);
        } catch (error) {
            LogService.error('Search', `Failed to start device search: ${error}`);
        }
    };

    const stopSearch = async () => {
        try {
            await castManager.stopSearch();
        } catch (error) {
            LogService.error('Search', `Failed to stop device search: ${error}`);
        }
    };

    return {
        isSearching,
        devices,
        startSearch,
        stopSearch,
    };
};

export const useCastPlayback = () => {
    const {playbackState, progress, castingStarted, castManager} = useCastManager();

    const castMedia = async (mediaInfo: any) => {
        try {
            await castManager.castMedia(mediaInfo);
        } catch (error) {
            LogService.error('Cast', `Failed to cast media: ${error}`);
        }
    };

    const play = async () => {
        try {
            await castManager.play();
        } catch (error) {
            LogService.error('Playback', `Failed to play: ${error}`);
        }
    };

    const pause = async () => {
        try {
            await castManager.pause();
        } catch (error) {
            LogService.error('Playback', `Failed to pause: ${error}`);
        }
    };

    const seek = async (position: number) => {
        try {
            await castManager.seek(position);
        } catch (error) {
            LogService.error('Playback', `Failed to seek: ${error}`);
        }
    };

    const setVolume = async (volume: number) => {
        try {
            await castManager.setVolume(volume);
        } catch (error) {
            LogService.error('Playback', `Failed to set volume: ${error}`);
        }
    };

    const mute = async (muted: boolean) => {
        try {
            await castManager.mute(muted);
        } catch (error) {
            LogService.error('Playback', `Failed to toggle mute: ${error}`);
        }
    };

    return {
        playbackState,
        progress,
        castingStarted,
        castMedia,
        play,
        pause,
        seek,
        setVolume,
        mute,
    };
};

export const useCastError = () => {
    const {error, clearError} = useCastManager();

    return {
        error,
        clearError,
        hasError: !!error,
    };
};