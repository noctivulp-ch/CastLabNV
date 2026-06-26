import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useDispatch} from 'react-redux';
import * as Notifications from 'expo-notifications';
import * as VideoThumbnails from 'expo-video-thumbnails';
import {useCastManager} from '../contexts/castManager-context';
import {initTranslate} from '../localization/translate';
import {LogService} from '../services/LogService';
import {nextAsset, previousAsset} from '../store/slice/castSlice';
import * as MediaForeground from '../../modules/expo-media-foreground/src';
import {ForegroundContent} from '../../modules/expo-media-foreground/src';

/**
 * Drives the casting foreground service notification and keeps the process alive
 * while connected so the media HTTP server keeps serving in the background.
 */
export const useBackgroundNotification = () => {
    const {connectedDevice, playbackState, currentMediaInfo, castManager} = useCastManager();
    const dispatch = useDispatch();
    const i18n = initTranslate();

    const mediaTitle = currentMediaInfo?.metadata?.title;
    const contentUrl = currentMediaInfo?.contentUrl;
    const contentType = currentMediaInfo?.contentType ?? '';
    const isPlaying = playbackState?.isPlaying ?? false;
    const [artworkUri, setArtworkUri] = useState<string | undefined>(undefined);

    // Latest position/duration in seconds, read fresh when building the notification
    const positionRef = useRef(0);
    const durationRef = useRef(0);
    positionRef.current = playbackState?.position ?? 0;
    durationRef.current = playbackState?.duration ?? 0;

    const buildContent = useCallback((): ForegroundContent => {
        // Show controls as soon as a media is cast, even if the Play SOAP is slow to confirm
        const hasMedia = !!mediaTitle;
        return {
            title: connectedDevice ? `CastLab - ${connectedDevice.name}` : 'CastLab',
            text: hasMedia
                ? mediaTitle!
                : connectedDevice
                    ? i18n.t('connected_to_device', {deviceName: connectedDevice.name})
                    : '',
            isPlaying,
            showControls: hasMedia,
            playLabel: i18n.t('play'),
            pauseLabel: i18n.t('pause'),
            stopLabel: i18n.t('stop'),
            prevLabel: i18n.t('previous'),
            nextLabel: i18n.t('next'),
            positionMs: Math.round(positionRef.current * 1000),
            durationMs: Math.round(durationRef.current * 1000),
            artworkUri,
        };
    }, [connectedDevice, mediaTitle, isPlaying, artworkUri]);

    // Request notification permission so the foreground notification is visible on Android 13+
    useEffect(() => {
        Notifications.requestPermissionsAsync().catch(() => {});
    }, []);

    // Resolve a thumbnail: photo uses its image, video uses metadata or a generated frame
    useEffect(() => {
        let cancelled = false;

        const resolveArtwork = async (): Promise<string | undefined> => {
            if (!contentUrl) return undefined;
            if (contentType.startsWith('image/')) return contentUrl;

            const metaImage = currentMediaInfo?.metadata?.images?.[0]?.url;
            if (metaImage && metaImage !== contentUrl) return metaImage;

            if (contentType.startsWith('video/')) {
                try {
                    const {uri} = await VideoThumbnails.getThumbnailAsync(contentUrl, {time: 1000});
                    return uri;
                } catch (error) {
                    LogService.warn('Foreground', `thumbnail failed: ${error}`);
                }
            }
            return undefined;
        };

        if (!connectedDevice || !contentUrl) {
            setArtworkUri(undefined);
            return;
        }
        resolveArtwork().then((uri) => {
            if (!cancelled) setArtworkUri(uri);
        });

        return () => {
            cancelled = true;
        };
    }, [contentUrl, contentType, connectedDevice]);

    // Start/stop the foreground service with the connection
    useEffect(() => {
        if (connectedDevice) {
            MediaForeground.startMediaForeground(buildContent())
                .catch((err) => LogService.warn('Foreground', `start failed: ${err}`));
        } else {
            MediaForeground.stopMediaForeground().catch(() => {});
        }
    }, [connectedDevice]);

    // Update the notification when media, playback state or artwork changes
    useEffect(() => {
        if (connectedDevice) {
            MediaForeground.updateMediaForeground(buildContent())
                .catch((err) => LogService.warn('Foreground', `update failed: ${err}`));
        }
    }, [connectedDevice, mediaTitle, isPlaying, artworkUri]);

    // Refresh the seek bar baseline while playing in the foreground. The system
    // extrapolates the position between updates from the playback state.
    useEffect(() => {
        if (!connectedDevice || !mediaTitle || !isPlaying) return;
        const id = setInterval(() => {
            if (AppState.currentState !== 'active') return;
            MediaForeground.updateMediaForeground(buildContent()).catch(() => {});
        }, 3000);
        return () => clearInterval(id);
    }, [connectedDevice, mediaTitle, isPlaying, buildContent]);

    // Suspend DLNA polling while backgrounded to avoid futile SOAP timeouts and
    // a reachability blip disconnecting the cast. Resume on foreground.
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            castManager.setBackgroundMode(state !== 'active');
        });
        return () => subscription.remove();
    }, [castManager]);

    // Forward notification actions to the cast manager
    useEffect(() => {
        const subscription = MediaForeground.addCastActionListener(async (action, positionMs) => {
            try {
                if (action === 'play') {
                    await castManager.play();
                } else if (action === 'pause') {
                    await castManager.pause();
                } else if (action === 'stop') {
                    await castManager.stop();
                } else if (action === 'next') {
                    dispatch(nextAsset());
                } else if (action === 'previous') {
                    dispatch(previousAsset());
                } else if (action === 'seek') {
                    await castManager.seek(Math.round(positionMs / 1000));
                }
            } catch (error) {
                LogService.warn('Foreground', `action ${action} failed: ${error}`);
            }
        });

        return () => subscription.remove();
    }, [castManager, dispatch]);
};
