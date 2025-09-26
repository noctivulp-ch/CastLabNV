import {useEffect, useRef} from 'react';
import {AppState, AppStateStatus} from 'react-native';
import * as Notifications from 'expo-notifications';
import {NotificationService} from '../services/NotificationService';
import {useCastManager} from '../contexts/castManager-context';

/**
 * Custom hook to handle background notifications for casting
 */
export const useBackgroundNotification = () => {
    const {connectedDevice, playbackState, castingStarted, castManager} = useCastManager();
    const notificationService = useRef(NotificationService.getInstance());
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const hasShownNotification = useRef<boolean>(false);
    const lastPlaybackState = useRef<boolean | null>(null);
    const lastPosition = useRef<number>(0);

    // Single subscription refs for cleanup
    const notificationResponseRef = useRef<Notifications.EventSubscription | null>(null);

    /**
     * Initialize notification service and set up listeners
     */
    useEffect(() => {
        let isMounted = true;

        const initializeNotifications = async () => {
            if (isMounted) {
                await notificationService.current.initialize();
                // Setup both categories at startup
                await notificationService.current.setupNotificationCategories(true);  // Playing
                await notificationService.current.setupNotificationCategories(false); // Paused
            }
        };

        // Initialize immediately
        initializeNotifications();

        // App state change handler
        const handleAppStateChangeLocal = async (nextAppState: AppStateStatus) => {
            const isGoingToBackground = appStateRef.current === 'active' && nextAppState.match(/inactive|background/);
            const isComingToForeground = appStateRef.current.match(/inactive|background/) && nextAppState === 'active';

            appStateRef.current = nextAppState;

            if (isGoingToBackground) {
                if (connectedDevice && castingStarted) {
                    const mediaTitle = castManager.getCurrentMediaTitle() || 'Media';
                    await notificationService.current.showCastingNotification(
                        connectedDevice,
                        mediaTitle,
                        playbackState
                    );
                    hasShownNotification.current = true;
                    lastPlaybackState.current = playbackState?.isPlaying || false;
                }

            } else if (isComingToForeground) {
                await notificationService.current.hideCastingNotification();
                hasShownNotification.current = false;
            }
        };

        const appStateSubscription = AppState.addEventListener('change', handleAppStateChangeLocal);

        // Single notification response listener that handles ALL interactions
        notificationResponseRef.current = Notifications.addNotificationResponseReceivedListener(async response => {
            const notificationData = response.notification.request.content.data || {};
            const actionIdentifier = response.actionIdentifier;

            // Handle different actions
            if (actionIdentifier === 'PLAY') {
                try {
                    await castManager.play();

                    // Immediately update notification with correct state since play() is non-blocking
                    if (hasShownNotification.current && connectedDevice) {
                        const mediaTitle = castManager.getCurrentMediaTitle() || 'Media';
                        const updatedPlaybackState = playbackState ?
                            {...playbackState, isPlaying: true} :
                            {position: 0, duration: 1000, isPlaying: true, volume: 0.5, muted: false};

                        await notificationService.current.showCastingNotification(
                            connectedDevice,
                            mediaTitle,
                            updatedPlaybackState
                        );
                        lastPlaybackState.current = true;
                    }
                } catch (error) {
                    console.error('Error in play action:', error);
                }

            } else if (actionIdentifier === 'PAUSE') {
                try {
                    await castManager.pause();

                    // Immediately update notification with correct state since pause() is non-blocking
                    if (hasShownNotification.current && connectedDevice) {
                        const mediaTitle = castManager.getCurrentMediaTitle() || 'Media';
                        const updatedPlaybackState = playbackState ?
                            {...playbackState, isPlaying: false} :
                            {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};

                        await notificationService.current.showCastingNotification(
                            connectedDevice,
                            mediaTitle,
                            updatedPlaybackState
                        );
                        lastPlaybackState.current = false;
                    }
                } catch (error) {
                    console.error('Error in pause action:', error);
                }

            } else if (actionIdentifier === 'STOP') {
                try {
                    // Use non-blocking approach like play/pause
                    await castManager.stop();

                    // Immediately hide notification since media is stopped
                    if (hasShownNotification.current) {
                        await notificationService.current.hideCastingNotification();
                        hasShownNotification.current = false;
                        lastPlaybackState.current = null;
                    }
                } catch (error) {
                    console.error('Error in stop action:', error);
                }

            }
        });

        return () => {
            isMounted = false;
            appStateSubscription?.remove();
            if (notificationResponseRef.current) {
                notificationResponseRef.current.remove();
                notificationResponseRef.current = null;
            }
        };
    }, [connectedDevice, castingStarted, castManager, playbackState]);

    /**
     * Handle device disconnection and casting stopped
     */
    useEffect(() => {
        if (!connectedDevice) {
            notificationService.current.hideCastingNotification();
            hasShownNotification.current = false;
            lastPlaybackState.current = null;
        }
    }, [connectedDevice]);

    /**
     * Handle casting stopped (media cleared but device still connected)
     */
    useEffect(() => {
        const handleCastingStopped = () => {
            notificationService.current.hideCastingNotification();
            hasShownNotification.current = false;
            lastPlaybackState.current = null;
        };

        castManager.on('castingStopped', handleCastingStopped);

        return () => {
            castManager.off('castingStopped', handleCastingStopped);
        };
    }, [castManager]);

    /**
     * Update notification when playback state changes from polling
     * This runs with a delay to avoid conflicts with manual actions
     */
    useEffect(() => {
        const timeoutId = setTimeout(async () => {
            const isInBackground = appStateRef.current.match(/inactive|background/);

            if (isInBackground && hasShownNotification.current && connectedDevice && castingStarted && playbackState) {
                // Update notification on state changes or position changes (every 5 seconds)
                const stateChanged = lastPlaybackState.current !== playbackState.isPlaying;
                const positionChanged = Math.abs((lastPosition.current || 0) - playbackState.position) >= 5;

                if (stateChanged || positionChanged) {
                    const mediaTitle = castManager.getCurrentMediaTitle() || 'Media';
                    await notificationService.current.showCastingNotification(
                        connectedDevice,
                        mediaTitle,
                        playbackState
                    );

                    lastPlaybackState.current = playbackState.isPlaying;
                    lastPosition.current = playbackState.position;
                }
            }
        }, 500); // Delay to let optimistic updates complete

        return () => clearTimeout(timeoutId);
    }, [playbackState?.isPlaying, playbackState?.position, connectedDevice, castingStarted, castManager]);

    /**
     * Cleanup on unmount
     */
    useEffect(() => {
        return () => {
            notificationService.current.cleanup();
            if (notificationResponseRef.current) {
                notificationResponseRef.current.remove();
            }
        };
    }, []);

    return {
        showNotification: async (mediaTitle?: string) => {
            if (connectedDevice && appStateRef.current.match(/inactive|background/) && !hasShownNotification.current) {
                await notificationService.current.showCastingNotification(
                    connectedDevice,
                    mediaTitle || castManager.getCurrentMediaTitle() || 'Media',
                    playbackState
                );
                hasShownNotification.current = true;
            }
        },
        hideNotification: async () => {
            await notificationService.current.hideCastingNotification();
            hasShownNotification.current = false;
        },
    };
};