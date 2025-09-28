import React, {useCallback, useState} from 'react';
import {FlatList, Image, StyleSheet, View,} from 'react-native';
import {
    ActivityIndicator,
    Button,
    Card,
    Chip,
    Dialog,
    FAB,
    IconButton,
    Menu,
    Portal,
    Surface,
    Text,
    TextInput,
    useTheme,
} from 'react-native-paper';
import {Asset} from 'expo-media-library';
import PlayList from '../entities/PlayList';
import {insertOrUpdatePlayList} from '../../db/playlistDB';
import {initTranslate} from '../localization/translate';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

type RootStackParamList = {
    PlaylistEdit: {
        playlist: {
            id?: number;
            name?: string;
            assets?: any[];
        };
        isNew?: boolean;
    };
    MediaSelector: {
        onSelectAssets: (assets: Asset[]) => void;
        excludeAssets?: Asset[];
        allowMultiple?: boolean;
    };
};

type PlaylistEditRouteProp = RouteProp<RootStackParamList, 'PlaylistEdit'>;

interface PlaylistEditScreenProps {
}

const PlaylistEditScreen: React.FC<PlaylistEditScreenProps> = () => {
    const theme = useTheme();
    const i18n = initTranslate();
    const navigation = useNavigation();
    const route = useRoute<PlaylistEditRouteProp>();
    const insets = useSafeAreaInsets();

    // Safety check for route params
    const routeParams = route.params || {playlist: {}, isNew: false};
    const {playlist: initialPlaylist = {}, isNew = false} = routeParams;

    // Create a proper PlayList instance from serializable data with safety checks
    const [playlist, setPlaylist] = useState<PlayList>(() => {
        const playlistInstance = new PlayList();

        // Ensure safe access to properties
        playlistInstance.id = initialPlaylist?.id || undefined;
        playlistInstance.name = initialPlaylist?.name || '';

        // Convert plain objects back to Asset objects if needed with safety checks
        playlistInstance.assets = ((initialPlaylist?.assets || []) as any[]).map(asset => {
            // Ensure asset is defined and has required properties
            if (!asset) {
                return null;
            }

            return {
                id: asset.id || '',
                filename: asset.filename || 'Unknown',
                uri: asset.uri || '',
                mediaType: asset.mediaType || 'photo',
                duration: asset.duration || undefined,
                width: asset.width || undefined,
                height: asset.height || undefined,
                albumId: asset.albumId || undefined,
            } as Asset;
        }).filter(asset => asset !== null) as Asset[]; // Remove null entries

        return playlistInstance;
    });

    const [editNameDialogVisible, setEditNameDialogVisible] = useState(false);
    const [newName, setNewName] = useState(playlist.name || '');
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(isNew);
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [assetMenuVisible, setAssetMenuVisible] = useState(false);
    const [unsavedChangesDialogVisible, setUnsavedChangesDialogVisible] = useState(false);
    const [successDialogVisible, setSuccessDialogVisible] = useState(false);
    const [errorDialogVisible, setErrorDialogVisible] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const styles = useStyles(theme);

    /**
     * Save playlist to database
     */
    const savePlaylist = useCallback(async () => {
        if (!hasChanges) return;

        try {
            setSaving(true);
            await insertOrUpdatePlayList(playlist);
            setHasChanges(false);
            setSuccessDialogVisible(true);
        } catch (error) {
            console.error('Failed to save playlist:', error);
            setErrorMessage(i18n.t('failed_to_save_playlist'));
            setErrorDialogVisible(true);
        } finally {
            setSaving(false);
        }
    }, [playlist, hasChanges, i18n]);

    /**
     * Handle back navigation with unsaved changes
     */
    const handleBackPress = useCallback(() => {
        if (hasChanges) {
            setUnsavedChangesDialogVisible(true);
        } else {
            navigation.goBack();
        }
    }, [hasChanges, navigation]);

    /**
     * Discard changes and go back
     */
    const discardChangesAndGoBack = useCallback(() => {
        setUnsavedChangesDialogVisible(false);
        navigation.goBack();
    }, [navigation]);

    /**
     * Save changes and go back
     */
    const saveChangesAndGoBack = useCallback(async () => {
        setUnsavedChangesDialogVisible(false);
        await savePlaylist();
        navigation.goBack();
    }, [savePlaylist, navigation]);

    /**
     * Update playlist name
     */
    const handleUpdateName = useCallback(() => {
        const trimmedName = newName?.trim();
        if (trimmedName && trimmedName !== playlist.name) {
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
     * Navigate to media selector with callback
     */
    const handleAddMedia = useCallback(() => {
        // Create a callback function that will handle the selected assets
        const onSelectAssets = (selectedAssets: Asset[]) => {
            setPlaylist(prev => ({
                ...prev,
                assets: [...(prev.assets || []), ...selectedAssets],
            }));
            setHasChanges(true);
        };

        (navigation as any).navigate('MediaSelector', {
            onSelectAssets,
            excludeAssets: playlist.assets || [],
            allowMultiple: true,
        });
    }, [navigation, playlist.assets]);

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
     * Render asset item
     */
    const renderAssetItem = useCallback(({item, index}: { item: Asset; index: number }) => {
        return (
            <Card style={styles.assetCard} key={item.id}>
                <View style={styles.assetContent}>
                    {/* Drag handle */}
                    <View style={styles.dragHandle}>
                        <IconButton
                            icon="drag"
                            size={20}
                            iconColor={theme.colors.onSurfaceVariant}
                        />
                    </View>

                    {/* Asset thumbnail */}
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

                    {/* Asset info */}
                    <View style={styles.assetInfo}>
                        <Text variant="bodyMedium" numberOfLines={1}>
                            {item.filename}
                        </Text>
                        <View style={styles.assetMeta}>
                            <Chip
                                mode="outlined"
                                compact
                                icon={getMediaIcon(item)}
                                style={styles.typeChip}
                            >
                                {item.mediaType}
                            </Chip>
                            {item.duration && (
                                <Text variant="bodySmall" style={styles.duration}>
                                    {formatDuration(item.duration)}
                                </Text>
                            )}
                        </View>
                    </View>

                    {/* Asset actions */}
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

    // Override back button behavior
    React.useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', (e) => {
            if (!hasChanges) {
                return;
            }

            e.preventDefault();
            setUnsavedChangesDialogVisible(true);
        });

        return unsubscribe;
    }, [navigation, hasChanges]);

    return (
        <View style={styles.container}>
            {/* Playlist Stats */}
            <Surface style={styles.statsContainer}>
                <View style={styles.statsRow}>
                    <Text variant="headlineSmall">
                        {playlist.name || i18n.t('playlist_name')}
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

            {/* Assets List */}
            {playlist.assets && playlist.assets.length > 0 ? (
                <FlatList
                    data={playlist.assets}
                    renderItem={renderAssetItem}
                    keyExtractor={(item: Asset) => item.id || `asset-${Math.random()}`}
                    contentContainerStyle={styles.assetsList}
                />
            ) : (
                renderEmptyState()
            )}

            {/* Add Media FAB */}
            <FAB
                icon="plus"
                style={[styles.fab, {bottom: Math.max(insets.bottom, 16) + 16}]}
                onPress={handleAddMedia}
                label={i18n.t('add_media')}
            />

            {/* Loading Overlay */}
            {saving && (
                <Portal>
                    <View style={styles.loadingOverlay}>
                        <Surface style={styles.loadingCard}>
                            <ActivityIndicator size="large"/>
                            <Text style={styles.loadingText}>
                                {i18n.t('saving')}...
                            </Text>
                        </Surface>
                    </View>
                </Portal>
            )}

            {/* Edit Name Dialog */}
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

            {/* Unsaved Changes Dialog */}
            <Portal>
                <Dialog
                    visible={unsavedChangesDialogVisible}
                    onDismiss={() => setUnsavedChangesDialogVisible(false)}
                >
                    <Dialog.Icon icon="content-save-alert"/>
                    <Dialog.Title>{i18n.t('unsaved_changes')}</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium">
                            {i18n.t('unsaved_changes_message')}
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button
                            onPress={discardChangesAndGoBack}
                            buttonColor={theme.colors.error}
                            textColor={theme.colors.onError}
                        >
                            {i18n.t('discard')}
                        </Button>
                        <Button onPress={() => setUnsavedChangesDialogVisible(false)}>
                            {i18n.t('cancel')}
                        </Button>
                        <Button
                            onPress={saveChangesAndGoBack}
                            mode="contained"
                        >
                            {i18n.t('save')}
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            {/* Success Dialog */}
            <Portal>
                <Dialog
                    visible={successDialogVisible}
                    onDismiss={() => setSuccessDialogVisible(false)}
                >
                    <Dialog.Icon icon="check-circle"/>
                    <Dialog.Title>{i18n.t('success')}</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium">
                            {i18n.t('playlist_saved')}
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setSuccessDialogVisible(false)}>
                            {i18n.t('close')}
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            {/* Error Dialog */}
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
        </View>
    );
};

const useStyles = (theme: any) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.background,
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
        assetsList: {
            padding: 16,
        },
        assetCard: {
            margin: 8,
            elevation: 2,
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
            height: 24,
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
        loadingOverlay: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            justifyContent: 'center',
            alignItems: 'center',
        },
        loadingCard: {
            padding: 24,
            borderRadius: 12,
            alignItems: 'center',
            minWidth: 200,
        },
        loadingText: {
            marginTop: 16,
            textAlign: 'center',
        },
    });

export default PlaylistEditScreen;