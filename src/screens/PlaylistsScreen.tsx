import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, FlatList, Image, StyleSheet, TouchableOpacity, View,} from 'react-native';
import {
    Button,
    Card,
    Chip,
    Dialog,
    Divider,
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
import {deletePlaylist, getAllPlayLists, insertOrUpdatePlayList} from '../../db/playlistDB';
import {initTranslate} from '../localization/translate';
import {useDispatch} from 'react-redux';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from "react-native-safe-area-context";
import KeyboardAwareDialog from '../componants/KeyboardAwareDialog';

interface PlaylistsScreenProps {
    playerHeight?: number;
    onScrollDirectionChange?: (isScrollingDown: boolean) => void;
}

export interface PlaylistsScreenRef {
    refreshPlaylists: () => Promise<void>;
}

const PlaylistsScreen = React.forwardRef<PlaylistsScreenRef, PlaylistsScreenProps>(
    ({playerHeight = 0, onScrollDirectionChange}, ref) => {
        const theme = useTheme();
        const i18n = initTranslate();
        const dispatch = useDispatch();
        const navigation = useNavigation();

        // State management
        const [playlists, setPlaylists] = useState<PlayList[]>([]);
        const [loading, setLoading] = useState(true);
        const [createDialogVisible, setCreateDialogVisible] = useState(false);
        const [newPlaylistName, setNewPlaylistName] = useState('');
        const [fabVisible, setFabVisible] = useState(true);
        const [selectedPlaylist, setSelectedPlaylist] = useState<PlayList | null>(null);
        const [playlistMenuVisible, setPlaylistMenuVisible] = useState(false);
        const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
        const [playlistToDelete, setPlaylistToDelete] = useState<PlayList | null>(null);

        // Scroll tracking
        const scrollY = useRef(new Animated.Value(0)).current;
        const lastScrollY = useRef(0);

        const styles = useStyles(theme);
        const insets = useSafeAreaInsets();

        /**
         * Load all playlists from database
         */
        const loadPlaylists = useCallback(async () => {
            try {
                setLoading(true);
                const playlistsData = await getAllPlayLists();
                setPlaylists(playlistsData);
            } catch (error) {
                console.error('Failed to load playlists:', error);
            } finally {
                setLoading(false);
            }
        }, []);

        /**
         * Refresh playlists - exposed via ref
         */
        const refreshPlaylists = useCallback(async () => {
            await loadPlaylists();
        }, [loadPlaylists]);

        // Expose refresh function via ref
        React.useImperativeHandle(ref, () => ({
            refreshPlaylists,
        }));

        /**
         * Handle scroll direction changes
         */
        const handleScroll = useCallback((event: any) => {
            const currentScrollY = event.nativeEvent.contentOffset.y;
            const scrollDirection = currentScrollY > lastScrollY.current;

            lastScrollY.current = currentScrollY;

            if (onScrollDirectionChange) {
                onScrollDirectionChange(scrollDirection);
            }

            // Hide/show FAB based on scroll direction
            setFabVisible(!scrollDirection || currentScrollY < 100);
        }, [onScrollDirectionChange]);

        /**
         * Handle playlist creation
         */
        const handleCreatePlaylist = useCallback(async () => {
            if (!newPlaylistName.trim()) {
                return;
            }
            try {
                const newPlaylist = new PlayList(
                    newPlaylistName.trim(),
                    [],
                    undefined,
                    undefined,
                    undefined
                );

                const result = await insertOrUpdatePlayList(newPlaylist);
                await loadPlaylists();

                const insertedId = Array.isArray(result) && result.length > 0 ? result[0].id : newPlaylist.id;
                (navigation as any).navigate('PlaylistEdit', {
                    playlistId: insertedId,
                    isNew: true,
                    playlistName: newPlaylistName,
                });
                setCreateDialogVisible(false);
                setNewPlaylistName('');
            } catch (error) {
                console.error('Failed to create playlist:', error);
            }
        }, [newPlaylistName, navigation, loadPlaylists]);

        /**
         * Handle playlist deletion confirmation
         */
        const handleDeletePlaylist = useCallback((playlist: PlayList) => {
            if (!playlist) {
                console.error('handleDeletePlaylist: playlist is undefined');
                return;
            }
            setPlaylistToDelete(playlist);
            setDeleteDialogVisible(true);
        }, []);

        /**
         * Confirm playlist deletion
         */
        const confirmDeletePlaylist = useCallback(async () => {
            if (!playlistToDelete?.id) {
                console.error('confirmDeletePlaylist: playlistToDelete or id is undefined');
                return;
            }

            try {
                await deletePlaylist(playlistToDelete.id);
                await loadPlaylists();
                setDeleteDialogVisible(false);
                setPlaylistToDelete(null);
            } catch (error) {
                console.error('Failed to delete playlist:', error);
            }
        }, [playlistToDelete, loadPlaylists]);

        /**
         * Handle playlist selection for playback
         */
        const handlePlayPlaylist = useCallback((playlist: PlayList) => {
            if (!playlist) {
                console.error('handlePlayPlaylist: playlist is undefined');
                return;
            }

            if (!playlist.assets || playlist.assets.length === 0) {
                alert(`${i18n.t('empty_playlist')}\n${i18n.t('empty_playlist_message')}`);
                return;
            }

            // Dispatch playlist to cast state
            dispatch({
                type: 'cast/setPlaylist',
                payload: {
                    assets: playlist.assets,
                    currentIndex: 0,
                },
            });
        }, [dispatch, i18n]);

        /**
         * Navigate to playlist edit
         */
        const navigateToPlaylistEdit = useCallback((playlist: PlayList) => {
            if (!playlist) {
                console.error('navigateToPlaylistEdit: playlist is undefined');
                return;
            }
            try {
                (navigation as any).navigate('PlaylistEdit', {
                    playlistId: playlist.id,
                    playlistName: playlist.name,
                });
            } catch (error) {
                console.error('Failed to navigate to PlaylistEdit:', error);
            }
        }, [navigation]);

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
         * Render individual playlist item
         */
        const renderPlaylistItem = useCallback(({item}: { item: PlayList }) => {
            if (!item) {
                console.error('renderPlaylistItem: item is undefined');
                return null;
            }

            const assetCount = item.assets?.length || 0;
            const hasAssets = assetCount > 0;
            const previewAssets = item.assets?.slice(0, 4) || [];

            return (
                <Card style={styles.playlistCard}>
                    <TouchableOpacity
                        onPress={() => navigateToPlaylistEdit(item)}
                        activeOpacity={0.7}
                    >
                        <View style={styles.playlistContent}>
                            <View style={styles.playlistHeader}>
                                <View style={styles.playlistInfo}>
                                    <Text variant="titleMedium" style={styles.playlistName}>
                                        {item.name || 'Untitled Playlist'}
                                    </Text>
                                    <View style={styles.playlistMeta}>
                                        <Chip
                                            mode="outlined"
                                            compact
                                            style={styles.assetCountChip}
                                            textStyle={styles.chipText}
                                        >
                                            {assetCount === 0 ? i18n.t('empty') :
                                                assetCount === 1 ? `${assetCount} ${i18n.t('item')}` :
                                                    `${assetCount} ${i18n.t('items')}`}
                                        </Chip>
                                        {item.updated_at && (
                                            <Text variant="bodySmall" style={styles.updatedDate}>
                                                {i18n.t('updated')}: {new Date(item.updated_at).toLocaleDateString()}
                                            </Text>
                                        )}
                                    </View>
                                </View>

                                <View style={styles.playlistActions}>
                                    {hasAssets && (
                                        <IconButton
                                            icon="play-circle"
                                            size={32}
                                            onPress={() => handlePlayPlaylist(item)}
                                            iconColor={theme.colors.primary}
                                        />
                                    )}

                                    <Menu
                                        visible={playlistMenuVisible && selectedPlaylist?.id === item.id}
                                        onDismiss={() => setPlaylistMenuVisible(false)}
                                        anchor={
                                            <IconButton
                                                icon="dots-vertical"
                                                size={24}
                                                onPress={() => {
                                                    setSelectedPlaylist(item);
                                                    setPlaylistMenuVisible(true);
                                                }}
                                            />
                                        }
                                    >
                                        <Menu.Item
                                            onPress={() => {
                                                setPlaylistMenuVisible(false);
                                                navigateToPlaylistEdit(item);
                                            }}
                                            title={i18n.t('edit')}
                                            leadingIcon="pencil"
                                        />
                                        <Divider/>
                                        <Menu.Item
                                            onPress={() => {
                                                setPlaylistMenuVisible(false);
                                                handleDeletePlaylist(item);
                                            }}
                                            title={i18n.t('delete')}
                                            leadingIcon="delete"
                                            titleStyle={{color: theme.colors.error}}
                                        />
                                    </Menu>
                                </View>
                            </View>

                            {/* Thumbnail preview grid */}
                            {hasAssets && (
                                <View style={styles.previewContainer}>
                                    <Text variant="bodySmall" style={styles.previewLabel}>
                                        {i18n.t('preview')}:
                                    </Text>
                                    <View style={styles.thumbnailGrid}>
                                        {previewAssets.map((asset: Asset, index: number) => (
                                            <View key={asset.id || index} style={styles.thumbnailWrapper}>
                                                {asset.uri ? (
                                                    <Image
                                                        source={{uri: asset.uri}}
                                                        style={styles.thumbnail}
                                                        resizeMode="cover"
                                                    />
                                                ) : (
                                                    <Surface style={styles.thumbnailPlaceholder}>
                                                        <IconButton
                                                            icon={getMediaIcon(asset)}
                                                            size={20}
                                                            iconColor={theme.colors.onSurfaceVariant}
                                                        />
                                                    </Surface>
                                                )}
                                            </View>
                                        ))}
                                        {assetCount > 4 && (
                                            <View style={styles.moreIndicator}>
                                                <Text variant="bodySmall" style={styles.moreText}>
                                                    +{assetCount - 4}
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>
                </Card>
            );
        }, [
            navigation,
            theme.colors,
            i18n,
            playlistMenuVisible,
            selectedPlaylist,
            handlePlayPlaylist,
            handleDeletePlaylist,
            navigateToPlaylistEdit,
            getMediaIcon,
            styles,
        ]);

        /**
         * Render empty state
         */
        const renderEmptyState = useCallback(() => (
            <View style={styles.emptyContainer}>
                <Text variant="headlineSmall" style={styles.emptyTitle}>
                    {i18n.t('no_playlists')}
                </Text>
                <Text variant="bodyLarge" style={styles.emptySubtitle}>
                    {i18n.t('create_first_playlist')}
                </Text>
                <Button
                    mode="contained"
                    onPress={() => setCreateDialogVisible(true)}
                    style={styles.createFirstButton}
                    icon="plus"
                >
                    {i18n.t('create_playlist')}
                </Button>
            </View>
        ), [i18n, styles]);

        // Load playlists on mount
        useEffect(() => {
            loadPlaylists();
        }, [loadPlaylists]);

        // Refresh playlists when screen comes into focus
        useFocusEffect(
            useCallback(() => {
                loadPlaylists();
            }, [loadPlaylists])
        );

        return (
            <View style={styles.container}>
                <FlatList
                    data={playlists || []}
                    renderItem={renderPlaylistItem}
                    keyExtractor={(item, index) => item?.id?.toString() || `playlist-${index}`}
                    contentContainerStyle={[
                        styles.listContainer,
                        {paddingBottom: playerHeight + 20},
                    ]}
                    ListEmptyComponent={loading ? null : renderEmptyState}
                    onScroll={Animated.event(
                        [{nativeEvent: {contentOffset: {y: scrollY}}}],
                        {useNativeDriver: false, listener: handleScroll}
                    )}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={false}
                />

                {/* Floating Action Button - only show when playlists exist */}
                {fabVisible && playlists.length > 0 && (
                    <FAB
                        icon="plus"
                        style={[styles.fab, {bottom: Math.max(insets.bottom, 16) + 16}]}
                        onPress={() => setCreateDialogVisible(true)}
                        label={i18n.t('create_playlist')}
                    />
                )}

                {/* Create Playlist Dialog */}
                <Portal>
                    <KeyboardAwareDialog
                        visible={createDialogVisible}
                        onDismiss={() => setCreateDialogVisible(false)}
                    >
                        <Dialog.Title>{i18n.t('create_new_playlist')}</Dialog.Title>
                        <Dialog.Content>
                            <TextInput
                                label={i18n.t('playlist_name')}
                                value={newPlaylistName}
                                onChangeText={setNewPlaylistName}
                                autoFocus
                                maxLength={50}
                            />
                        </Dialog.Content>
                        <Dialog.Actions>
                            <Button onPress={() => setCreateDialogVisible(false)}>
                                {i18n.t('cancel')}
                            </Button>
                            <Button
                                onPress={handleCreatePlaylist}
                                disabled={!newPlaylistName.trim()}
                            >
                                {i18n.t('create')}
                            </Button>
                        </Dialog.Actions>
                    </KeyboardAwareDialog>
                </Portal>

                {/* Delete Confirmation Dialog */}
                <Portal>
                    <Dialog
                        visible={deleteDialogVisible}
                        onDismiss={() => setDeleteDialogVisible(false)}
                    >
                        <Dialog.Icon icon="delete"/>
                        <Dialog.Title>{i18n.t('delete_playlist')}</Dialog.Title>
                        <Dialog.Content>
                            <Text variant="bodyMedium">
                                {i18n.t('delete_playlist_confirmation', {name: playlistToDelete?.name || 'playlist'})}
                            </Text>
                        </Dialog.Content>
                        <Dialog.Actions>
                            <Button onPress={() => setDeleteDialogVisible(false)}>
                                {i18n.t('cancel')}
                            </Button>
                            <Button
                                onPress={confirmDeletePlaylist}
                                buttonColor={theme.colors.error}
                                textColor={theme.colors.onError}
                            >
                                {i18n.t('delete')}
                            </Button>
                        </Dialog.Actions>
                    </Dialog>
                </Portal>
            </View>
        );
    }
);

const useStyles = (theme: any) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.background,
        },
        listContainer: {
            padding: 16,
            flexGrow: 1,
        },
        playlistCard: {
            marginBottom: 12,
            elevation: 2,
        },
        playlistContent: {
            padding: 16,
        },
        playlistHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
        },
        playlistInfo: {
            flex: 1,
            marginRight: 16,
        },
        playlistName: {
            fontWeight: 'bold',
            marginBottom: 8,
        },
        playlistMeta: {
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
        },
        assetCountChip: {
            height: 28,
            alignSelf: 'flex-start',
        },
        chipText: {
            fontSize: 12,
            lineHeight: 16,
        },
        updatedDate: {
            color: theme.colors.onSurfaceVariant,
        },
        playlistActions: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        previewContainer: {
            marginTop: 12,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: theme.colors.outline,
        },
        previewLabel: {
            fontWeight: '500',
            marginBottom: 8,
            color: theme.colors.onSurfaceVariant,
        },
        thumbnailGrid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
        },
        thumbnailWrapper: {
            width: 60,
            height: 60,
            borderRadius: 8,
            overflow: 'hidden',
        },
        thumbnail: {
            width: '100%',
            height: '100%',
        },
        thumbnailPlaceholder: {
            width: '100%',
            height: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.colors.surfaceVariant,
        },
        moreIndicator: {
            width: 60,
            height: 60,
            borderRadius: 8,
            backgroundColor: theme.colors.surfaceVariant,
            justifyContent: 'center',
            alignItems: 'center',
        },
        moreText: {
            fontWeight: 'bold',
            color: theme.colors.onSurfaceVariant,
        },
        fab: {
            position: 'absolute',
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
        createFirstButton: {
            marginTop: 16,
        },
    });

export default PlaylistsScreen;