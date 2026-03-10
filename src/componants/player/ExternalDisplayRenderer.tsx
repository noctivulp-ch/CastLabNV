import React, {useEffect, useRef} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import ExternalDisplay, {useExternalDisplay} from 'react-native-external-display';
import {useVideoPlayer, VideoView} from 'expo-video';
import {useCastManager} from '../../contexts/castManager-context';
import {ExternalDisplayController} from '../../DLNACast/types/ExternalDisplayController';

const ExternalDisplayRenderer: React.FC = () => {
    const {castManager, connectedDevice, currentMediaInfo, castingStarted} = useCastManager();
    const screens = useExternalDisplay();
    const screenIds = Object.keys(screens);
    const prevScreenIdsRef = useRef<string[]>([]);

    const isActive = connectedDevice?.protocol === 'external-display' && castingStarted && currentMediaInfo;
    const isVideo = isActive && currentMediaInfo?.contentType?.includes('video');
    const isAudio = isActive && currentMediaInfo?.contentType?.includes('audio');
    const needsPlayer = isVideo || isAudio;

    const player = useVideoPlayer(
        needsPlayer ? {uri: currentMediaInfo!.contentUrl} : null,
        (p) => {
            if (needsPlayer) {
                p.timeUpdateEventInterval = 1;
                p.play();
            }
        }
    );

    // Register/unregister external displays when screens change
    useEffect(() => {
        const prevIds = prevScreenIdsRef.current;
        const currentIds = screenIds;

        for (const id of currentIds) {
            if (!prevIds.includes(id)) {
                const screen = screens[id];
                const displayName = screen ? `Display (${screen.width}x${screen.height})` : `Display ${id}`;
                castManager.addExternalDisplay(id, displayName);
            }
        }

        for (const id of prevIds) {
            if (!currentIds.includes(id)) {
                castManager.removeExternalDisplay(id);
            }
        }

        prevScreenIdsRef.current = currentIds;
    }, [screenIds.join(',')]);

    // Register controller with CastManager
    useEffect(() => {
        if (connectedDevice?.protocol !== 'external-display') return;

        const controller: ExternalDisplayController = {
            play: () => { player.play(); },
            pause: () => { player.pause(); },
            seek: (position: number) => { player.currentTime = position; },
            setVolume: (volume: number) => { player.volume = volume; },
            mute: (muted: boolean) => { player.muted = muted; },
            stop: () => { player.pause(); },
        };

        castManager.setExternalDisplayController(controller);
        return () => castManager.setExternalDisplayController(null);
    }, [connectedDevice?.id, player]);

    // Handle playback status updates via timeUpdate event
    useEffect(() => {
        if (!needsPlayer) return;

        const subscription = player.addListener('timeUpdate', (payload) => {
            castManager.updateExternalDisplayState({
                position: payload.currentTime,
                duration: player.duration,
                isPlaying: player.playing,
                volume: player.volume,
                muted: player.muted,
            });
        });

        return () => subscription.remove();
    }, [player, needsPlayer, castManager]);

    if (!isActive) {
        return null;
    }

    const screenId = connectedDevice!.id.replace('display-', '');
    if (!screens[screenId]) return null;

    const isImage = currentMediaInfo?.contentType?.includes('image');

    return (
        <ExternalDisplay mainScreenStyle={styles.hidden} screen={screenId} fallbackInMainScreen>
            <View style={styles.container}>
                {isVideo && (
                    <VideoView
                        player={player}
                        style={styles.fullScreen}
                        contentFit="contain"
                        nativeControls={false}
                    />
                )}
                {isImage && (
                    <Image
                        source={{uri: currentMediaInfo!.contentUrl}}
                        style={styles.fullScreen}
                        resizeMode="contain"
                    />
                )}
                {isAudio && (
                    <>
                        <VideoView
                            player={player}
                            style={styles.hidden}
                            nativeControls={false}
                        />
                        <Text style={styles.audioTitle}>
                            {currentMediaInfo?.metadata?.title || 'Audio'}
                        </Text>
                    </>
                )}
            </View>
        </ExternalDisplay>
    );
};

const styles = StyleSheet.create({
    hidden: {
        width: 0,
        height: 0,
        position: 'absolute',
    },
    container: {
        flex: 1,
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullScreen: {
        width: '100%',
        height: '100%',
    },
    audioTitle: {
        color: '#fff',
        fontSize: 24,
        textAlign: 'center',
        paddingHorizontal: 40,
    },
});

export default ExternalDisplayRenderer;
