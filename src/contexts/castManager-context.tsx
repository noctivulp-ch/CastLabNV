import React, {createContext, Dispatch, ReactNode, SetStateAction, useContext, useEffect, useState} from "react";
import {CastManager, PlaybackState} from "../DLNACast/CastManager";
import {Device} from "../DLNACast/types/Device";


const castManager = new CastManager();

type ContextProviderProps = {
    children?: ReactNode
}

interface CastManagerContextProps {
    castManager: CastManager;
    isConnected: boolean;
    isSearching: boolean,
    castingStarted: boolean,
    connectedDevice: Device | null,
    devices: Device[],
    progress: number,
    error: string | null,
    playbackState: PlaybackState | null,
    setProgress: Dispatch<SetStateAction<number>>,
}

const CastManagerContext = createContext({} as CastManagerContextProps);


const CastManagerContextProvider = ({children}: ContextProviderProps) => {

    const [isConnected, setIsConnected] = useState(false);
    const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [progress, setProgress] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [playbackState, setPlaybackState] = useState<PlaybackState>({
        position: 0,
        duration: 1000,
        isPlaying: false,
        volume: 0.5,
        muted: false
    });
    const [isSearching, setIsSearching] = useState<boolean>(false);
    const [castingStarted, setCastingStarted] = useState<boolean>(false);
    const onDisconnected = () => {
        setIsConnected(false);
        setConnectedDevice(null);
    }
    const onConnected = (device: Device) => {
        setIsConnected(true);
        setConnectedDevice(device);
    }
    const onDeviceAdded = (device: Device) => {
        setDevices((prev) => [...prev.filter(d => d.id !== device.id), device]);
    };

    const onprogressChanged = (newProgress: number | null) => {
        if (newProgress !== null) {
            setProgress(newProgress);
        }
    }
    const onError = (message: string) => {
        setError(message);
    }
    const onStateChanged = (playbackState: PlaybackState) => {
        setPlaybackState(playbackState);
    }
    const onSearchStarted = (): void => {
        setIsSearching(true);
    }
    const onSearchStopped = (): void => {
        setIsSearching(false);
    }
    const onCastingStarted = (): void => {
        setCastingStarted(true);
    }
    useEffect(() => {
        castManager.on('disconnected', onDisconnected);
        castManager.on('connected', onConnected);
        castManager.on('deviceAdded', onDeviceAdded);
        castManager.on('progressChanged', onprogressChanged);
        castManager.on('stateChanged', onStateChanged);
        castManager.on('error', onError);
        castManager.on('searchStarted', onSearchStarted);
        castManager.on('searchStopped', onSearchStopped);
        castManager.on('castingStarted', onCastingStarted);

        return () => {
            castManager.removeListener('disconnected', onDisconnected);
            castManager.removeListener('connected', onConnected);
            castManager.removeListener('deviceAdded', onDeviceAdded);
            castManager.removeListener('progressChanged', onprogressChanged);
            castManager.removeListener('stateChanged', onStateChanged);
            castManager.removeListener('error', onError);
            castManager.removeListener('searchStarted', onSearchStarted);
            castManager.removeListener('searchStopped', onSearchStopped);
            castManager.removeListener('castingStarted', onCastingStarted);
        }
    }, [])

    return (
        <CastManagerContext.Provider value={{
            castManager,
            isConnected,
            isSearching,
            castingStarted,
            connectedDevice,
            devices,
            progress,
            error,
            playbackState,
            setProgress
        }}>{children}</CastManagerContext.Provider>
    )
}
export default CastManagerContextProvider;
export const useCastManager = () => useContext(CastManagerContext)