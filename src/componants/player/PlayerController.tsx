import * as React from 'react';
import {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {Button, Card, Dialog, IconButton, Portal, Switch, Text} from 'react-native-paper';
import {initTranslate} from "../../localization/translate";
import {Animated, Image, StyleSheet, TouchableOpacity, View} from "react-native";
import {ThemeContext} from "../../contexts/theme-context";
import {useDispatch, useSelector} from "react-redux";
import {IRootState} from "../../screens/Main";
import {Asset} from "expo-media-library";
import Slider from "@react-native-community/slider";
import {useCastManager} from "../../contexts/castManager-context";
import {Device} from "../../DLNACast/types/Device";
import {CastUtils} from "../../DLNACast/utils/CastUtils";
import {
    setAutoplayDelay,
    setAutoplayEnabled,
    setAutoplayOnMediaEnd,
    updateAutoplaySettings
} from "../../store/slice/castSlice";

import AsyncStorage from "@react-native-async-storage/async-storage";

interface PlayerControllerProps {
    visible: boolean;
    connectedDevice: Device | null;
    onHeightChange?: (height: number) => void;
    compactMode?: boolean;
    onLoadMoreAssets?: () => Promise<void>;
    onToggleCompactMode?: () => void;
}

// Constants for AsyncStorage
const AUTOPLAY_SETTINGS_KEY = 'autoplay_settings';

const PlayerController: React.FC<PlayerControllerProps> = ({
                                                               visible,
                                                               connectedDevice,
                                                               onHeightChange,
                                                               compactMode = false,
                                                               onLoadMoreAssets,
                                                               onToggleCompactMode
                                                           }) => {
    const {theme} = useContext(ThemeContext);
    const i18n = initTranslate();
    const dispatch = useDispatch();
    const cast = useSelector((state: IRootState) => state.cast);
    const {castManager, progress, playbackState, setProgress} = useCastManager();

    // Local state
    const [asset, setAsset] = React.useState<Asset | null>(null);
    const [playIcon, setPlayIcon] = React.useState("play");
    const [isLoading, setIsLoading] = useState(false);
    const [userSeekValue, setUserSeekValue] = useState<number | null>(null);
    const [autoplayMenuVisible, setAutoplayMenuVisible] = useState(false);

    // Autoplay state
    const autoplayTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [mediaEndDetected, setMediaEndDetected] = useState(false);
    const lastProgressRef = useRef(0);
    const isAdvancingRef = useRef(false);

    // Refs for managing state and animation
    const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const cardRef = useRef<View>(null);
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const scaleAnim = useRef(new Animated.Value(1)).current;

    // Force menu re-render key
    const [menuKey, setMenuKey] = useState(0);

    const styles = useStyles(theme);

    /**
     * Save autoplay settings to AsyncStorage
     */
    const saveAutoplaySettings = useCallback(async (settings: any) => {
        try {
            await AsyncStorage.setItem(AUTOPLAY_SETTINGS_KEY, JSON.stringify(settings));
        } catch (error) {
            console.error('Failed to save autoplay settings:', error);
        }
    }, []);

    /**
     * Load autoplay settings from AsyncStorage
     */
    const loadAutoplaySettings = useCallback(async () => {
        try {
            const settings = await AsyncStorage.getItem(AUTOPLAY_SETTINGS_KEY);
            if (settings) {
                const parsedSettings = JSON.parse(settings);
                dispatch(updateAutoplaySettings(parsedSettings));
            }
        } catch (error) {
            console.error('Failed to load autoplay settings:', error);
        }
    }, [dispatch]);

    /**
     * Reset autoplay settings to default
     */
    const resetAutoplaySettings = useCallback(async () => {
        const defaultSettings = {
            enabled: false,
            delaySeconds: 5,
            onMediaEnd: true,
        };
        dispatch(updateAutoplaySettings(defaultSettings));
        await saveAutoplaySettings(defaultSettings);
        setMenuKey(prev => prev + 1);
    }, [dispatch, saveAutoplaySettings]);

    /**
     * Clear autoplay timer
     */
    const clearAutoplayTimer = useCallback(() => {
        if (autoplayTimerRef.current) {
            clearTimeout(autoplayTimerRef.current);
            autoplayTimerRef.current = null;
        }
    }, []);

    /**
     * Check if current media is an image
     */
    const isImageMedia = useCallback((checkAsset?: Asset | null) => {
        const assetToCheck = checkAsset || asset;
        if (!assetToCheck) return false;
        if (assetToCheck.mediaType === 'photo') return true;
        if (assetToCheck.filename) {
            const ext = assetToCheck.filename.split('.').pop()?.toLowerCase();
            return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif'].includes(ext || '');
        }
        return false;
    }, [asset]);

    /**
     * Check if current media supports play/pause (video or audio)
     */
    const supportsPlayPause = useCallback((checkAsset?: Asset | null) => {
        const assetToCheck = checkAsset || asset;
        return assetToCheck?.mediaType === 'video' || assetToCheck?.mediaType === 'audio';
    }, [asset]);

    /**
     * Advance to next asset with loading support
     */
    const advanceToNext = useCallback(async () => {

        if (isAdvancingRef.current) {
            return;
        }

        // Set flag immediately to prevent concurrent advances
        isAdvancingRef.current = true;

        try {
            // Load more assets if needed
            const isNearEnd = cast.currentIndex >= cast.assets.length - 2;
            if (isNearEnd && onLoadMoreAssets) {
                try {
                    await onLoadMoreAssets();
                } catch (error) {
                    console.error('Failed to load more assets for autoplay:', error);
                }
            }

            // Check if we have a next asset
            if (cast.currentIndex < cast.assets.length - 1) {
                const nextIndex = cast.currentIndex + 1;
                const nextAsset = cast.assets[nextIndex];
                // Dispatch the nextAsset action
                dispatch({type: 'cast/nextAsset'});
            } else {
                // Disable autoplay when reaching the end
                dispatch(setAutoplayEnabled(false));
                await saveAutoplaySettings({...cast.autoplay, enabled: false});
            }
        } catch (error) {
            console.error('Autoplay advance error:', error);
        } finally {
            // Reset flag after a delay to prevent rapid successive calls
            setTimeout(() => {
                isAdvancingRef.current = false;
            }, 3000);
        }
    }, [cast.currentIndex, cast.assets.length, cast.autoplay, dispatch, onLoadMoreAssets, saveAutoplaySettings]);

    /**
     * Start autoplay timer for images
     */
    const startImageAutoplay = useCallback(() => {

        if (!cast.autoplay.enabled || !cast.currentAsset || !isImageMedia(cast.currentAsset)) {
            return;
        }

        // Clear any existing timer
        clearAutoplayTimer();

        // Set new timer for autoplay
        autoplayTimerRef.current = setTimeout(() => {
            advanceToNext();
        }, cast.autoplay.delaySeconds * 1000);

    }, [cast.autoplay.enabled, cast.autoplay.delaySeconds, cast.currentAsset, clearAutoplayTimer, advanceToNext, isImageMedia]);

    /**
     * Handle media end detection for videos/audio
     */
    const checkForMediaEnd = useCallback(() => {
        if (!cast.autoplay.enabled ||
            !cast.autoplay.onMediaEnd ||
            !cast.currentAsset ||
            !supportsPlayPause(cast.currentAsset) ||
            !playbackState ||
            mediaEndDetected) {
            return;
        }

        const currentPosition = playbackState.position || 0;
        const duration = playbackState.duration || 0;
        const isPlaying = playbackState.isPlaying || false;

        // Check if media is near end
        const isNearEnd = duration > 0 && currentPosition >= duration - 3;
        const positionStuck = Math.abs(currentPosition - lastProgressRef.current) < 0.1 && currentPosition > 0;
        const hasEnded = isNearEnd && (positionStuck || !isPlaying);

        if (hasEnded) {
            setMediaEndDetected(true);

            // Advance to next with slight delay
            setTimeout(() => {
                advanceToNext();
            }, 1500);
        }

        lastProgressRef.current = currentPosition;
    }, [cast.autoplay.enabled, cast.autoplay.onMediaEnd, cast.currentAsset, supportsPlayPause, playbackState, mediaEndDetected, advanceToNext]);

    /**
     * Handle navigation to previous asset
     */
    const handlePrevious = useCallback(() => {
        if (cast.currentIndex > 0) {
            clearAutoplayTimer();
            setMediaEndDetected(false);
            isAdvancingRef.current = false;
            dispatch({type: 'cast/previousAsset'});
        }
    }, [cast.currentIndex, dispatch, clearAutoplayTimer]);

    /**
     * Handle navigation to next asset
     */
    const handleNext = useCallback(() => {
        clearAutoplayTimer();
        setMediaEndDetected(false);
        isAdvancingRef.current = false;
        advanceToNext();
    }, [clearAutoplayTimer, advanceToNext]);

    /**
     * Handle compact mode toggle
     */
    const handleToggleCompactMode = useCallback(() => {
        onToggleCompactMode?.();
    }, [onToggleCompactMode]);

    /**
     * Handle card layout change to measure height
     */
    const handleCardLayout = useCallback(() => {
        if (cardRef.current && visible) {
            cardRef.current.measure((x, y, width, height, pageX, pageY) => {
                const totalHeight = height + 32 + 20;
                onHeightChange?.(totalHeight);
            });
        } else if (!visible) {
            onHeightChange?.(0);
        }
    }, [visible, onHeightChange]);

    // Load autoplay settings on mount
    useEffect(() => {
        loadAutoplaySettings();
    }, [loadAutoplaySettings]);

    // Save autoplay settings when they change
    useEffect(() => {
        if (cast.autoplay) {
            saveAutoplaySettings(cast.autoplay);
        }
    }, [cast.autoplay, saveAutoplaySettings]);

    // Update asset when cast state changes
    useEffect(() => {
        if (cast.currentAsset !== asset) {
            setAsset(cast.currentAsset);
            setUserSeekValue(null);
            setMediaEndDetected(false);
            clearAutoplayTimer();
            isAdvancingRef.current = false;
            lastProgressRef.current = 0;
        }
    }, [cast.currentAsset, asset, clearAutoplayTimer]);

    // Handle autoplay when asset or settings change
    useEffect(() => {
        if (cast.currentAsset && cast.autoplay.enabled && isImageMedia(cast.currentAsset)) {
            // Start timer with stabilization delay
            const stabilizationTimer = setTimeout(() => {
                startImageAutoplay();
            }, 1000);

            return () => {
                clearTimeout(stabilizationTimer);
            };
        }
    }, [cast.currentAsset?.id, cast.autoplay.enabled, cast.autoplay.delaySeconds, startImageAutoplay, isImageMedia]);

    // Monitor media end for videos/audio
    useEffect(() => {
        if (cast.autoplay.enabled && cast.autoplay.onMediaEnd && cast.currentAsset && supportsPlayPause(cast.currentAsset)) {
            checkForMediaEnd();
        }
    }, [playbackState?.position, playbackState?.isPlaying, checkForMediaEnd]);

    // Listen for cast manager events
    useEffect(() => {
        const handleMediaCleared = () => {
            setAsset(null);
            setUserSeekValue(null);
            setProgress(0);
            clearAutoplayTimer();
            setMediaEndDetected(false);
            isAdvancingRef.current = false;
            dispatch({type: 'cast/clearCast'});
        };

        const handleCastingStopped = () => {
            setPlayIcon("play");
            clearAutoplayTimer();
            isAdvancingRef.current = false;
        };

        castManager.on('mediaCleared', handleMediaCleared);
        castManager.on('castingStopped', handleCastingStopped);

        return () => {
            castManager.off('mediaCleared', handleMediaCleared);
            castManager.off('castingStopped', handleCastingStopped);
        };
    }, [castManager, setProgress, clearAutoplayTimer]);

    // Update play icon based on playback state
    useEffect(() => {
        if (playbackState?.isPlaying) {
            setPlayIcon("pause");
        } else {
            setPlayIcon("play");
        }
    }, [playbackState?.isPlaying]);

    // Measure height when visibility or content changes
    useEffect(() => {
        if (visible) {
            const timer = setTimeout(() => {
                handleCardLayout();
            }, 300);
            return () => clearTimeout(timer);
        } else {
            onHeightChange?.(0);
        }
    }, [visible, asset?.id, compactMode, handleCardLayout, onHeightChange]);

    /**
     * Animate smooth transition when compact mode changes
     */
    useEffect(() => {
        const targetOpacity = compactMode ? 0.9 : 1;
        const targetScale = compactMode ? 0.85 : 1;

        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: targetOpacity,
                duration: 250,
                useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
                toValue: targetScale,
                duration: 250,
                useNativeDriver: true,
            })
        ]).start(() => {
            setTimeout(() => {
                handleCardLayout();
            }, 100);
        });
    }, [compactMode, fadeAnim, scaleAnim, handleCardLayout]);

    /**
     * Get the display value for the slider - prioritize user action
     */
    const getSliderValue = useCallback(() => {
        return userSeekValue !== null ? userSeekValue : (progress || 0);
    }, [userSeekValue, progress]);

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
                if (!errorMessage.includes('501') && !errorMessage.includes('Action Failed')) {
                    console.error('Serious seek error:', error);
                }
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
        if (!castManager.canSeek()) {
            return;
        }
        setUserSeekValue(value);
        debouncedSeek(value);
        setTimeout(() => {
            setUserSeekValue(null);
        }, 3000);
    }, [debouncedSeek, castManager]);

    /**
     * Handle relative seek (add/subtract seconds)
     */
    const handleSeekAdd = useCallback(async (seconds: number) => {
        if (!playbackState || isLoading || !castManager.canSeek()) return;

        const currentPosition = userSeekValue !== null ? userSeekValue : (progress || 0);
        let newPosition = currentPosition + seconds;
        newPosition = Math.max(0, Math.min(newPosition, playbackState.duration || 0));

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
            clearAutoplayTimer();
            isAdvancingRef.current = false;
            await castManager.stop();

        } catch (error) {
            console.error('Stop failed:', error);
        } finally {
            setIsLoading(false);
        }
    }, [castManager, isLoading, clearAutoplayTimer]);

    /**
     * Handle volume change
     */
    const handleVolumeChange = useCallback(async (volume: number) => {
        try {
            await castManager.setVolume(volume / 100);
        } catch (error) {
            console.error('Volume change failed:', error);
        }
    }, [castManager]);

    // Store previous volume when not muted
    const [previousVolume, setPreviousVolume] = useState<number>(0.5);
    useEffect(() => {
        if (playbackState && playbackState.volume > 0 && !playbackState.muted) {
            setPreviousVolume(playbackState.volume);
        }
    }, [playbackState?.volume, playbackState?.muted]);

    /**
     * Handle mute toggle with fallback to volume control
     */
    const handleMuteToggle = useCallback(async () => {
        if (!playbackState) return;

        const currentVolume = playbackState.volume || 0;
        const isMuted = playbackState.muted || currentVolume === 0;

        try {
            if (isMuted) {
                const targetVolume = previousVolume > 0 ? previousVolume : 0.5;
                await castManager.setVolume(targetVolume);
            } else {
                await castManager.setVolume(0);
            }

            try {
                await castManager.mute(!isMuted);
            } catch (muteError) {
                // Ignore mute errors as some devices don't support it
            }

        } catch (error) {
            console.error('Mute toggle failed completely:', error);
        }
    }, [castManager, playbackState, previousVolume]);

    /**
     * Format time in MM:SS or HH:MM:SS format
     */
    const formatTime = useCallback((seconds: number): string => {
        return CastUtils.formatDuration(seconds);
    }, []);

    /**
     * Handle autoplay setting changes with proper menu refresh
     */
    const handleAutoplayEnabledChange = useCallback(async (value: boolean) => {
        dispatch(setAutoplayEnabled(value));
        await saveAutoplaySettings({...cast.autoplay, enabled: value});

        if (!value) {
            setMenuKey(prev => prev + 1);
            clearAutoplayTimer();
            isAdvancingRef.current = false;
        }
    }, [dispatch, cast.autoplay, saveAutoplaySettings, clearAutoplayTimer]);

    const handleAutoplayOnMediaEndChange = useCallback(async (value: boolean) => {
        dispatch(setAutoplayOnMediaEnd(value));
        await saveAutoplaySettings({...cast.autoplay, onMediaEnd: value});
    }, [dispatch, cast.autoplay, saveAutoplaySettings]);

    const handleAutoplayDelayChange = useCallback(async (value: number) => {
        const roundedValue = Math.round(value);
        dispatch(setAutoplayDelay(roundedValue));
        await saveAutoplaySettings({...cast.autoplay, delaySeconds: roundedValue});
    }, [dispatch, cast.autoplay, saveAutoplaySettings]);

    /**
     * Handle menu visibility changes
     */
    const handleMenuDismiss = useCallback(() => {
        setAutoplayMenuVisible(false);
        setTimeout(() => {
            setMenuKey(prev => prev + 1);
        }, 100);
    }, []);

    const handleMenuOpen = useCallback(() => {
        setAutoplayMenuVisible(true);
    }, []);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (seekTimeoutRef.current) {
                clearTimeout(seekTimeoutRef.current);
            }
            clearAutoplayTimer();
        };
    }, [clearAutoplayTimer]);

    if (!visible) return null;

    // Render compact mode
    if (compactMode) {
        return (
            <Portal>
                <View style={styles.container}>
                    <Animated.View style={{
                        opacity: fadeAnim,
                        transform: [{scale: scaleAnim}]
                    }}>
                        <TouchableOpacity
                            activeOpacity={0.8}
                            onPress={handleToggleCompactMode}
                        >
                            <Card
                                style={styles.compactCard}
                                ref={cardRef}
                                onLayout={handleCardLayout}
                            >
                                <View style={styles.compactContent}>
                                    <View style={styles.mediaImageContainer}>
                                        {asset?.uri ? (
                                            <Image
                                                source={{uri: asset.uri}}
                                                style={styles.mediaImage}
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View
                                                style={[styles.mediaImagePlaceholder, {backgroundColor: theme.colors.outline}]}>
                                                <IconButton
                                                    icon={asset ? (asset.mediaType === 'audio' ? 'music' : 'image') : 'cast'}
                                                    size={20}
                                                    iconColor={theme.colors.onSurface}
                                                />
                                            </View>
                                        )}
                                    </View>

                                    <View style={styles.mediaTitleContainer}>
                                        <Text
                                            variant="bodyMedium"
                                            numberOfLines={1}
                                            ellipsizeMode="tail"
                                            style={styles.compactMediaTitle}
                                        >
                                            {asset?.filename || connectedDevice?.name || 'No Device'}
                                        </Text>
                                        {cast.autoplay.enabled && (
                                            <Text variant="bodySmall"
                                                  style={[styles.autoplayIndicator, {color: theme.colors.primary}]}>
                                                {isImageMedia() ? `${i18n.t('autoplay')} ${cast.autoplay.delaySeconds}s` : i18n.t('autoplay_indication')}
                                            </Text>
                                        )}
                                    </View>

                                    {supportsPlayPause() && (
                                        <TouchableOpacity
                                            style={styles.playPauseButton}
                                            onPress={handlePlayPause}
                                            activeOpacity={0.7}
                                            disabled={isLoading}
                                        >
                                            <IconButton
                                                icon={isLoading ? "loading" : playIcon}
                                                size={24}
                                                iconColor={theme.colors.primary}
                                                disabled={isLoading}
                                            />
                                        </TouchableOpacity>
                                    )}

                                    <TouchableOpacity
                                        style={styles.nextButton}
                                        onPress={handleNext}
                                        activeOpacity={0.7}
                                        disabled={cast.currentIndex >= cast.assets.length - 1}
                                    >
                                        <IconButton
                                            icon="skip-next"
                                            size={20}
                                            iconColor={cast.currentIndex >= cast.assets.length - 1 ? theme.colors.outline : theme.colors.onSurface}
                                            disabled={cast.currentIndex >= cast.assets.length - 1}
                                        />
                                    </TouchableOpacity>
                                </View>
                            </Card>
                        </TouchableOpacity>
                    </Animated.View>
                </View>
            </Portal>
        );
    }

    // Render normal mode
    return (
        <Portal>
            <View style={styles.container}>
                <Animated.View style={{
                    opacity: fadeAnim,
                    transform: [{scale: scaleAnim}]
                }}>
                    <Card
                        style={styles.card}
                        ref={cardRef}
                        onLayout={handleCardLayout}
                    >
                        {connectedDevice && (
                            <View style={styles.titleContainer}>
                                <View style={styles.title}>
                                    <Text style={styles.titleTop}>{connectedDevice.name}</Text>
                                    {asset?.filename && (
                                        <Text style={styles.titleBottom}>{asset.filename}</Text>
                                    )}
                                    {cast.assets.length > 1 && (
                                        <Text style={[styles.playlistInfo, {color: theme.colors.onSurfaceVariant}]}>
                                            {cast.currentIndex + 1} / {cast.assets.length}
                                        </Text>
                                    )}
                                </View>
                                {asset?.uri && (
                                    <Image
                                        source={{uri: asset.uri}}
                                        style={styles.thumbnail}
                                        resizeMode="cover"
                                    />
                                )}

                                {/* Compact mode toggle button */}
                                <IconButton
                                    icon="chevron-down"
                                    size={24}
                                    onPress={handleToggleCompactMode}
                                    style={styles.compactToggleButton}
                                    iconColor={theme.colors.onSurface}
                                />
                            </View>
                        )}

                        {asset ? (
                            <View style={styles.controlsContainer}>
                                {/* Show navigation/action buttons even if single asset for autoplay/stop */}
                                <View style={styles.navigationContainer}>
                                    {cast.assets.length > 1 && (
                                        <IconButton
                                            icon="skip-previous"
                                            size={32}
                                            disabled={cast.currentIndex <= 0}
                                            onPress={handlePrevious}
                                            style={styles.navButton}
                                            iconColor={cast.currentIndex <= 0 ? theme.colors.outline : theme.colors.onSurface}
                                        />
                                    )}
                                    {/* Autoplay button */}
                                    <IconButton
                                        icon={cast.autoplay.enabled ? "play-circle" : "play-circle-outline"}
                                        size={32}
                                        onPress={() => setAutoplayMenuVisible(true)}
                                        iconColor={cast.autoplay.enabled ? theme.colors.primary : theme.colors.onSurface}
                                        style={styles.navButton}
                                    />
                                    {/* Autoplay Dialog */}
                                    <Portal>
                                        <Dialog
                                            visible={autoplayMenuVisible}
                                            onDismiss={handleMenuDismiss}
                                        >
                                            <Dialog.Title>{i18n.t('autoplay')}</Dialog.Title>
                                            <Dialog.Content>
                                                <View style={styles.autoplayDialogContent}>
                                                    <View style={styles.autoplayMenuRow}>
                                                        <Text variant="bodyMedium">{i18n.t('autoplay')}</Text>
                                                        <Switch
                                                            value={cast.autoplay.enabled}
                                                            onValueChange={handleAutoplayEnabledChange}
                                                        />
                                                    </View>

                                                    {cast.autoplay.enabled ? (
                                                        <>
                                                            <View style={styles.autoplayMenuRow}>
                                                                <Text
                                                                    variant="bodySmall">{i18n.t('autoplay_indication')}</Text>
                                                                <Switch
                                                                    value={cast.autoplay.onMediaEnd}
                                                                    onValueChange={handleAutoplayOnMediaEndChange}
                                                                />
                                                            </View>

                                                            <View style={styles.autoplayDelaySection}>
                                                                <Text variant="bodySmall">
                                                                    {i18n.t('pictures')} {i18n.t('duration')}: {cast.autoplay.delaySeconds}s
                                                                </Text>
                                                                <Slider
                                                                    style={styles.delaySlider}
                                                                    value={cast.autoplay.delaySeconds}
                                                                    onSlidingComplete={handleAutoplayDelayChange}
                                                                    minimumValue={1}
                                                                    maximumValue={30}
                                                                    step={1}
                                                                    minimumTrackTintColor={theme.colors.primary}
                                                                    maximumTrackTintColor={theme.colors.outline}
                                                                    thumbTintColor={theme.colors.primary}
                                                                />
                                                            </View>

                                                            <View style={styles.resetButtonContainer}>
                                                                <Button
                                                                    mode="text"
                                                                    onPress={resetAutoplaySettings}
                                                                    icon="refresh"
                                                                    style={styles.resetButton}
                                                                >
                                                                    {i18n.t('reset')}
                                                                </Button>
                                                            </View>
                                                        </>
                                                    ) : null}
                                                </View>
                                            </Dialog.Content>
                                            <Dialog.Actions>
                                                <Button onPress={handleMenuDismiss}>
                                                    {i18n.t('close')}
                                                </Button>
                                            </Dialog.Actions>
                                        </Dialog>
                                    </Portal>
                                    <IconButton
                                        icon="stop"
                                        size={32}
                                        onPress={handleStop}
                                        disabled={isLoading}
                                        style={[styles.navButton, styles.stopButton]}
                                        iconColor={theme.colors.error}
                                    />

                                    {cast.assets.length > 1 && (
                                        <IconButton
                                            icon="skip-next"
                                            size={32}
                                            disabled={cast.currentIndex >= cast.assets.length - 1}
                                            onPress={handleNext}
                                            style={styles.navButton}
                                            iconColor={cast.currentIndex >= cast.assets.length - 1 ? theme.colors.outline : theme.colors.onSurface}
                                        />
                                    )}
                                </View>

                                {!isImageMedia() && (
                                    <>
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

                                        <View style={styles.controlButtonsContainer}>
                                            <IconButton
                                                icon="skip-backward"
                                                size={28}
                                                disabled={isLoading || !castManager.canSeek()}
                                                onPress={() => handleSeekTo(0)}
                                                style={styles.controlButton}
                                            />
                                            <IconButton
                                                icon="rewind-10"
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
                                                icon="fast-forward-10"
                                                size={28}
                                                disabled={isLoading || !castManager.canSeek()}
                                                onPress={() => handleSeekAdd(10)}
                                                style={styles.controlButton}
                                            />
                                            <IconButton
                                                icon="fast-forward-30"
                                                size={28}
                                                disabled={isLoading || !castManager.canSeek()}
                                                onPress={() => handleSeekAdd(30)}
                                                style={styles.controlButton}
                                            />
                                        </View>
                                    </>
                                )}
                                {playbackState && (
                                    <View style={styles.statusContainer}>
                                        {!isImageMedia() && (
                                            <View style={styles.volumeSection}>
                                                <IconButton
                                                    icon={playbackState.muted || (playbackState.volume || 0) == 0 ? "volume-off" : "volume-high"}
                                                    size={20}
                                                    onPress={handleMuteToggle}
                                                    disabled={isLoading}
                                                />
                                                <View style={styles.volumeSliderContainer}>
                                                    <Slider
                                                        style={styles.volumeSlider}
                                                        value={CastUtils.volumeToPercentage(playbackState.volume || 0)}
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
                                                    {(playbackState.muted || (playbackState.volume || 0) === 0) ? 'Muted' : `${CastUtils.volumeToPercentage(playbackState.volume || 0)}%`}
                                                </Text>
                                            </View>
                                        )}

                                        {!castManager.canSeek() && !isImageMedia() && (
                                            <Text style={styles.seekWarningText}>
                                                {i18n.t('seek_not_supported')}
                                            </Text>
                                        )}

                                        {isImageMedia() && (
                                            <View style={styles.imageInfoContainer}>
                                                <Text style={styles.imageInfoText}>
                                                    {i18n.t('pictures')} {i18n.t('cast')}
                                                </Text>
                                                <Text style={styles.imageInfoSubtext}>
                                                    {cast.autoplay.enabled
                                                        ? `${i18n.t('autoplay')} ${cast.autoplay.delaySeconds}s`
                                                        : i18n.t('select_media')
                                                    }
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
                </Animated.View>
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
    compactCard: {
        marginHorizontal: 16,
        paddingVertical: 8,
        paddingHorizontal: 16,
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 4.65,
    },
    compactContent: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 60,
    },
    mediaImageContainer: {
        width: 44,
        height: 44,
        marginRight: 12,
    },
    mediaImage: {
        width: 44,
        height: 44,
        borderRadius: 4,
    },
    mediaImagePlaceholder: {
        width: 44,
        height: 44,
        borderRadius: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    mediaTitleContainer: {
        flex: 1,
        marginRight: 12,
    },
    compactMediaTitle: {
        fontWeight: '500',
    },
    autoplayIndicator: {
        fontSize: 10,
        fontStyle: 'italic',
        marginTop: 2,
    },
    playPauseButton: {
        width: 48,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    nextButton: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
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
    playlistInfo: {
        fontSize: 12,
        marginTop: 2,
    },
    thumbnail: {
        width: 60,
        height: 60,
        borderRadius: 8,
        marginRight: 8,
    },
    compactToggleButton: {
        margin: 0,
        marginRight: 4,
    },
    stopButton: {
        backgroundColor: theme.colors.errorContainer,
        margin: 0,
    },
    autoplayMenu: {
        maxHeight: 400,
        marginBottom: 8,
    },
    autoplayMenuContent: {
        padding: 16,
        minWidth: 280,
        maxWidth: 320,
    },
    autoplayMenuRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    autoplayDelaySection: {
        marginTop: 8,
        marginBottom: 12,
    },
    delaySlider: {
        height: 30,
        marginTop: 8,
    },
    resetButtonContainer: {
        alignItems: 'center',
        marginTop: 8,
    },
    resetButton: {
        marginTop: 4,
    },
    controlsContainer: {
        paddingHorizontal: 16,
    },
    navigationContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
        gap: 20,
    },
    navButton: {
        backgroundColor: theme.colors.surfaceVariant,
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
        textAlign: 'center',
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
    autoplayDialogContent: {
        paddingVertical: 8,
    },
});

export default PlayerController;