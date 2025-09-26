import * as Notifications from 'expo-notifications';
import {Device} from '../DLNACast/types/Device';
import {PlaybackState} from '../DLNACast/CastManager';
import {initTranslate} from '../localization/translate';

/**
 * Simple notification service for DLNA casting
 */
export class NotificationService {
    private static instance: NotificationService | null = null;
    private notificationId: string | null = null;
    private isInitialized = false;
    private i18n = initTranslate();

    private constructor() {
    }

    /**
     * Get singleton instance of NotificationService
     */
    static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService();
        }
        return NotificationService.instance;
    }

    /**
     * Initialize notification settings and request permissions
     */
    async initialize(): Promise<boolean> {
        if (this.isInitialized) {
            return true;
        }

        try {
            // Configure notification behavior
            Notifications.setNotificationHandler({
                handleNotification: async () => ({
                    shouldShowBanner: true,
                    shouldShowList: true,
                    shouldSetBadge: false,
                    shouldPlaySound: false,
                }),
            });

            // Request permissions
            const {status: existingStatus} = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;

            if (existingStatus !== 'granted') {
                const {status} = await Notifications.requestPermissionsAsync();
                finalStatus = status;
            }

            if (finalStatus !== 'granted') {
                console.warn('Notification permissions not granted');
                return false;
            }

            this.isInitialized = true;
            return true;
        } catch (error) {
            console.error('Error initializing notifications:', error);
            return false;
        }
    }

    /**
     * Show casting notification with device and media info
     */
    async showCastingNotification(
        device: Device,
        mediaTitle?: string,
        playbackState?: PlaybackState
    ): Promise<void> {
        if (!this.isInitialized) {
            const initialized = await this.initialize();
            if (!initialized) return;
        }

        try {
            const isPlaying = playbackState?.isPlaying ?? false;
            const statusIcon = isPlaying ? '▶️' : '⏸️';
            const statusText = isPlaying ? this.i18n.t('play') : this.i18n.t('pause');


            // Setup categories BEFORE creating notification
            await this.setupNotificationCategories(isPlaying);

            const content: Notifications.NotificationContentInput = {
                title: `CastLab - ${device.name}`,
                body: mediaTitle
                    ? `${statusIcon} ${mediaTitle} • ${statusText}`
                    : `${this.i18n.t('cast_on')} ${device.manufacturer || 'DLNA'}`,
                data: {
                    type: 'casting',
                    deviceId: device.id,
                    deviceName: device.name,
                    mediaTitle: mediaTitle || '',
                    isPlaying: isPlaying,
                },
                categoryIdentifier: isPlaying ? 'CASTING_PLAYING' : 'CASTING_PAUSED',
                sound: false,
                priority: Notifications.AndroidNotificationPriority.LOW,
                sticky: true,
            };

            // Update the notification with same identifier
            this.notificationId = await Notifications.scheduleNotificationAsync({
                identifier: 'CASTING_NOTIFICATION', // Always use same ID for updates
                content,
                trigger: null, // Show immediately
            });
        } catch (error) {
            console.error('Error showing casting notification:', error);
        }
    }

    /**
     * Hide casting notification
     */
    async hideCastingNotification(): Promise<void> {
        try {
            if (this.notificationId) {
                await Notifications.cancelScheduledNotificationAsync(this.notificationId);
                await Notifications.dismissNotificationAsync(this.notificationId);
                this.notificationId = null;
            }

            // Clean up any old casting notifications
            const presentedNotifications = await Notifications.getPresentedNotificationsAsync();
            for (const notification of presentedNotifications) {
                if (notification.request.content.data?.type === 'casting') {
                    await Notifications.dismissNotificationAsync(notification.request.identifier);
                }
            }
        } catch (error) {
        }
    }

    /**
     * Setup notification categories based on playback state
     */
    async setupNotificationCategories(isPlaying?: boolean): Promise<void> {
        try {
            if (isPlaying) {
                // When playing, show Pause and Stop
                await Notifications.setNotificationCategoryAsync('CASTING_PLAYING', [
                    {
                        identifier: 'PAUSE',
                        buttonTitle: this.i18n.t('pause'),
                        options: {
                            opensAppToForeground: false,
                        },
                    },
                    {
                        identifier: 'STOP',
                        buttonTitle: this.i18n.t('stop'),
                        options: {
                            opensAppToForeground: false,
                        },
                    },
                ]);
            } else {
                // When paused, show Play and Stop
                await Notifications.setNotificationCategoryAsync('CASTING_PAUSED', [
                    {
                        identifier: 'PLAY',
                        buttonTitle: this.i18n.t('play'),
                        options: {
                            opensAppToForeground: false,
                        },
                    },
                    {
                        identifier: 'STOP',
                        buttonTitle: this.i18n.t('stop'),
                        options: {
                            opensAppToForeground: false,
                        },
                    },
                ]);
            }
        } catch (error) {
            console.warn('Error setting up notification categories:', error);
        }
    }

    /**
     * Clean up notification service
     */
    cleanup(): void {
        this.hideCastingNotification();
        this.notificationId = null;
        this.isInitialized = false;
    }
}