import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Dimensions, FlatList, Image, StyleSheet, TouchableOpacity, View,} from 'react-native';
import {
    Button,
    Checkbox,
    Chip,
    FAB,
    IconButton,
    Menu,
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

type RootStackParamList = {
    MediaSelector: {
        onSelectAssets: (assets: Asset[]) => void;
        excludeAssets?: Asset[];
        allowMultiple?: boolean;
    };
};

type MediaSelectorRouteProp = RouteProp<RootStackParamList, 'MediaSelector'>;

interface MediaSelectorScreenProps {
}

type MediaFilter = 'all' | 'photo' | 'video' | 'audio';

/**
 * Date range interface for filtering media
 */
interface DateRange {
    startDate: Date | undefined;
    endDate: Date | undefined;
}

const {width: screenWidth} = Dimensions.get('window');
const ITEM_SIZE = (screenWidth - 48) / 3; // 3 columns with padding

const MediaSelectorScreen: React.FC<MediaSelectorScreenProps> = () => {
    const theme = useTheme();
    const i18n = initTranslate();
    const navigation = useNavigation();
    const route = useRoute<MediaSelectorRouteProp>();
    const insets = useSafeAreaInsets();
    const {onSelectAssets, excludeAssets = [], allowMultiple = true} = route.params;

    // State management
    const [assets, setAssets] = useState<Asset[]>([]);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
    const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
    const [hasNextPage, setHasNextPage] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [endCursor, setEndCursor] = useState<string | undefined>(undefined); // Add cursor state

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

    // Excluded asset IDs for quick lookup
    const excludedIds = useMemo(() =>
            new Set(excludeAssets.map(asset => asset.id)),
        [excludeAssets]
    );

    /**
     * Update sorting criteria whenever individual sort options change
     */
    useEffect(() => {
        const sortBy: SortByValue[] = [];

        if (sortDuration) {
            sortBy.push(sortDuration);
        }
        if (sortHeight) {
            sortBy.push(sortHeight);
        }
        if (sortWidth) {
            sortBy.push(sortWidth);
        }
        if (sortModificationTimeAsc) {
            sortBy.push(sortModificationTimeAsc);
        }
        setSortBy(sortBy);
    }, [sortModificationTimeAsc, sortDuration, sortWidth, sortHeight]);

    /**
     * Load media library albums
     */
    const loadAlbums = useCallback(async () => {
        try {
            const {status} = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') {
                return;
            }

            const albumsData = await MediaLibrary.getAlbumsAsync({
                includeSmartAlbums: true,
            });
            setAlbums(albumsData);
        } catch (error) {
            console.error('Failed to load albums:', error);
        }
    }, []);

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
                setEndCursor(undefined); // Reset cursor
            } else {
                setLoadingMore(true);
            }

            // Use proper cursor instead of Asset object
            const options = buildAssetsOptions(reset ? undefined : endCursor);
            const assetsPage = await MediaLibrary.getAssetsAsync(options);

            if (reset) {
                setAssets(assetsPage.assets);
            } else {
                setAssets(prev => [...prev, ...assetsPage.assets]);
            }

            setHasNextPage(assetsPage.hasNextPage);
            setEndCursor(assetsPage.endCursor); // Save cursor for next pagination
        } catch (error) {
            console.error('Failed to load assets:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [buildAssetsOptions, endCursor]);

    /**
     * Toggle asset selection
     */
    const toggleAssetSelection = useCallback((asset: Asset) => {
        if (excludedIds.has(asset.id)) {
            return; // Cannot select excluded assets
        }

        setSelectedAssets(prev => {
            const isSelected = prev.some(selected => selected.id === asset.id);

            if (isSelected) {
                return prev.filter(selected => selected.id !== asset.id);
            } else {
                if (allowMultiple) {
                    return [...prev, asset];
                } else {
                    return [asset];
                }
            }
        });
    }, [excludedIds, allowMultiple]);

    /**
     * Handle media filter change
     */
    const handleFilterChange = useCallback((value: string) => {
        setMediaFilter(value as MediaFilter);
        setSelectedAssets([]);
    }, []);

    /**
     * Handle album selection
     */
    const handleAlbumChange = useCallback((album: Album | null) => {
        setSelectedAlbum(album);
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

        const formatDate = (date: Date) => date.toLocaleDateString();

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
        onSelectAssets(selectedAssets);
        navigation.goBack();
    }, [selectedAssets, onSelectAssets, navigation]);

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
     * Render asset item
     */
    const renderAssetItem = useCallback(({item}: { item: Asset }) => {
        const isSelected = selectedAssets.some(selected => selected.id === item.id);
        const isExcluded = excludedIds.has(item.id);
        const icon = getMediaIcon(item);

        return (
            <TouchableOpacity
                style={[
                    styles.assetItem,
                    isSelected && styles.selectedAssetItem,
                    isExcluded && styles.excludedAssetItem,
                ]}
                onPress={() => toggleAssetSelection(item)}
                disabled={isExcluded}
                activeOpacity={0.7}
            >
                <Image
                    source={{uri: item.uri}}
                    style={styles.assetImage}
                    resizeMode="cover"
                />

                {/* Media type overlay */}
                {icon && (
                    <View style={styles.mediaTypeOverlay}>
                        <IconButton
                            icon={icon}
                            size={20}
                            iconColor="white"
                        />
                    </View>
                )}

                {/* Duration overlay for videos */}
                {item.duration && item.mediaType === 'video' && (
                    <View style={styles.durationOverlay}>
                        <Text style={styles.durationText}>
                            {formatDuration(item.duration)}
                        </Text>
                    </View>
                )}

                {/* Selection indicator */}
                <View style={styles.selectionOverlay}>
                    {isExcluded ? (
                        <IconButton
                            icon="minus-circle"
                            size={24}
                            iconColor={theme.colors.error}
                            style={styles.excludedIcon}
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

    // Load initial data
    useEffect(() => {
        loadAlbums();
    }, [loadAlbums]);

    useEffect(() => {
        loadAssets(true);
    }, [mediaFilter, selectedAlbum, sortBy, dateRange]);

    return (
        <View style={styles.container}>
            {/* Title Header */}
            <Surface style={styles.titleContainer}>
                <Text variant="headlineSmall">
                    {i18n.t('select_media_title')}
                </Text>
                {selectedAssets.length > 0 && (
                    <Text variant="bodyMedium">
                        {i18n.t('selected_count', {count: selectedAssets.length})}
                    </Text>
                )}
            </Surface>

            {/* Breadcrumb */}
            <Surface style={styles.breadcrumbContainer}>
                <View style={styles.breadcrumb}>
                    <Text variant="bodySmall" style={styles.breadcrumbText}>
                        {selectedAlbum ? selectedAlbum.title : i18n.t('all_albums')}
                    </Text>
                    {getDateRangeDisplayText() && (
                        <>
                            <Text variant="bodySmall" style={styles.breadcrumbSeparator}> • </Text>
                            <Text variant="bodySmall" style={styles.breadcrumbText}>
                                {getDateRangeDisplayText()}
                            </Text>
                        </>
                    )}
                </View>
            </Surface>

            {/* Filter Controls Row 1: Media Type and Sort */}
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

                    {/* Clear date filter button - only show when filter is active */}
                    {(dateRange.startDate || dateRange.endDate) && (
                        <IconButton
                            icon="close"
                            mode="contained-tonal"
                            onPress={clearDateFilter}
                            size={20}
                        />
                    )}
                </View>

                {/* Album Selector */}
                {albums.length > 0 && (
                    <View style={styles.albumSelector}>
                        <FlatList
                            horizontal
                            data={[null, ...albums]}
                            keyExtractor={(item) => item?.id || 'all'}
                            renderItem={({item}) => (
                                <Chip
                                    mode={selectedAlbum?.id === item?.id ? 'flat' : 'outlined'}
                                    onPress={() => handleAlbumChange(item)}
                                    style={styles.albumChip}
                                >
                                    {item?.title || i18n.t('all_albums')}
                                </Chip>
                            )}
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.albumList}
                        />
                    </View>
                )}
            </View>

            {/* Assets count info */}
            <View style={styles.statusBar}>
                <Text variant="bodySmall" style={[styles.statusText, {color: theme.colors.onSurfaceVariant}]}>
                    {assets.length} {assets.length === 1 ? i18n.t('item') : i18n.t('items')}
                    {hasNextPage && ` (${i18n.t('more_available')})`}
                </Text>
                {loadingMore && (
                    <Text variant="bodySmall" style={[styles.loadingText, {color: theme.colors.primary}]}>
                        {i18n.t('loading')}...
                    </Text>
                )}
            </View>

            {/* Assets Grid */}
            <FlatList
                data={assets}
                renderItem={renderAssetItem}
                keyExtractor={(item) => item.id}
                numColumns={3}
                contentContainerStyle={styles.assetsGrid}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                    loadingMore ? (
                        <View style={styles.loadingFooter}>
                            <Text>{i18n.t('loading_more')}...</Text>
                        </View>
                    ) : null
                }
                showsVerticalScrollIndicator={false}
            />

            {/* Selection FAB */}
            {selectedAssets.length > 0 && (
                <FAB
                    icon="check"
                    style={[styles.fab, {bottom: Math.max(insets.bottom, 16) + 16}]}
                    onPress={handleConfirmSelection}
                    label={allowMultiple
                        ? i18n.t('add_selected', {count: selectedAssets.length})
                        : i18n.t('select')
                    }
                />
            )}

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
        breadcrumbContainer: {
            paddingHorizontal: 16,
            paddingVertical: 8,
        },
        breadcrumb: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        breadcrumbText: {
            color: theme.colors.onSurfaceVariant,
            fontStyle: 'italic',
        },
        breadcrumbSeparator: {
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
        albumSelector: {
            marginBottom: 8,
        },
        albumList: {
            paddingHorizontal: 4,
        },
        albumChip: {
            marginHorizontal: 4,
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
        excludedAssetItem: {
            opacity: 0.5,
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
        excludedIcon: {
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
    });

export default MediaSelectorScreen;