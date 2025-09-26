import * as React from 'react';
import {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {Card, IconButton, Portal, Text} from 'react-native-paper';
import {initTranslate} from "../../localization/translate";
import {Image, StyleSheet, View} from "react-native";
import {ThemeContext} from "../../contexts/theme-context";
import {useSelector} from "react-redux";
import {IRootState} from "../../screens/Main";
import {Asset} from "expo-media-library";
import Slider from "@react-native-community/slider";
import {useCastManager} from "../../contexts/castManager-context";
import {Device} from "../../DLNACast/types/Device";
import {CastUtils} from "../../DLNACast/utils/CastUtils";

interface PlayerControllerProps {
    visible: boolean;
    connectedDevice: Device | null;
}

const PlayerController: React.FC<PlayerControllerProps> = ({visible, connectedDevice}) => {
    const {theme} = useContext(ThemeContext);
    const i18n = initTranslate();
    const cast = useSelector((state: IRootState) => state.cast);
    const {castManager, progress, playbackState, setProgress} = useCastManager();

    // Local state
    const [asset, setAsset] = React.useState<Asset | null>(null);
    const [playIcon, setPlayIcon] = React.useState("play");
    const [isLoading, setIsLoading] = useState(false);
    const [userSeekValue, setUserSeekValue] = useState<number | null>(null);
    const [showVolumeControls, setShowVolumeControls] = useState(false);
    const [previousVolume, setPreviousVolume] = useState<number>(0.5);

    // Add local volume state to handle optimistic updates
    const [localVolume, setLocalVolume] = useState<number>(0.5);
    const [localMuted, setLocalMuted] = useState<boolean>(false);
    const [isVolumeChanging, setIsVolumeChanging] = useState(false);

    // Refs for managing state
    const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const volumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const styles = useStyles(theme);

    // Update asset when cast state changes
    useEffect(() => {
        setAsset(cast.currentAsset);

        // Reset user seek value when changing media
        setUserSeekValue(null);
    }, [cast.currentAsset]);

    // Listen for media cleared event to reset UI
    useEffect(() => {
        const handleMediaCleared = () => {
            setAsset(null);
            setUserSeekValue(null);
            setProgress(0);
        };

        const handleCastingStopped = () => {
            setPlayIcon("play");
        };

        castManager.on('mediaCleared', handleMediaCleared);
        castManager.on('castingStopped', handleCastingStopped);

        return () => {
            castManager.off('mediaCleared', handleMediaCleared);
            castManager.off('castingStopped', handleCastingStopped);
        };
    }, [castManager, setProgress]);

    // Update play icon based on playback state
    useEffect(() => {
        if (playbackState?.isPlaying) {
            setPlayIcon("pause");
        } else {
            setPlayIcon("play");
        }
    }, [playbackState?.isPlaying]);

    // Sync local volume state with playback state when not changing volume
    useEffect(() => {
        if (playbackState && !isVolumeChanging) {
            setLocalVolume(playbackState.volume || 0);
            setLocalMuted(playbackState.muted || playbackState.volume === 0);
        }
    }, [playbackState?.volume, playbackState?.muted, isVolumeChanging]);

    /**
     * Get the display value for the slider - prioritize user action
     */
    const getSliderValue = useCallback(() => {
        return userSeekValue !== null ? userSeekValue : progress;
    }, [userSeekValue, progress]);

    /**
     * Get the current volume value to display - prioritize local state during changes
     */
    const getCurrentVolume = useCallback(() => {
        return isVolumeChanging ? localVolume : (playbackState?.volume || 0);
    }, [isVolumeChanging, localVolume, playbackState?.volume]);

    /**
     * Get the current mute state to display - prioritize local state during changes
     */
    const getCurrentMuteState = useCallback(() => {
        return isVolumeChanging ? localMuted : (playbackState?.muted || (playbackState?.volume || 0) === 0);
    }, [isVolumeChanging, localMuted, playbackState?.muted, playbackState?.volume]);

    /**
     * Handle direct seek to position
     */
    const handleSeekTo = useCallback(async (value: number) => {
        if (isLoading) return;

        try {
            setIsLoading(true);
            await castManager.seek(value);
            setProgress(value);
            setUserSeekValue(value);
        } catch (error) {
            console.error('Seek failed:', error);
        } finally {
            setIsLoading(false);
        }
    }, [castManager, setProgress, isLoading]);

    /**
     * Debounced seek function to avoid too many requests
     */
    const debouncedSeek = useCallback(
        CastUtils.debounce(async (value: number) => {
            try {
                setIsLoading(true);
                await castManager.seek(value);
            } catch (error) {
                const errorMessage = (error as Error).message;

                console.warn('Seek error:', errorMessage);

                // Only show error if it's not a temporary 501 error
                if (!errorMessage.includes('501') && !errorMessage.includes('Action Failed')) {
                    console.error('Serious seek error:', error);
                }

                // On error, clean user value to revert to actual progress
                setUserSeekValue(null);
            } finally {
                setIsLoading(false);
            }
        }, 1000),
        [castManager]
    );

    /**
     * Handle slider sliding complete (called when user releases)
     */
    const handleSliderComplete = useCallback((value: number) => {
        // Check if seeking is supported
        if (!castManager.canSeek()) {
            return;
        }

        // Immediately update visual value to avoid "jump"
        setUserSeekValue(value);

        // Perform actual seek with debouncing and error handling
        debouncedSeek(value);

        // Clean user value after delay
        setTimeout(() => {
            setUserSeekValue(null);
        }, 3000);
    }, [debouncedSeek, castManager]);

    /**
     * Handle relative seek (add/subtract seconds)
     */
    const handleSeekAdd = useCallback(async (seconds: number) => {
        if (!playbackState || isLoading || !castManager.canSeek()) return;

        let newPosition = (userSeekValue !== null ? userSeekValue : progress) + seconds;
        newPosition = Math.max(0, Math.min(newPosition, playbackState.duration));

        await handleSeekTo(newPosition);
    }, [playbackState, progress, userSeekValue, handleSeekTo, isLoading, castManager]);

    /**
     * Handle play/pause toggle
     */
    const handlePlayPause = useCallback(async () => {
        if (isLoading) return;

        try {
            setIsLoading(true);
            if (playbackState?.isPlaying) {
                await castManager.pause();
            } else {
                await castManager.play();
            }
        } catch (error) {
            console.error('Play/pause failed:', error);
        } finally {
            setIsLoading(false);
        }
    }, [castManager, playbackState?.isPlaying, isLoading]);

    /**
     * Handle stop button - stops casting and clears media
     */
    const handleStop = useCallback(async () => {
        if (isLoading) return;

        try {
            setIsLoading(true);
            await castManager.stop();
        } catch (error) {
            console.error('Stop failed:', error);
        } finally {
            setIsLoading(false);
        }
    }, [castManager, isLoading]);

    /**
     * Handle volume change with optimistic UI updates
     */
    const handleVolumeChange = useCallback(async (volume: number) => {
        const normalizedVolume = volume / 100; // Convert percentage to 0-1

        // Store current volume as previous if it's greater than 0
        if (normalizedVolume > 0) {
            setPreviousVolume(normalizedVolume);
        }

        // Set optimistic UI state immediately
        setIsVolumeChanging(true);
        setLocalVolume(normalizedVolume);
        setLocalMuted(normalizedVolume === 0);

        // Clear any existing timeout
        if (volumeTimeoutRef.current) {
            clearTimeout(volumeTimeoutRef.current);
        }

        try {
            await castManager.setVolume(normalizedVolume);

            // Reset volume changing state after a delay to allow the server state to sync
            volumeTimeoutRef.current = setTimeout(() => {
                setIsVolumeChanging(false);
            }, 2000); // Increased timeout to 2 seconds for better sync

        } catch (error) {
            console.error('Volume change failed:', error);

            // On error, revert to server state immediately
            setIsVolumeChanging(false);
        }
    }, [castManager]);

    // Store previous volume when not muted
    useEffect(() => {
        if (playbackState && playbackState.volume > 0 && !playbackState.muted) {
            setPreviousVolume(playbackState.volume);
        }
    }, [playbackState?.volume, playbackState?.muted]);

    /**
     * Check if current media is an image
     */
    const isImageMedia = useCallback(() => {
        if (!asset) return false;

        // Check by mediaType first
        if (asset.mediaType === 'photo') return true;

        // Fallback: check file extension
        if (asset.filename) {
            const ext = asset.filename.split('.').pop()?.toLowerCase();
            return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif'].includes(ext || '');
        }

        return false;
    }, [asset]);

    /**
     * Handle mute toggle with optimistic UI updates
     */
    const handleMuteToggle = useCallback(async () => {
        if (!playbackState) return;

        const currentVolume = getCurrentVolume();
        const isMuted = getCurrentMuteState();

        // Store current non-zero volume before muting, but only if we're not already muted
        if (!isMuted && currentVolume > 0) {
            setPreviousVolume(currentVolume);
        }

        // Set optimistic UI state immediately
        setIsVolumeChanging(true);

        // Clear any existing timeout
        if (volumeTimeoutRef.current) {
            clearTimeout(volumeTimeoutRef.current);
        }

        try {
            if (isMuted) {
                // Unmuting - restore to previous volume or 50%
                const targetVolume = previousVolume > 0 ? previousVolume : 0.5;
                setLocalVolume(targetVolume);
                setLocalMuted(false);
                await castManager.setVolume(targetVolume);
            } else {
                // Muting - set volume to 0
                setLocalVolume(0);
                setLocalMuted(true);
                await castManager.setVolume(0);
            }

            // Try native mute as secondary action (some devices support both)
            try {
                await castManager.mute(!isMuted);
            } catch (muteError) {
                console.warn('Native mute failed, using volume control only:', muteError);
            }

            // Reset volume changing state after a longer delay to ensure device has time to respond
            volumeTimeoutRef.current = setTimeout(() => {
                setIsVolumeChanging(false);
            }, 2500); // Increased timeout to 2.5 seconds

        } catch (error) {
            console.error('Mute toggle failed completely:', error);

            // On error, revert to server state immediately
            setIsVolumeChanging(false);
        }
    }, [castManager, getCurrentVolume, getCurrentMuteState, previousVolume]);

    /**
     * Format time in MM:SS or HH:MM:SS format
     */
    const formatTime = useCallback((seconds: number): string => {
        return CastUtils.formatDuration(seconds);
    }, []);

    // Cleanup timeouts on unmount
    useEffect(() => {
        return () => {
            if (seekTimeoutRef.current) {
                clearTimeout(seekTimeoutRef.current);
            }
            if (volumeTimeoutRef.current) {
                clearTimeout(volumeTimeoutRef.current);
            }
        };
    }, []);

    if (!visible) return null;

    return (
        <Portal>
            <View style={styles.container}>
                <Card style={styles.card}>
                    {connectedDevice && (
                        <View style={styles.titleContainer}>
                            <View style={styles.title}>
                                <Text style={styles.titleTop}>{connectedDevice.name}</Text>
                                {asset?.filename && (
                                    <Text style={styles.titleBottom}>{asset.filename}</Text>
                                )}
                            </View>
                            {asset?.uri && (
                                <Image
                                    source={{uri: asset.uri}}
                                    style={styles.thumbnail}
                                    resizeMode="cover"
                                />
                            )}
                            {/* Stop button in the title area */}
                            <IconButton
                                icon="stop"
                                size={24}
                                onPress={handleStop}
                                disabled={isLoading}
                                style={styles.stopButton}
                                iconColor={theme.colors.error}
                            />
                        </View>
                    )}

                    {asset ? (
                        <View style={styles.controlsContainer}>
                            {!isImageMedia() && (
                                <>
                                    {/* Progress Section - Only for videos/audio */}
                                    <View style={styles.progressSection}>
                                        <View style={styles.timeContainer}>
                                            <Text style={styles.timeText}>
                                                {formatTime(getSliderValue())}
                                            </Text>
                                            <Text style={styles.timeText}>
                                                {formatTime(playbackState?.duration || 0)}
                                            </Text>
                                        </View>

                                        <Slider
                                            style={styles.progressSlider}
                                            value={getSliderValue()}
                                            onSlidingComplete={castManager.canSeek() ? handleSliderComplete : undefined}
                                            onValueChange={castManager.canSeek() ? undefined : undefined}
                                            minimumValue={0}
                                            maximumValue={playbackState?.duration || 1000}
                                            step={1}
                                            minimumTrackTintColor={theme.colors.primary}
                                            maximumTrackTintColor={theme.colors.outline}
                                            thumbTintColor={castManager.canSeek() ? theme.colors.primary : theme.colors.outline}
                                            disabled={isLoading || !playbackState || !castManager.canSeek()}
                                        />
                                    </View>

                                    {/* Control Buttons - Only for videos/audio */}
                                    <View style={styles.controlButtonsContainer}>
                                        <IconButton
                                            icon="skip-backward"
                                            size={28}
                                            disabled={isLoading || !castManager.canSeek()}
                                            onPress={() => handleSeekTo(0)}
                                            style={styles.controlButton}
                                        />
                                        <IconButton
                                            icon="skip-previous"
                                            size={28}
                                            disabled={isLoading || !castManager.canSeek()}
                                            onPress={() => handleSeekAdd(-10)}
                                            style={styles.controlButton}
                                        />
                                        <IconButton
                                            icon={isLoading ? "loading" : playIcon}
                                            size={48}
                                            disabled={isLoading}
                                            onPress={handlePlayPause}
                                            style={[styles.controlButton, styles.playButton]}
                                        />
                                        <IconButton
                                            icon="skip-next"
                                            size={28}
                                            disabled={isLoading || !castManager.canSeek()}
                                            onPress={() => handleSeekAdd(10)}
                                            style={styles.controlButton}
                                        />
                                        <IconButton
                                            icon="skip-forward"
                                            size={28}
                                            disabled={isLoading || !castManager.canSeek()}
                                            onPress={() => handleSeekAdd(30)}
                                            style={styles.controlButton}
                                        />
                                    </View>
                                </>
                            )}
                            {/* Volume Controls and Status - Always shown */}
                            {playbackState && (
                                <View style={styles.statusContainer}>
                                    {!isImageMedia() && (
                                        <View style={styles.volumeSection}>
                                            <IconButton
                                                icon={getCurrentMuteState() ? "volume-off" : "volume-high"}
                                                size={20}
                                                onPress={handleMuteToggle}
                                                disabled={isLoading}
                                            />
                                            <View style={styles.volumeSliderContainer}>
                                                <Slider
                                                    style={styles.volumeSlider}
                                                    value={CastUtils.volumeToPercentage(getCurrentVolume())}
                                                    onSlidingComplete={(value) => handleVolumeChange(value)}
                                                    minimumValue={0}
                                                    maximumValue={100}
                                                    step={5}
                                                    minimumTrackTintColor={theme.colors.primary}
                                                    maximumTrackTintColor={theme.colors.outline}
                                                    thumbTintColor={theme.colors.primary}
                                                    disabled={isLoading}
                                                />
                                            </View>
                                            <Text style={styles.volumeText}>
                                                {getCurrentMuteState() ? 'Muted' : `${CastUtils.volumeToPercentage(getCurrentVolume())}%`}
                                            </Text>
                                        </View>
                                    )}

                                    {!castManager.canSeek() && !isImageMedia() && (
                                        <Text style={styles.seekWarningText}>
                                            Manual seeking not supported by this device
                                        </Text>
                                    )}

                                    {isImageMedia() && (
                                        <View style={styles.imageInfoContainer}>
                                            <Text style={styles.imageInfoText}>
                                                Image Display Mode
                                            </Text>
                                            <Text style={styles.imageInfoSubtext}>
                                                Use device controls to navigate
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            )}
                        </View>
                    ) : (
                        <View style={styles.placeholderContainer}>
                            <Text style={styles.placeholderText}>
                                {i18n.t('select_media')}
                            </Text>
                        </View>
                    )}
                </Card>
            </View>
        </Portal>
    );
};

const useStyles = (theme: any) => StyleSheet.create({
    container: {
        position: 'absolute',
        width: '100%',
        bottom: 50,
        backgroundColor: "transparent",
    },
    card: {
        marginHorizontal: 16,
        paddingVertical: 16,
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 4.65,
    },
    titleContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 16,
    },
    title: {
        flex: 1,
        marginRight: 16,
    },
    titleTop: {
        fontSize: 18,
        fontWeight: 'bold',
        color: theme.colors.onSurface,
    },
    titleBottom: {
        fontSize: 14,
        color: theme.colors.onSurfaceVariant,
        marginTop: 4,
    },
    thumbnail: {
        width: 60,
        height: 60,
        borderRadius: 8,
        marginRight: 8,
    },
    stopButton: {
        backgroundColor: theme.colors.errorContainer,
        margin: 0,
    },
    controlsContainer: {
        paddingHorizontal: 16,
    },
    progressSection: {
        marginBottom: 16,
    },
    timeContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    timeText: {
        fontSize: 12,
        color: theme.colors.onSurfaceVariant,
        fontVariant: ['tabular-nums'],
    },
    progressSlider: {
        height: 40,
        width: '100%',
    },
    controlButtonsContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
        marginVertical: 8,
    },
    controlButton: {
        margin: 4,
    },
    playButton: {
        backgroundColor: theme.colors.primaryContainer,
    },
    statusContainer: {
        marginTop: 8,
    },
    volumeSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    volumeSliderContainer: {
        flex: 1,
        marginHorizontal: 8,
    },
    volumeSlider: {
        height: 30,
        width: '100%',
    },
    volumeText: {
        fontSize: 12,
        color: theme.colors.onSurfaceVariant,
        width: 50,
        textAlign: 'right',
    },
    statusText: {
        fontSize: 12,
        color: theme.colors.onSurfaceVariant,
    },
    seekWarningText: {
        fontSize: 11,
        color: theme.colors.onSurfaceVariant,
        fontStyle: 'italic',
        textAlign: 'center',
        marginTop: 4,
    },
    imageInfoContainer: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    imageInfoText: {
        fontSize: 14,
        color: theme.colors.onSurface,
        fontWeight: '500',
    },
    imageInfoSubtext: {
        fontSize: 11,
        color: theme.colors.onSurfaceVariant,
        fontStyle: 'italic',
        marginTop: 2,
    },
    placeholderContainer: {
        padding: 32,
        alignItems: 'center',
    },
    placeholderText: {
        fontSize: 16,
        color: theme.colors.onSurfaceVariant,
        textAlign: 'center',
    },
});

export default PlayerController;