import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Image, StyleSheet, TouchableOpacity, View,} from 'react-native';
import {
    ActivityIndicator,
    Button,
    Card,
    Chip,
    Dialog,
    FAB,
    IconButton,
    Menu,
    PaperProvider,
    Portal,
    Surface,
    Text,
    TextInput,
    useTheme,
} from 'react-native-paper';
import {Asset} from 'expo-media-library';
import PlayList from '../entities/PlayList';
import {getPlayList, insertOrUpdatePlayList} from '../../db/playlistDB';
import {initTranslate} from '../localization/translate';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import DraggableFlatList, {RenderItemParams, ScaleDecorator} from 'react-native-draggable-flatlist';
import {GestureHandlerRootView} from 'react-native-gesture-handler';

type RootStackParamList = {
    PlaylistEdit: {
        playlistId: number;
        isNew?: boolean;
    };
    MediaSelector: {
        onSelectAssets: (assets: Asset[]) => void;
        allowMultiple?: boolean;
        playlistId: number;
    };
};

type PlaylistEditRouteProp = RouteProp<RootStackParamList, 'PlaylistEdit'>;

interface PlaylistEditScreenProps {
    onPlaylistSaved?: () => void;
}

const PlaylistEditScreen: React.FC<PlaylistEditScreenProps> = ({onPlaylistSaved}) => {
    const theme = useTheme();
    const i18n = initTranslate();
    const navigation = useNavigation();
    const route = useRoute<PlaylistEditRouteProp>();
    const insets = useSafeAreaInsets();

    // Safety check for route params
    const {playlistId, isNew} = route.params || {playlistId: -1, isNew: false};

    const [playlist, setPlaylist] = useState<PlayList>(new PlayList());
    const [editNameDialogVisible, setEditNameDialogVisible] = useState(false);
    const [newName, setNewName] = useState(playlist?.name || '');
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(isNew);
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [assetMenuVisible, setAssetMenuVisible] = useState(false);
    const [errorDialogVisible, setErrorDialogVisible] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [playlistLoaded, setPlaylistLoaded] = useState(false);
    const [showSavedMessage, setShowSavedMessage] = useState(false);

    // Ref to track if component is mounted
    const isMountedRef = useRef(true);
    // Debounced auto-save timer
    const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
    // Timer ref for hiding the saved message
    const savedMessageTimerRef = useRef<NodeJS.Timeout | null>(null);

    const styles = useStyles(theme);

    /**
     * Load playlist from database
     */
    useEffect(() => {
        (async () => {
            const initialPlaylist = await getPlayList(playlistId);
            if (initialPlaylist) {
                setPlaylist(initialPlaylist);
            }
            setPlaylistLoaded(true);
        })();
    }, [playlistId]);

    /**
     * Auto-save function with debouncing
     */
    const autoSave = useCallback(async (playlistToSave: PlayList) => {
        if (!playlistToSave || !isMountedRef.current || !playlistToSave.id) return;

        try {
            setSaving(true);
            await insertOrUpdatePlayList(playlistToSave);

            if (isMountedRef.current) {
                setHasChanges(false);
                setShowSavedMessage(true);

                if (savedMessageTimerRef.current) {
                    clearTimeout(savedMessageTimerRef.current);
                }

                savedMessageTimerRef.current = setTimeout(() => {
                    if (isMountedRef.current) {
                        setShowSavedMessage(false);
                    }
                }, 2000);

                if (onPlaylistSaved) {
                    onPlaylistSaved();
                }
            }
        } catch (error) {
            console.error('PlaylistEdit: Auto-save failed:', error);
            if (isMountedRef.current) {
                setErrorMessage(i18n.t('failed_to_save_playlist'));
                setErrorDialogVisible(true);
            }
        } finally {
            if (isMountedRef.current) {
                setSaving(false);
            }
        }
    }, [onPlaylistSaved, i18n]);

    /**
     * Trigger debounced auto-save when playlist changes
     */
    useEffect(() => {
        // Don't auto-save if no changes or playlist not loaded yet
        if (!hasChanges || !playlist.id || !playlistLoaded) {
            return;
        }

        // Clear existing timer
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
        }

        // Set new timer for auto-save (1 second debounce)
        autoSaveTimerRef.current = setTimeout(() => {
            autoSave(playlist);
        }, 1000);

        // Cleanup
        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
        };
    }, [playlist, hasChanges, playlistLoaded, autoSave]);

    /**
     * Cleanup on unmount
     */
    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
            if (savedMessageTimerRef.current) {
                clearTimeout(savedMessageTimerRef.current);
            }
        };
    }, []);

    /**
     * Override back button behavior - save before leaving if needed
     */
    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', async (e: any) => {
            // If there are pending changes, save them before leaving
            if (hasChanges && autoSaveTimerRef.current) {
                e.preventDefault();

                // Clear timer and save immediately
                if (autoSaveTimerRef.current) {
                    clearTimeout(autoSaveTimerRef.current);
                }

                await autoSave(playlist);

                // Now allow navigation
                navigation.dispatch(e.data.action);
            }
        });

        return unsubscribe;
    }, [navigation, hasChanges, playlist, autoSave]);

    /**
     * Update playlist name
     */
    const handleUpdateName = useCallback(() => {
        const trimmedName = newName?.trim();
        if (trimmedName && trimmedName !== playlist?.name) {
            setPlaylist(prev => ({
                ...prev,
                name: trimmedName,
            }));
            setHasChanges(true);
        }
        setEditNameDialogVisible(false);
    }, [newName, playlist.name]);

    /**
     * Remove asset from playlist
     */
    const handleRemoveAsset = useCallback((assetToRemove: Asset) => {
        setPlaylist(prev => ({
            ...prev,
            assets: prev.assets?.filter(asset => asset.id !== assetToRemove.id) || [],
        }));
        setHasChanges(true);
        setAssetMenuVisible(false);
    }, []);

    /**
     * Handle drag end - update playlist with new order
     */
    const handleDragEnd = useCallback(({data}: { data: Asset[] }) => {
        setPlaylist(prev => ({
            ...prev,
            assets: data,
        }));
        setHasChanges(true);
    }, []);

    /**
     * Assets selected from MediaSelector
     */
    const assetsSelected = useCallback((data: Asset[]) => {
        setPlaylist(prev => ({
            ...prev,
            assets: [...(prev.assets ?? []), ...data]
        }));
        setHasChanges(true);
    }, []);

    /**
     * Navigate to media selector
     */
    const handleAddMedia = useCallback(() => {
        (navigation as any).navigate('MediaSelector', {
            onSelectAssets: assetsSelected,
            allowMultiple: true,
            playlistName: playlist.name,
            playlistId: playlistId
        });
    }, [navigation, playlist.name, playlistId, assetsSelected]);

    /**
     * Format duration for display
     */
    const formatDuration = useCallback((duration: number) => {
        const minutes = Math.floor(duration / 60);
        const seconds = Math.floor(duration % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, []);

    /**
     * Get media type icon
     */
    const getMediaIcon = useCallback((asset: Asset) => {
        switch (asset.mediaType) {
            case 'video':
                return 'video';
            case 'audio':
                return 'music';
            case 'photo':
            default:
                return 'image';
        }
    }, []);

    /**
     * Render asset item with drag handle
     */
    const renderAssetItem = useCallback(({item, drag, isActive}: RenderItemParams<Asset>) => {
        // Ensure all values are safe for rendering
        const safeFilename = item.filename || 'Unknown';
        const safeMediaType = item.mediaType || 'photo';
        const safeDuration = item.duration;

        return (
            <ScaleDecorator>
                <Card style={[styles.assetCard, isActive && styles.assetCardActive]}>
                    <View style={styles.assetContent}>
                        <TouchableOpacity
                            onLongPress={drag}
                            disabled={isActive}
                            style={styles.dragHandle}
                        >
                            <IconButton
                                icon="drag"
                                size={20}
                                iconColor={theme.colors.onSurfaceVariant}
                            />
                        </TouchableOpacity>

                        <View style={styles.assetThumbnail}>
                            {item.uri ? (
                                <Image
                                    source={{uri: item.uri}}
                                    style={styles.thumbnailImage}
                                    resizeMode="cover"
                                />
                            ) : (
                                <Surface style={styles.thumbnailPlaceholder}>
                                    <IconButton
                                        icon={getMediaIcon(item)}
                                        size={24}
                                        iconColor={theme.colors.onSurfaceVariant}
                                    />
                                </Surface>
                            )}
                        </View>

                        <View style={styles.assetInfo}>
                            <Text variant="bodyMedium" numberOfLines={1}>
                                {safeFilename}
                            </Text>
                            <View style={styles.assetMeta}>
                                <Chip
                                    mode="outlined"
                                    compact
                                    icon={getMediaIcon(item)}
                                    style={styles.typeChip}
                                    textStyle={styles.chipTextStyle}
                                >
                                    {safeMediaType}
                                </Chip>
                                {safeDuration ? (
                                    <Text variant="bodySmall" style={styles.duration}>
                                        {formatDuration(safeDuration)}
                                    </Text>
                                ) : null}
                            </View>
                        </View>

                        <Menu
                            visible={assetMenuVisible && selectedAsset?.id === item.id}
                            onDismiss={() => setAssetMenuVisible(false)}
                            anchor={
                                <IconButton
                                    icon="dots-vertical"
                                    size={20}
                                    onPress={() => {
                                        setSelectedAsset(item);
                                        setAssetMenuVisible(true);
                                    }}
                                />
                            }
                        >
                            <Menu.Item
                                onPress={() => handleRemoveAsset(item)}
                                title={i18n.t('remove')}
                                leadingIcon="delete"
                                titleStyle={{color: theme.colors.error}}
                            />
                        </Menu>
                    </View>
                </Card>
            </ScaleDecorator>
        );
    }, [
        theme.colors,
        assetMenuVisible,
        selectedAsset,
        handleRemoveAsset,
        getMediaIcon,
        formatDuration,
        i18n,
        styles,
    ]);

    /**
     * Render empty state
     */
    const renderEmptyState = useCallback(() => (
        <View style={styles.emptyContainer}>
            <Text variant="headlineSmall" style={styles.emptyTitle}>
                {i18n.t('empty_playlist')}
            </Text>
            <Text variant="bodyLarge" style={styles.emptySubtitle}>
                {i18n.t('add_media_to_playlist')}
            </Text>
            <Button
                mode="contained"
                onPress={handleAddMedia}
                style={styles.addFirstMediaButton}
                icon="plus"
            >
                {i18n.t('add_media')}
            </Button>
        </View>
    ), [i18n, handleAddMedia, styles]);

    /**
     * Calculate total playlist duration
     */
    const totalDuration = playlist.assets?.reduce((total, asset) => {
        return total + (asset.duration || 0);
    }, 0) || 0;

    if (!playlistLoaded) {
        return (
            <PaperProvider theme={theme}>
                <View style={{
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 20,
                    backgroundColor: theme.colors.background
                }}>
                    <ActivityIndicator size="large"/>
                </View>
            </PaperProvider>
        )
    }

    return (
        <GestureHandlerRootView style={styles.flexContainer}>
            {/* Saving indicator - overlay top right */}
            {saving && (
                <Surface style={styles.savingIndicator}>
                    <ActivityIndicator size="small" color={theme.colors.primary}/>
                    <Text variant="bodySmall" style={styles.savingText}>
                        {i18n.t('saving')}...
                    </Text>
                </Surface>
            )}

            {/* Saved message - overlay top right, shown for 2 seconds */}
            {showSavedMessage && !saving && (
                <Surface style={styles.savedIndicator}>
                    <IconButton
                        icon="check-circle"
                        size={16}
                        iconColor={theme.colors.primary}
                        style={styles.savedIcon}
                    />
                    <Text variant="bodySmall" style={styles.savedText}>
                        {i18n.t('saved')}
                    </Text>
                </Surface>
            )}

            <Surface style={styles.statsContainer}>
                <View style={styles.statsRow}>
                    <Text variant="headlineSmall">
                        {playlist.name || i18n.t('untitled_playlist')}
                    </Text>
                    <IconButton
                        icon="pencil"
                        onPress={() => {
                            setNewName(playlist.name || '');
                            setEditNameDialogVisible(true);
                        }}
                    />
                </View>
                <View style={styles.statsRow}>
                    <Text variant="bodyMedium">
                        {playlist.assets?.length === 0 ? i18n.t('empty') :
                            playlist.assets?.length === 1 ? `${playlist.assets?.length} ${i18n.t('item')}` :
                                `${playlist.assets?.length || 0} ${i18n.t('items')}`}
                    </Text>
                    {totalDuration > 0 && (
                        <Text variant="bodyMedium">
                            {i18n.t('total_duration')}: {formatDuration(totalDuration)}
                        </Text>
                    )}
                </View>
            </Surface>

            {playlist.assets && playlist.assets.length > 0 ? (
                <DraggableFlatList
                    data={playlist.assets}
                    renderItem={renderAssetItem}
                    keyExtractor={(item: Asset, index: number) => item.id ? `${item.id}` : `asset-${index}`}
                    onDragEnd={handleDragEnd}
                    containerStyle={styles.listContainer}
                    contentContainerStyle={styles.assetsList}
                />
            ) : (
                renderEmptyState()
            )}

            {playlist.assets && playlist.assets.length > 0 &&
                <FAB
                    icon="plus"
                    style={[styles.fab, {bottom: Math.max(insets.bottom, 16) + 16}]}
                    onPress={handleAddMedia}
                    label={i18n.t('add_media')}
                />}

            <Portal>
                <Dialog
                    visible={editNameDialogVisible}
                    onDismiss={() => setEditNameDialogVisible(false)}
                >
                    <Dialog.Icon icon="pencil"/>
                    <Dialog.Title>{i18n.t('edit_playlist_name')}</Dialog.Title>
                    <Dialog.Content>
                        <TextInput
                            label={i18n.t('playlist_name')}
                            value={newName}
                            onChangeText={setNewName}
                            autoFocus
                            maxLength={50}
                        />
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setEditNameDialogVisible(false)}>
                            {i18n.t('cancel')}
                        </Button>
                        <Button
                            onPress={handleUpdateName}
                            disabled={!newName?.trim() || newName?.trim() === playlist.name}
                        >
                            {i18n.t('save')}
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            <Portal>
                <Dialog
                    visible={errorDialogVisible}
                    onDismiss={() => setErrorDialogVisible(false)}
                >
                    <Dialog.Icon icon="alert-circle"/>
                    <Dialog.Title>{i18n.t('error.single')}</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium">
                            {errorMessage}
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setErrorDialogVisible(false)}>
                            {i18n.t('close')}
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </GestureHandlerRootView>
    );
};

const useStyles = (theme: any) =>
    StyleSheet.create({
        flexContainer: {
            flex: 1,
            backgroundColor: theme.colors.background,
        },
        savingIndicator: {
            position: 'absolute',
            top: 16,
            right: 16,
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 20,
            elevation: 4,
            zIndex: 1000,
            backgroundColor: theme.colors.surface,
        },
        savingText: {
            marginLeft: 8,
            color: theme.colors.onSurface,
        },
        savedIndicator: {
            position: 'absolute',
            top: 16,
            right: 16,
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 4,
            paddingHorizontal: 12,
            paddingLeft: 4,
            borderRadius: 20,
            elevation: 2,
            zIndex: 1000,
            backgroundColor: theme.colors.primaryContainer,
        },
        savedIcon: {
            margin: 0,
            padding: 0,
        },
        savedText: {
            color: theme.colors.onPrimaryContainer,
        },
        statsContainer: {
            margin: 16,
            padding: 16,
            borderRadius: 8,
        },
        statsRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        listContainer: {
            flex: 1,
        },
        assetsList: {
            padding: 16,
            flexGrow: 1,
        },
        assetCard: {
            margin: 8,
            elevation: 2,
        },
        assetCardActive: {
            elevation: 8,
            opacity: 0.9,
        },
        assetContent: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: 8,
        },
        dragHandle: {
            marginRight: 8,
        },
        assetThumbnail: {
            width: 60,
            height: 60,
            marginRight: 12,
        },
        thumbnailImage: {
            width: 60,
            height: 60,
            borderRadius: 8,
        },
        thumbnailPlaceholder: {
            width: 60,
            height: 60,
            borderRadius: 8,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.colors.surfaceVariant,
        },
        assetInfo: {
            flex: 1,
            marginRight: 8,
        },
        assetMeta: {
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 4,
            gap: 8,
        },
        typeChip: {
            height: 28,
        },
        chipTextStyle: {
            fontSize: 11,
            lineHeight: 14,
            marginVertical: 0,
            paddingVertical: 0,
        },
        duration: {
            color: theme.colors.onSurfaceVariant,
            fontVariant: ['tabular-nums'],
        },
        fab: {
            position: 'absolute',
            bottom: 16,
            right: 16,
        },
        emptyContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 32,
            paddingVertical: 64,
        },
        emptyTitle: {
            textAlign: 'center',
            marginBottom: 16,
            color: theme.colors.onSurfaceVariant,
        },
        emptySubtitle: {
            textAlign: 'center',
            marginBottom: 32,
            color: theme.colors.onSurfaceVariant,
        },
        addFirstMediaButton: {
            marginTop: 16,
        },
    });

export default PlaylistEditScreen;