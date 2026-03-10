import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Dimensions, FlatList, Image, StyleSheet, TouchableOpacity, View,} from 'react-native';
import {
    ActivityIndicator,
    Button,
    Checkbox,
    FAB,
    Icon,
    IconButton,
    Menu,
    PaperProvider,
    SegmentedButtons,
    Surface,
    Text,
    useTheme,
} from 'react-native-paper';
import * as MediaLibrary from 'expo-media-library';
import {Album, Asset, SortBy, SortByValue} from 'expo-media-library';
import {initTranslate} from '../localization/translate';
import {RouteProp, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {DatePickerModal} from 'react-native-paper-dates';
import PlayList from "../entities/PlayList";
import {getPlayList} from "../../db/playlistDB";

type RootStackParamList = {
    MediaSelector: {
        onSelectAssets: (assets: Asset[]) => void;
        allowMultiple?: boolean;
        playlistId: number;
    };
};

type MediaSelectorRouteProp = RouteProp<RootStackParamList, 'MediaSelector'>;

interface MediaSelectorScreenProps {
}

type MediaFilter = 'all' | 'photo' | 'video' | 'audio';
type ViewMode = 'albums' | 'assets';

/**
 * Date range interface for filtering media
 */
interface DateRange {
    startDate: Date | undefined;
    endDate: Date | undefined;
}

const {width: screenWidth} = Dimensions.get('window');
const ITEM_SIZE = (screenWidth - 48) / 3; // 3 columns with padding
const ALBUM_ITEM_SIZE = (screenWidth - 48) / 2; // 2 columns for albums

const MediaSelectorScreen: React.FC<MediaSelectorScreenProps> = () => {
    const theme = useTheme();
    const i18n = initTranslate();
    const navigation = useNavigation();
    const route = useRoute<MediaSelectorRouteProp>();
    const insets = useSafeAreaInsets();
    const [excludeAssets, setExcludeAssets] = useState<Asset[]>([]);
    const {allowMultiple = true, onSelectAssets, playlistId} = route.params;
    const [playlist, setPlaylist] = useState<PlayList>(new PlayList());
    // Media library permissions
    const [permissionResponse, requestPermission] = MediaLibrary.usePermissions();

    // Navigation state - start with albums view
    const [viewMode, setViewMode] = useState<ViewMode>('albums');

    // State management
    const [assets, setAssets] = useState<Asset[]>([]);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
    const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
    const [hasNextPage, setHasNextPage] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
    const [playlistLoaded, setPlaylistLoaded] = useState(false);
    const isConfirmingRef = useRef(false);
    // Sorting state
    const [sortModificationTimeAsc, setSortModificationTimeAsc] = useState<SortByValue>([SortBy.modificationTime, false]);
    const [sortDuration, setSortDuration] = useState<SortByValue | undefined>(undefined);
    const [sortWidth, setSortWidth] = useState<SortByValue | undefined>(undefined);
    const [sortHeight, setSortHeight] = useState<SortByValue | undefined>(undefined);
    const [sortBy, setSortBy] = useState<SortByValue[]>([sortModificationTimeAsc]);
    const [sortByMenuVisible, setSortByMenuVisible] = useState<boolean>(false);

    // Date filtering state
    const [dateRange, setDateRange] = useState<DateRange>({
        startDate: undefined,
        endDate: undefined
    });
    const [datePickerOpen, setDatePickerOpen] = useState(false);

    const styles = useStyles(theme);

    // Excluded asset IDs for quick lookup - now used only for visual indication
    const excludedIds = useMemo(() =>
            new Set(excludeAssets.map(asset => asset.id)),
        [excludeAssets]
    );
    useEffect(() => {
        (async () => {
            const initialPlaylist = await getPlayList(playlistId);
            if (initialPlaylist) {
                if (initialPlaylist?.assets && initialPlaylist.assets.length > 0) {
                    setExcludeAssets(initialPlaylist.assets);
                }
                setPlaylist(initialPlaylist);
            }
            setPlaylistLoaded(true);
        })();
    }, []);
    /**
     * Update sorting criteria whenever individual sort options change
     */
    useEffect(() => {
        const newSortBy: SortByValue[] = [];

        if (sortDuration) {
            newSortBy.push(sortDuration);
        }
        if (sortHeight) {
            newSortBy.push(sortHeight);
        }
        if (sortWidth) {
            newSortBy.push(sortWidth);
        }
        if (sortModificationTimeAsc) {
            newSortBy.push(sortModificationTimeAsc);
        }
        setSortBy(newSortBy);
    }, [sortModificationTimeAsc, sortDuration, sortWidth, sortHeight]);

    /**
     * Fetch galleries/albums from MediaLibrary
     */
    const fetchGalleries = useCallback(async () => {
        try {
            const albums = await MediaLibrary.getAlbumsAsync({
                includeSmartAlbums: true,
            });

            // Sort albums by asset count (descending)
            albums.sort((a, b) => b.assetCount - a.assetCount);
            return albums;
        } catch (error) {
            console.error('MediaSelector: Error fetching albums:', error);
            return [];
        }
    }, []);

    /**
     * Get albums from device - handles permission request if needed
     */
    const getAlbums = useCallback(async (): Promise<Album[]> => {

        if (permissionResponse?.status !== 'granted') {
            const newPermission = await requestPermission();

            if (newPermission.status === 'granted') {
                return await fetchGalleries();
            } else {
                console.warn('MediaSelector: Permission denied');
                return [];
            }
        }
        return await fetchGalleries();
    }, [permissionResponse?.status, requestPermission, fetchGalleries]);

    /**
     * Load media library albums
     */
    const loadAlbums = useCallback(async () => {
        try {
            const albumsData = await getAlbums();
            setAlbums(albumsData);
        } catch (error) {
            console.error('MediaSelector: Failed to load albums:', error);
        } finally {
            setLoading(false);
        }
    }, [getAlbums]);

    /**
     * Convert our filter type to MediaLibrary type
     */
    const getMediaLibraryType = useCallback((filter: MediaFilter) => {
        switch (filter) {
            case 'photo':
                return MediaLibrary.MediaType.photo;
            case 'video':
                return MediaLibrary.MediaType.video;
            case 'audio':
                return MediaLibrary.MediaType.audio;
            default:
                return [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video, MediaLibrary.MediaType.audio];
        }
    }, []);

    /**
     * Build MediaLibrary options with all filters
     */
    const buildAssetsOptions = useCallback((afterCursor?: string) => {
        const options: any = {
            first: 60,
            mediaType: getMediaLibraryType(mediaFilter),
            sortBy: sortBy,
            album: selectedAlbum || undefined,
        };

        // Add date filtering
        if (dateRange.startDate) {
            options.createdAfter = dateRange.startDate.getTime();
        }

        if (dateRange.endDate) {
            const endOfDay = new Date(dateRange.endDate);
            endOfDay.setHours(23, 59, 59, 999);
            options.createdBefore = endOfDay.getTime();
        }

        // Use proper cursor for pagination
        if (afterCursor) {
            options.after = afterCursor;
        }

        return options;
    }, [mediaFilter, selectedAlbum, sortBy, dateRange, getMediaLibraryType]);

    /**
     * Load assets from selected album or all assets
     */
    const loadAssets = useCallback(async (reset = false) => {
        try {
            if (reset) {
                setLoading(true);
                setAssets([]);
                setHasNextPage(true);
                setEndCursor(undefined);
            } else {
                setLoadingMore(true);
            }

            const options = buildAssetsOptions(reset ? undefined : endCursor);
            const assetsPage = await MediaLibrary.getAssetsAsync(options);

            if (reset) {
                setAssets(assetsPage.assets);
            } else {
                setAssets(prev => [...prev, ...assetsPage.assets]);
            }

            setHasNextPage(assetsPage.hasNextPage);
            setEndCursor(assetsPage.endCursor);
        } catch (error) {
            console.error('Failed to load assets:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [buildAssetsOptions, endCursor]);

    /**
     * Handle album selection - navigate to assets view
     */
    const handleAlbumSelect = useCallback((album: Album) => {
        setSelectedAlbum(album);
        setViewMode('assets');
        setSelectedAssets([]);
        // Reset filters when switching albums
        setMediaFilter('all');
        setDateRange({startDate: undefined, endDate: undefined});
    }, []);

    /**
     * Navigate back to albums view
     */
    const handleBackToAlbums = useCallback(() => {
        setViewMode('albums');
        setSelectedAlbum(null);
        setAssets([]);
        setSelectedAssets([]);
    }, []);

    /**
     * Handle hardware back button and navigation
     */
    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', (e) => {
            // Allow navigation if confirming selection
            console.log('beforeRemove', isConfirmingRef.current);
            if (isConfirmingRef.current) {
                return;
            }
            if (viewMode === 'assets') {
                // Prevent default behavior of leaving the screen
                e.preventDefault();
                // Navigate back to albums view instead
                handleBackToAlbums();
            }
            // If we're in albums view, allow normal navigation back to PlaylistEditScreen
        });

        return unsubscribe;
    }, [navigation, viewMode, handleBackToAlbums]);

    /**
     * Toggle asset selection - now allows deselecting previously excluded assets
     */
    const toggleAssetSelection = useCallback((asset: Asset) => {
        setSelectedAssets(prev => {
            const isSelected = prev.some(selected => selected.id === asset.id);

            if (isSelected) {
                // Deselect the asset
                return prev.filter(selected => selected.id !== asset.id);
            } else {
                // Select the asset
                if (allowMultiple) {
                    return [...prev, asset];
                } else {
                    return [asset];
                }
            }
        });
    }, [allowMultiple]);

    /**
     * Handle media filter change
     */
    const handleFilterChange = useCallback((value: string) => {
        setMediaFilter(value as MediaFilter);
        setSelectedAssets([]);
    }, []);

    /**
     * Handle date range selection from date picker
     */
    const onDateRangeConfirm = useCallback(({startDate, endDate}: {
        startDate: Date | undefined,
        endDate: Date | undefined
    }) => {
        setDateRange({startDate, endDate});
        setDatePickerOpen(false);
    }, []);

    /**
     * Clear date filter
     */
    const clearDateFilter = useCallback(() => {
        setDateRange({startDate: undefined, endDate: undefined});
    }, []);

    /**
     * Get date range display text for breadcrumb
     */
    const getDateRangeDisplayText = useCallback(() => {
        if (!dateRange.startDate && !dateRange.endDate) {
            return null;
        }

        const formatDate = (date: Date) => {
            try {
                return date.toLocaleDateString();
            } catch (error) {
                return i18n.t('invalid_date');
            }
        };

        if (dateRange.startDate && dateRange.endDate) {
            return `${formatDate(dateRange.startDate)} - ${formatDate(dateRange.endDate)}`;
        } else if (dateRange.startDate) {
            return `${i18n.t('from')} ${formatDate(dateRange.startDate)}`;
        } else if (dateRange.endDate) {
            return `${i18n.t('until')} ${formatDate(dateRange.endDate)}`;
        }

        return null;
    }, [dateRange, i18n]);

    /**
     * Confirm selection and navigate back
     */
    const handleConfirmSelection = useCallback(() => {
        // Set ref immediately (synchronous)
        isConfirmingRef.current = true;
        if (onSelectAssets && typeof onSelectAssets === 'function') {
            try {
                onSelectAssets(selectedAssets);
                navigation.goBack();
            } catch (error) {
                console.error('MediaSelector: Error executing callback:', error);
                navigation.goBack();
            }
        } else {
            console.error('MediaSelector: No valid callback found in route params');
            navigation.goBack();
        }
    }, [selectedAssets, navigation, onSelectAssets]);

    /**
     * Load more assets when reaching end of list
     */
    const handleLoadMore = useCallback(() => {
        if (hasNextPage && !loadingMore && !loading) {
            loadAssets(false);
        }
    }, [hasNextPage, loadingMore, loading, loadAssets]);

    /**
     * Format duration for display
     */
    const formatDuration = useCallback((duration: number) => {
        if (!duration || typeof duration !== 'number') {
            return '0:00';
        }
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
                return 'play-circle-outline';
            case 'audio':
                return 'music';
            default:
                return null;
        }
    }, []);

    /**
     * Get trailing icon for sorting menu items
     */
    const getTrailingIconDuration = () => {
        if (!sortDuration) {
            return "";
        } else {
            return sortDuration[1] ? "arrow-up-thick" : "arrow-down-thick"
        }
    }

    const getTrailingIconWidth = () => {
        if (!sortWidth) {
            return "";
        } else {
            return sortWidth[1] ? "arrow-up-thick" : "arrow-down-thick"
        }
    }

    const getTrailingIconHeight = () => {
        if (!sortHeight) {
            return "";
        } else {
            return sortHeight[1] ? "arrow-up-thick" : "arrow-down-thick"
        }
    }

    /**
     * Render album item for albums view
     */
    const renderAlbumItem = useCallback(({item}: { item: Album }) => {
        return (
            <TouchableOpacity
                style={styles.albumItem}
                onPress={() => handleAlbumSelect(item)}
                activeOpacity={0.7}
            >
                <Surface style={styles.albumCard}>
                    <View style={styles.albumThumbnail}>
                        <Icon source="folder" size={32} color={theme.colors.primary} />
                    </View>
                    <View style={styles.albumInfo}>
                        <Text variant="titleMedium" numberOfLines={2} style={styles.albumTitle}>
                            {item.title}
                        </Text>
                        <Text variant="bodySmall" style={styles.albumCount}>
                            {item.assetCount} {item.assetCount === 1 ? i18n.t('item') : i18n.t('items')}
                        </Text>
                    </View>
                </Surface>
            </TouchableOpacity>
        );
    }, [handleAlbumSelect, i18n, styles]);

    /**
     * Render asset item for assets view
     */
    const renderAssetItem = useCallback(({item}: { item: Asset }) => {
        const isSelected = selectedAssets.some(selected => selected.id === item.id);
        const wasInPlaylist = excludedIds.has(item.id);
        const icon = getMediaIcon(item);

        return (
            <TouchableOpacity
                style={[
                    styles.assetItem,
                    isSelected && styles.selectedAssetItem,
                    wasInPlaylist && !isSelected && styles.wasInPlaylistAssetItem,
                ]}
                onPress={() => toggleAssetSelection(item)}
                activeOpacity={0.7}
            >
                <Image
                    source={{uri: item.uri}}
                    style={styles.assetImage}
                    resizeMode="cover"
                />

                {/* Media type overlay */}
                {icon ? (
                    <View style={styles.mediaTypeOverlay}>
                        <IconButton
                            icon={icon}
                            size={20}
                            iconColor="white"
                        />
                    </View>
                ) : null}

                {/* Duration overlay for videos */}
                {item.duration && item.mediaType === 'video' ? (
                    <View style={styles.durationOverlay}>
                        <Text style={styles.durationText}>
                            {formatDuration(item.duration)}
                        </Text>
                    </View>
                ) : null}

                {/* Selection indicator */}
                <View style={styles.selectionOverlay}>
                    {wasInPlaylist && !isSelected ? (
                        <IconButton
                            icon="check-circle"
                            size={24}
                            iconColor={theme.colors.primary}
                            style={styles.wasInPlaylistIcon}
                        />
                    ) : (
                        <Checkbox
                            status={isSelected ? 'checked' : 'unchecked'}
                            uncheckedColor="white"
                            color={theme.colors.primary}
                        />
                    )}
                </View>
            </TouchableOpacity>
        );
    }, [
        selectedAssets,
        excludedIds,
        toggleAssetSelection,
        getMediaIcon,
        formatDuration,
        theme.colors,
        styles,
    ]);

    // Initialize albums on component mount and when permissions change
    useEffect(() => {
        const initializeAlbums = async () => {

            if (permissionResponse?.status === 'granted') {
                const albums = await fetchGalleries();
                setAlbums(albums);
                setLoading(false);
            } else if (permissionResponse?.status === 'denied') {
                // Permission denied, show empty state
                console.warn('MediaSelector: Permission denied, showing empty state');
                setAlbums([]);
                setLoading(false);
            } else if (permissionResponse?.status === 'undetermined') {
                // Permission not yet requested, request it
                const albums = await getAlbums();
                setAlbums(albums);
                setLoading(false);
            }
        };

        // Only run when permissionResponse is available
        if (permissionResponse !== null) {
            initializeAlbums();
        }
    }, [permissionResponse?.status, fetchGalleries, getAlbums]);

    // Load assets when entering assets view or filters change
    useEffect(() => {
        if (viewMode === 'assets' && selectedAlbum) {
            loadAssets(true);
        }
    }, [viewMode, selectedAlbum?.id, mediaFilter, sortBy, dateRange]);
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
        <View style={styles.container}>
            {/* Breadcrumb - only show in assets view */}
            {viewMode === 'assets' && (
                <Surface style={styles.breadcrumbContainer}>
                    <TouchableOpacity
                        style={styles.breadcrumb}
                        onPress={handleBackToAlbums}
                        activeOpacity={0.7}
                    >
                        <IconButton
                            icon="chevron-left"
                            size={20}
                            style={styles.breadcrumbIcon}
                        />
                        <Text variant="bodySmall" style={styles.breadcrumbText}>
                            {i18n.t('all_albums')}
                        </Text>
                        <Text variant="bodySmall" style={styles.breadcrumbSeparator}>
                            {' > '}
                        </Text>
                        <Text variant="bodySmall" style={[styles.breadcrumbText, styles.breadcrumbCurrent]}>
                            {selectedAlbum?.title || i18n.t('unknown_album')}
                        </Text>
                        {getDateRangeDisplayText() && (
                            <React.Fragment>
                                <Text variant="bodySmall" style={styles.breadcrumbSeparator}>
                                    {' • '}
                                </Text>
                                <Text variant="bodySmall" style={styles.breadcrumbText}>
                                    {getDateRangeDisplayText()}
                                </Text>
                            </React.Fragment>
                        )}
                    </TouchableOpacity>
                </Surface>
            )}

            {/* Selection count info */}
            {selectedAssets.length > 0 && (
                <Surface style={styles.selectionContainer}>
                    <Text variant="bodyMedium">
                        {i18n.t('selected_count', {count: selectedAssets.length})}
                    </Text>
                </Surface>
            )}

            {viewMode === 'albums' ? (
                /* Albums View */
                loading ? (
                    <View style={styles.loadingContainer}>
                        <Text>{i18n.t('loading')}...</Text>
                        <Text variant="bodySmall" style={{marginTop: 8}}>
                            {permissionResponse === null ? i18n.t('checking_permissions') : i18n.t('loading_albums_from_media_library')}
                        </Text>
                    </View>
                ) : albums.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Text variant="headlineSmall" style={styles.emptyTitle}>
                            {permissionResponse?.status === 'denied' ? i18n.t('media_access_denied') : i18n.t('no_albums_found')}
                        </Text>
                        <Text variant="bodyLarge" style={styles.emptySubtitle}>
                            {permissionResponse?.status === 'denied'
                                ? i18n.t('media_access_denied_message')
                                : i18n.t('no_albums_found_message')}
                        </Text>
                        {permissionResponse?.status !== 'denied' && (
                            <Button
                                mode="contained"
                                onPress={() => loadAlbums()}
                                style={styles.retryButton}
                                icon="refresh"
                            >
                                {i18n.t('retry')}
                            </Button>
                        )}
                    </View>
                ) : (
                    <FlatList
                        data={albums}
                        renderItem={renderAlbumItem}
                        keyExtractor={(item) => item.id}
                        numColumns={2}
                        contentContainerStyle={styles.albumsGrid}
                        showsVerticalScrollIndicator={false}
                    />
                )
            ) : (
                /* Assets View */
                <>
                    {/* Filter Controls */}
                    <View style={styles.filtersContainer}>
                        <SegmentedButtons
                            value={mediaFilter}
                            onValueChange={handleFilterChange}
                            buttons={[
                                {value: 'all', label: i18n.t('all')},
                                {value: 'photo', label: i18n.t('pictures')},
                                {value: 'video', label: i18n.t('videos')},
                                {value: 'audio', label: i18n.t('audios')},
                            ]}
                            style={styles.segmentedButtons}
                        />

                        <View style={styles.controlsRow}>
                            {/* Sorting options menu */}
                            <Menu
                                visible={sortByMenuVisible}
                                anchorPosition={"bottom"}
                                mode={"elevated"}
                                onDismiss={() => setSortByMenuVisible(false)}
                                anchor={
                                    <Button
                                        icon={"sort"}
                                        mode="contained-tonal"
                                        onPress={() => setSortByMenuVisible(true)}
                                        style={styles.sortButton}
                                    >
                                        {i18n.t('sort')}
                                    </Button>
                                }
                            >
                                <Menu.Item onPress={() => {
                                    setSortModificationTimeAsc([SortBy.modificationTime, !sortModificationTimeAsc[1]]);
                                }} title={i18n.t('modificationTime')}
                                           trailingIcon={sortModificationTimeAsc[1] ? "arrow-up-thick" : "arrow-down-thick"}/>

                                <Menu.Item onPress={() => {
                                    setSortDuration([SortBy.duration, sortDuration ? !sortDuration[1] : true]);
                                }} title={i18n.t('duration')} trailingIcon={getTrailingIconDuration()}/>

                                <Menu.Item onPress={() => {
                                    setSortWidth([SortBy.width, sortWidth ? !sortWidth[1] : true]);
                                }} title={i18n.t('width')} trailingIcon={getTrailingIconWidth()}/>

                                <Menu.Item onPress={() => {
                                    setSortHeight([SortBy.height, sortHeight ? !sortHeight[1] : true]);
                                }} title={i18n.t('height')} trailingIcon={getTrailingIconHeight()}/>

                                <Menu.Item onPress={() => {
                                    setSortDuration(undefined);
                                    setSortWidth(undefined);
                                    setSortHeight(undefined);
                                    setSortModificationTimeAsc([SortBy.modificationTime, false]);
                                    setSortByMenuVisible(false);
                                }} title={i18n.t('reset')}/>
                            </Menu>

                            {/* Date filter button */}
                            <Button
                                icon="calendar-range"
                                mode={dateRange.startDate || dateRange.endDate ? "contained" : "contained-tonal"}
                                onPress={() => setDatePickerOpen(true)}
                                style={styles.dateFilterButton}
                            >
                                {i18n.t('date_filter')}
                            </Button>

                            {/* Clear date filter button */}
                            {(dateRange.startDate || dateRange.endDate) && (
                                <IconButton
                                    icon="close"
                                    mode="contained-tonal"
                                    onPress={clearDateFilter}
                                    size={20}
                                />
                            )}
                        </View>
                    </View>

                    {/* Assets count info */}
                    <View style={styles.statusBar}>
                        <Text variant="bodySmall" style={[styles.statusText, {color: theme.colors.onSurfaceVariant}]}>
                            {assets.length} {assets.length === 1 ? i18n.t('item') : i18n.t('items')}
                            {hasNextPage ? ` (${i18n.t('more_available')})` : ''}
                        </Text>
                        {loadingMore ? (
                            <Text variant="bodySmall" style={[styles.loadingText, {color: theme.colors.primary}]}>
                                {i18n.t('loading')}...
                            </Text>
                        ) : null}
                    </View>

                    {/* Assets Grid */}
                    <FlatList
                        data={assets}
                        renderItem={renderAssetItem}
                        keyExtractor={(item, index) => item.id ? `${item.id}-${index}` : `asset-${index}`}
                        numColumns={3}
                        contentContainerStyle={styles.assetsGrid}
                        onEndReached={handleLoadMore}
                        onEndReachedThreshold={0.5}
                        ListFooterComponent={
                            loadingMore ? (
                                <View style={styles.loadingFooter}>
                                    <Text>
                                        {i18n.t('loading_more')}...
                                    </Text>
                                </View>
                            ) : null
                        }
                        showsVerticalScrollIndicator={false}
                    />
                </>
            )}

            {/* Selection FAB - show in both views if items are selected */}
            {selectedAssets.length > 0 ? (
                <FAB
                    icon="check"
                    style={[styles.fab, {bottom: Math.max(insets.bottom, 16) + 16}]}
                    onPress={handleConfirmSelection}
                    label={allowMultiple
                        ? i18n.t('add_selected', {count: selectedAssets.length})
                        : i18n.t('select')
                    }
                />
            ) : null}

            {/* Date Range Picker Modal */}
            <DatePickerModal
                locale="en"
                mode="range"
                visible={datePickerOpen}
                onDismiss={() => setDatePickerOpen(false)}
                startDate={dateRange.startDate}
                endDate={dateRange.endDate}
                onConfirm={onDateRangeConfirm}
                saveLabel={i18n.t('save')}
                label={i18n.t('select_date_range')}
                startLabel={i18n.t('start_date')}
                endLabel={i18n.t('end_date')}
                animationType="slide"
            />
        </View>
    );
};

const useStyles = (theme: any) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.background,
        },
        titleContainer: {
            paddingHorizontal: 16,
            paddingVertical: 12,
        },
        selectionContainer: {
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: theme.colors.primaryContainer,
        },
        breadcrumbContainer: {
            paddingHorizontal: 8,
            paddingVertical: 8,
        },
        breadcrumb: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        breadcrumbIcon: {
            margin: 0,
        },
        breadcrumbText: {
            color: theme.colors.onSurfaceVariant,
        },
        breadcrumbCurrent: {
            fontWeight: 'bold',
            color: theme.colors.onSurface,
        },
        breadcrumbSeparator: {
            color: theme.colors.onSurfaceVariant,
        },
        albumsGrid: {
            padding: 8,
        },
        albumItem: {
            width: ALBUM_ITEM_SIZE,
            margin: 8,
        },
        albumCard: {
            padding: 16,
            borderRadius: 12,
            elevation: 2,
            height: 120,
            justifyContent: 'center',
            alignItems: 'center',
        },
        albumThumbnail: {
            marginBottom: 8,
        },
        albumInfo: {
            alignItems: 'center',
        },
        albumTitle: {
            textAlign: 'center',
            fontWeight: 'bold',
            marginBottom: 4,
        },
        albumCount: {
            textAlign: 'center',
            color: theme.colors.onSurfaceVariant,
        },
        filtersContainer: {
            paddingHorizontal: 16,
            paddingBottom: 8,
        },
        segmentedButtons: {
            marginBottom: 12,
        },
        controlsRow: {
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 12,
            gap: 8,
        },
        sortButton: {
            flex: 1,
        },
        dateFilterButton: {
            flex: 1,
        },
        statusBar: {
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 8,
        },
        statusText: {
            fontSize: 12,
        },
        loadingText: {
            fontSize: 12,
            fontStyle: 'italic',
        },
        assetsGrid: {
            padding: 8,
        },
        assetItem: {
            width: ITEM_SIZE,
            height: ITEM_SIZE,
            margin: 4,
            borderRadius: 8,
            overflow: 'hidden',
            position: 'relative',
        },
        selectedAssetItem: {
            borderWidth: 3,
            borderColor: theme.colors.primary,
        },
        wasInPlaylistAssetItem: {
            borderWidth: 2,
            borderColor: theme.colors.primary,
            opacity: 0.7,
        },
        assetImage: {
            width: '100%',
            height: '100%',
        },
        mediaTypeOverlay: {
            position: 'absolute',
            bottom: 4,
            left: 4,
        },
        durationOverlay: {
            position: 'absolute',
            bottom: 4,
            right: 4,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            borderRadius: 4,
            paddingHorizontal: 6,
            paddingVertical: 2,
        },
        durationText: {
            color: 'white',
            fontSize: 10,
            fontVariant: ['tabular-nums'],
        },
        selectionOverlay: {
            position: 'absolute',
            top: 4,
            right: 4,
        },
        wasInPlaylistIcon: {
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            borderRadius: 12,
        },
        fab: {
            position: 'absolute',
            bottom: 16,
            right: 16,
        },
        loadingFooter: {
            padding: 20,
            alignItems: 'center',
        },
        loadingContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20,
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
        retryButton: {
            marginTop: 16,
        },
    });

export default MediaSelectorScreen;