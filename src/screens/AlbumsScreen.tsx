import {initTranslate} from "../localization/translate";
import {ActivityIndicator, PaperProvider, SegmentedButtons,} from 'react-native-paper';
import React, {forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useState} from "react";
import {ThemeContext} from "../contexts/theme-context";
import {useDispatch} from "react-redux";
import {FlatList, StyleSheet, View} from "react-native";
import * as MediaLibrary from "expo-media-library";
import {Album} from "expo-media-library";
import AlbumItem from "../componants/items/AlbumItem";
import {RootStackParamList} from "./Main";
import {NativeStackScreenProps} from "@react-navigation/native-stack";
import {useScrollDirection} from "../hooks/useScrollDirection";
import {CastUtils} from "../DLNACast/utils/CastUtils";

export type AlbumsProps = NativeStackScreenProps<RootStackParamList, "Albums"> & {
    playerHeight: number;
    onScrollDirectionChange?: (isScrollingDown: boolean) => void;
};

/**
 * Ref interface for AlbumsScreen to expose loadMoreAssets method
 */
export interface AlbumsScreenRef {
    loadMoreAssets: () => Promise<void>;
}

const AlbumsScreen = forwardRef<AlbumsScreenRef, AlbumsProps>(({
                                                                   navigation,
                                                                   playerHeight,
                                                                   onScrollDirectionChange
                                                               }, ref) => {
    const i18n = initTranslate();
    const [appIsReady, setAppIsReady] = useState(false);
    const dispatch = useDispatch()
    const {theme} = useContext(ThemeContext);
    const [albums, setAlbums] = useState<Album[] | null>(null);
    const [mediaFilter, setMediaFilter] = useState<string>('all');
    const [albumMediaTypes, setAlbumMediaTypes] = useState<Record<string, Set<string>>>({});
    const [validAlbums, setValidAlbums] = useState<Set<string> | null>(null);

    // Media library permissions
    const [permissionResponse, requestPermission] = MediaLibrary.usePermissions();

    // Use the centralized scroll direction hook
    const {handleScroll, resetScroll} = useScrollDirection({
        onScrollDirectionChange,
        threshold: 15 // Slightly higher threshold for albums screen
    });

    /**
     * Fetch galleries/albums from MediaLibrary
     */
    const fetchGalleries = async () => {
        try {
            const albums = await MediaLibrary.getAlbumsAsync({
                includeSmartAlbums: true,
            });
            // Sort albums by number of media inside (descending)
            albums.sort((a, b) => a.assetCount > b.assetCount ? -1 : 1);
            return albums;
        } catch (error) {
            console.error('AlbumsScreen: Error fetching albums:', error);
            return [];
        }
    }

    /**
     * Get albums from device - handles permission request if needed
     */
    const getAlbums = async (): Promise<Album[]> => {
        if (permissionResponse?.status !== 'granted') {
            const newPermission = await requestPermission();
            if (newPermission.status === 'granted') {
                return await fetchGalleries();
            } else {
                return [];
            }
        }
        return await fetchGalleries();
    }

    /**
     * Checks if an asset is a supported castable media format
     */
    const isRealMedia = (asset: MediaLibrary.Asset): boolean => {
        return CastUtils.isSupportedExtension(asset.filename);
    };

    /**
     * Check which media types each album contains for filtering.
     * Also detects albums with only fake media (e.g. .ts source files).
     */
    const detectAlbumMediaTypes = useCallback(async (albumList: Album[]) => {
        const types: Record<string, Set<string>> = {};
        const validAlbumIds = new Set<string>();
        await Promise.all(albumList.map(async (album) => {
            const mediaTypes = new Set<string>();
            const checks = (['photo', 'video', 'audio'] as MediaLibrary.MediaTypeValue[]).map(async (type) => {
                const result = await MediaLibrary.getAssetsAsync({
                    album: album.id,
                    mediaType: type,
                    first: 10,
                });
                const realAssets = result.assets.filter(isRealMedia);
                if (realAssets.length > 0) {
                    mediaTypes.add(type);
                }
            });
            await Promise.all(checks);
            types[album.id] = mediaTypes;
            if (mediaTypes.size > 0) {
                validAlbumIds.add(album.id);
            }
        }));
        setAlbumMediaTypes(types);
        setValidAlbums(validAlbumIds);
    }, []);

    /**
     * Filtered albums based on the selected media type filter.
     * Also excludes albums that only contain fake media (e.g. .ts source files).
     */
    const filteredAlbums = useMemo(() => {
        if (!albums) return [];
        let result = albums;
        // Filter out albums with no real media (once detection is done)
        if (validAlbums) {
            result = result.filter((album) => validAlbums.has(album.id));
        }
        if (mediaFilter !== 'all') {
            result = result.filter((album) => {
                const types = albumMediaTypes[album.id];
                return types && types.has(mediaFilter);
            });
        }
        return result;
    }, [albums, mediaFilter, albumMediaTypes, validAlbums]);

    /**
     * Load more albums - placeholder implementation for autoplay compatibility
     * Albums screen doesn't need to load more data, but provides the interface
     */
    const loadMoreAssets = useCallback(async (): Promise<void> => {
        // Albums are loaded once, no pagination needed
        return Promise.resolve();
    }, []);

    // Expose loadMoreAssets method via ref for autoplay compatibility
    useImperativeHandle(ref, () => ({
        loadMoreAssets
    }), [loadMoreAssets]);

    // Initialize albums on component mount and when permissions change
    useEffect(() => {
        const initializeAlbums = async () => {
            if (permissionResponse?.status === 'granted') {
                const albums = await fetchGalleries();
                setAlbums(albums);
                setAppIsReady(true);
                resetScroll();
                detectAlbumMediaTypes(albums);
            } else if (permissionResponse?.status === 'denied') {
                // Permission denied, show empty state
                setAlbums([]);
                setAppIsReady(true);
            } else if (permissionResponse?.status === 'undetermined') {
                // Permission not yet requested, request it
                const albums = await getAlbums();
                setAlbums(albums);
                setAppIsReady(true);
                detectAlbumMediaTypes(albums);
            }
            // If permissionResponse is null, wait for it to be determined
        };

        // Only run when permissionResponse is available
        if (permissionResponse !== null) {
            initializeAlbums();
        }
    }, [permissionResponse?.status, resetScroll]);

    // Show loading indicator while initializing
    if (!appIsReady || permissionResponse === null) {
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
            <SegmentedButtons
                value={mediaFilter}
                onValueChange={setMediaFilter}
                buttons={[
                    {value: 'all', label: i18n.t('all')},
                    {value: 'photo', label: i18n.t('photos')},
                    {value: 'video', label: i18n.t('videos')},
                    {value: 'audio', label: i18n.t('audio')},
                ]}
                style={styles.segmentedButtons}
            />
            <FlatList
                data={filteredAlbums}
                numColumns={2}
                renderItem={({item}) => (
                    <AlbumItem album={item} initialMediaType={mediaFilter !== 'all' ? mediaFilter : undefined}/>
                )}
                keyExtractor={(item) => item.id}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                contentContainerStyle={[
                    styles.flatListContent,
                    {
                        paddingBottom: Math.max(20, playerHeight)
                    }
                ]}
                scrollIndicatorInsets={
                    playerHeight > 0 ? {bottom: playerHeight} : undefined
                }
            />
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    segmentedButtons: {
        marginHorizontal: 12,
        marginVertical: 8,
    },
    flatListContent: {}
});

AlbumsScreen.displayName = 'AlbumsScreen';

export default AlbumsScreen;