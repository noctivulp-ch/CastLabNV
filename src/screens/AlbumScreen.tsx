import {initTranslate} from "../localization/translate";
import {ActivityIndicator, Button, IconButton, Menu, ProgressBar, Text} from 'react-native-paper';
import React, {forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useState} from "react";
import {ThemeContext} from "../contexts/theme-context";
import {useDispatch} from "react-redux";
import {FlatList, StyleSheet, View} from "react-native";
import * as MediaLibrary from "expo-media-library";
import {Asset, AssetsOptions, PagedInfo, SortBy, SortByValue} from "expo-media-library";
import {RootStackParamList} from "./Main";
import {NativeStackScreenProps} from "@react-navigation/native-stack";
import AssetItem from "../componants/items/AssetItem";
import {addToAssets, setAssets, setCurrentAsset} from "../store/slice/castSlice";
import {DatePickerModal} from 'react-native-paper-dates';
import {useScrollDirection} from "../hooks/useScrollDirection";

export type AlbumProps = NativeStackScreenProps<RootStackParamList, "Album"> & {
    playerHeight: number;
    onScrollDirectionChange?: (isScrollingDown: boolean) => void;
};

/**
 * Date range interface for filtering media
 */
interface DateRange {
    startDate: Date | undefined;
    endDate: Date | undefined;
}

/**
 * Ref interface for AlbumScreen to expose loadMoreAssets method
 */
export interface AlbumScreenRef {
    loadMoreAssets: () => Promise<void>;
}

const AlbumScreen = forwardRef<AlbumScreenRef, AlbumProps>(({route, playerHeight, onScrollDirectionChange}, ref) => {
    const i18n = initTranslate();

    // Extract navigation parameters
    const album = route.params?.album;
    const videoOnly = route.params?.videoOnly;

    // Component state management
    const [albumReady, setAlbumReady] = useState(false);
    const [loadMoreData, setLoadMoreData] = useState(false);
    const dispatch = useDispatch()
    const {theme} = useContext(ThemeContext);

    // Media filtering and sorting state
    // All media types for unfiltered view
    const allMediaTypes: MediaLibrary.MediaTypeValue[] = [
        MediaLibrary.MediaType.photo,
        MediaLibrary.MediaType.video,
        MediaLibrary.MediaType.audio
    ];
    const [type, setType] = useState<MediaLibrary.MediaTypeValue | MediaLibrary.MediaTypeValue[] | undefined>(
        videoOnly ? "video" : allMediaTypes
    );
    const [sortModificationTimeAsc, setSortModificationTimeAsc] = useState<SortByValue>([SortBy.modificationTime, false]);
    const [sortCreationTimeAsc, setSortCreationTimeAsc] = useState<SortByValue | undefined>(undefined);
    const [sortDuration, setSortDuration] = useState<SortByValue | undefined>(undefined);
    const [sortWidth, setSortWidth] = useState<SortByValue | undefined>(undefined);
    const [sortHeight, setSortHeight] = useState<SortByValue | undefined>(undefined);
    const [sortFilename, setSortFilename] = useState<boolean | undefined>(undefined);
    const [sortBy, setSortBy] = useState<SortByValue[]>([sortModificationTimeAsc]);

    // Date filtering state
    const [dateRange, setDateRange] = useState<DateRange>({
        startDate: undefined,
        endDate: undefined
    });
    const [datePickerOpen, setDatePickerOpen] = useState(false);

    // Media assets state
    const [asset, setAsset] = useState<Asset[]>([]);
    const [endCursor, setEndCursor] = useState<string>();
    const [hasMore, setHasMore] = useState(true);

    // UI state for menus and filters
    const [typeIcon, setTypeIcon] = useState<string>("select-all");
    const [typeText, setTypeText] = useState<string>(i18n.t('all_media'));
    const [typeMenuVisible, setTypeMenuVisible] = useState<boolean>(false);
    const [sortByMenuVisible, setSortByMenuVisible] = useState<boolean>(false);

    // Use the centralized scroll direction hook
    const {handleScroll, resetScroll} = useScrollDirection({
        onScrollDirectionChange,
        threshold: 10 // Standard threshold for asset screen
    });

    // Client-side sort by filename (not supported by expo-media-library)
    const sortedAssets = useMemo(() => {
        if (sortFilename === undefined) return asset;
        return [...asset].sort((a, b) => {
            const comparison = (a.filename || '').localeCompare(b.filename || '', undefined, {numeric: true});
            return sortFilename ? comparison : -comparison;
        });
    }, [asset, sortFilename]);

    /**
     * Load more media assets - used by autoplay when reaching end
     */
    const loadMoreAssets = useCallback(async (): Promise<void> => {
        if (loadMoreData || !hasMore) {
            return;
        }

        setLoadMoreData(true);

        try {
            const assetsPhotoOptions = buildAssetsOptions(endCursor);
            const assetsPhoto: PagedInfo<Asset> = await MediaLibrary.getAssetsAsync(assetsPhotoOptions);

            if (assetsPhoto.assets.length > 0) {
                const newAssets = [...asset, ...assetsPhoto.assets];
                setAsset(newAssets);

                // Update the Redux store with the complete asset list for autoplay
                dispatch(setAssets(newAssets));

                setEndCursor(assetsPhoto.endCursor);
                setHasMore(assetsPhoto.hasNextPage);

            } else {
                setHasMore(false);
            }
        } catch (error) {
            console.error('AlbumScreen: Failed to load more assets:', error);
            throw error; // Re-throw so autoplay can handle the error
        } finally {
            setLoadMoreData(false);
        }
    }, [loadMoreData, hasMore, endCursor, asset, dispatch]);

    // Expose loadMoreAssets method via ref for autoplay
    useImperativeHandle(ref, () => ({
        loadMoreAssets
    }), [loadMoreAssets]);

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
    }, [sortModificationTimeAsc, sortCreationTimeAsc, sortDuration, sortWidth, sortHeight]);

    /**
     * Build AssetsOptions with date filtering using createdAfter and createdBefore
     */
    const buildAssetsOptions = useCallback((afterCursor?: string): AssetsOptions => {
        const options: AssetsOptions = {
            album: album,
            mediaType: type,
            sortBy: sortBy,
            first: 50 // Load more items per batch for better autoplay performance
        };

        // Add date filtering using MediaLibrary API options
        if (dateRange.startDate) {
            options.createdAfter = dateRange.startDate.getTime();
        }

        if (dateRange.endDate) {
            // Set end date to end of day (23:59:59)
            const endOfDay = new Date(dateRange.endDate);
            endOfDay.setHours(23, 59, 59, 999);
            options.createdBefore = endOfDay.getTime();
        }

        // Add cursor for pagination
        if (afterCursor) {
            options.after = afterCursor;
        }

        return options;
    }, [album, type, sortBy, dateRange]);

    /**
     * Fetch initial assets when type, sorting, or date filter changes
     */
    useEffect(() => {
        (async () => {
            setHasMore(true);

            const assetsPhotoOptions = buildAssetsOptions();
            const assetsPhoto: PagedInfo<Asset> = await MediaLibrary.getAssetsAsync(assetsPhotoOptions);

            setAsset(assetsPhoto.assets);
            setEndCursor(assetsPhoto.endCursor);
            setHasMore(assetsPhoto.hasNextPage);
            setAlbumReady(true);

            // Update Redux store with initial assets for autoplay
            dispatch(setAssets(assetsPhoto.assets));

            resetScroll();
        })();
    }, [buildAssetsOptions, resetScroll, dispatch]);

    /**
     * Load more media assets when user reaches end of list (manual scrolling)
     */
    const fetchMoreMedia = useCallback(async () => {
        if (loadMoreData || !hasMore) {
            return;
        }

        await loadMoreAssets();
    }, [loadMoreAssets, loadMoreData, hasMore]);

    /**
     * Handle asset selection for casting
     */
    const assetPressed = useCallback(async (selectedAsset: Asset) => {

        // Set the current asset for casting
        dispatch(setCurrentAsset(selectedAsset));
        dispatch(addToAssets(selectedAsset));

        // Ensure we have a good buffer of assets loaded for autoplay
        if (asset.length < 30 && hasMore && !loadMoreData) {
            try {
                await loadMoreAssets();
            } catch (error) {
                console.warn('AlbumScreen: Failed to preload assets:', error);
                // Don't block the casting if preloading fails
            }
        }
    }, [dispatch, asset.length, hasMore, loadMoreData, loadMoreAssets]);

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
     * Get date range display text for the info line
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
     * Get trailing icon for duration sorting menu item
     */
    const getTrailingIconDuration = () => {
        if (!sortDuration) {
            return "";
        } else {
            return sortDuration[1] ? "arrow-up-thick" : "arrow-down-thick"
        }
    }

    /**
     * Get trailing icon for width sorting menu item
     */
    const getTrailingIconWidth = () => {
        if (!sortWidth) {
            return "";
        } else {
            return sortWidth[1] ? "arrow-up-thick" : "arrow-down-thick"
        }
    }

    /**
     * Get trailing icon for height sorting menu item
     */
    const getTrailingIconHeight = () => {
        if (!sortHeight) {
            return "";
        } else {
            return sortHeight[1] ? "arrow-up-thick" : "arrow-down-thick"
        }
    }

    /**
     * Get trailing icon for filename sorting menu item
     */
    const getTrailingIconFilename = () => {
        if (sortFilename === undefined) {
            return "";
        } else {
            return sortFilename ? "arrow-up-thick" : "arrow-down-thick"
        }
    }

    // Show loading indicator while fetching initial data
    if (!albumReady) {
        return (
            <View style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                zIndex: 20,
                backgroundColor: theme.colors.background
            }}>
                <ActivityIndicator size="large"/>
                <Text style={{marginTop: 16, color: theme.colors.onSurface}}>
                    {i18n.t('loading_media_assets')}
                </Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            {/* Filter and sort controls */}
            <View style={styles.topButtons}>
                {/* Media type filter menu */}
                <Menu
                    visible={typeMenuVisible}
                    anchorPosition={"bottom"}
                    mode={"elevated"}
                    onDismiss={() => setTypeMenuVisible(false)}
                    anchor={
                        <Button
                            icon={typeIcon}
                            mode="contained-tonal"
                            onPress={() => setTypeMenuVisible(true)}
                        >
                            {typeText}
                        </Button>
                    }
                >
                    <Menu.Item onPress={() => {
                        setTypeMenuVisible(false);
                        setTypeIcon("select-all");
                        setTypeText(i18n.t('all_media'));
                        setType(videoOnly ? "video" : allMediaTypes);
                    }} title={i18n.t('all_media')} leadingIcon="select-all"/>

                    <Menu.Item onPress={() => {
                        setTypeMenuVisible(false);
                        setTypeIcon("image");
                        setTypeText(i18n.t('pictures'));
                        setType("photo");
                    }} title={i18n.t('pictures')} leadingIcon="image"/>

                    <Menu.Item onPress={() => {
                        setTypeMenuVisible(false);
                        setTypeIcon("video");
                        setTypeText(i18n.t('videos'));
                        setType("video");
                    }} title={i18n.t('videos')} leadingIcon="video"/>

                    <Menu.Item onPress={() => {
                        setTypeMenuVisible(false);
                        setTypeIcon("music");
                        setTypeText(i18n.t('audios'));
                        setType("audio");
                    }} title={i18n.t('audios')} leadingIcon="music"/>
                </Menu>

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
                        setSortFilename(sortFilename === undefined ? true : !sortFilename);
                    }} title={i18n.t('filename')} trailingIcon={getTrailingIconFilename()}/>

                    <Menu.Item onPress={() => {
                        setSortDuration(undefined);
                        setSortWidth(undefined);
                        setSortHeight(undefined);
                        setSortFilename(undefined);
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

            {/* Date range info line - only show when filter is active */}
            {getDateRangeDisplayText() && (
                <View style={styles.dateRangeInfo}>
                    <Text variant="bodySmall" style={[styles.dateRangeText, {color: theme.colors.onSurfaceVariant}]}>
                        {getDateRangeDisplayText()}
                    </Text>
                </View>
            )}

            {/* Assets count and loading indicator */}
            <View style={styles.statusBar}>
                <Text variant="bodySmall" style={[styles.statusText, {color: theme.colors.onSurfaceVariant}]}>
                    {sortedAssets.length} {sortedAssets.length === 1 ? i18n.t('item') : i18n.t('items')}
                    {hasMore && ` (${i18n.t('more_available')})`}
                </Text>
                {loadMoreData && (
                    <Text variant="bodySmall" style={[styles.loadingText, {color: theme.colors.primary}]}>
                        {i18n.t('loading')}...
                    </Text>
                )}
            </View>

            {/* Asset list with dynamic padding for PlayerController */}
            <FlatList
                data={sortedAssets}
                renderItem={({item}) => (
                    <AssetItem asset={item} onPressed={assetPressed.bind(this, item)}/>
                )}
                style={styles.flastList}
                onEndReachedThreshold={0.3} // Load more when 30% from bottom
                onEndReached={fetchMoreMedia}
                keyExtractor={(item) => item.id}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                contentContainerStyle={[
                    styles.flatListContent,
                    {
                        // Dynamic padding based on actual PlayerController height
                        paddingBottom: Math.max(20, playerHeight)
                    }
                ]}
                // Adjust scroll indicators to account for player height
                scrollIndicatorInsets={
                    playerHeight > 0 ? {bottom: playerHeight} : undefined
                }
                // Performance optimizations for large lists
                removeClippedSubviews={true}
                initialNumToRender={20}
                maxToRenderPerBatch={10}
                windowSize={10}
                getItemLayout={undefined} // Let FlatList calculate for AssetItem
            />

            {/* Loading progress bar */}
            <ProgressBar
                indeterminate={true}
                color={theme.colors.primary}
                visible={loadMoreData}
                style={styles.progressBar}
            />

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
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topButtons: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 10,
        marginHorizontal: 16,
        flexWrap: "wrap",
        gap: 8,
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
    flastList: {
        flex: 1,
        marginTop: 8,
    },
    flatListContent: {
        paddingHorizontal: 8,
    },
    dateFilterButton: {
        flex: 1,
        minWidth: 120,
    },
    dateRangeInfo: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        alignItems: "center",
    },
    dateRangeText: {
        fontStyle: "italic",
    },
    progressBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
});

AlbumScreen.displayName = 'AlbumScreen';

export default AlbumScreen;