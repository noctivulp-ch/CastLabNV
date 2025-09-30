import {initTranslate} from "../localization/translate";
import {ActivityIndicator, PaperProvider,} from 'react-native-paper';
import React, {forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useState} from "react";
import {ThemeContext} from "../contexts/theme-context";
import {useDispatch} from "react-redux";
import {FlatList, StyleSheet, View} from "react-native";
import * as MediaLibrary from "expo-media-library";
import {Album} from "expo-media-library";
import AlbumItem from "../componants/items/AlbumItem";
import {RootStackParamList} from "./Main";
import {NativeStackScreenProps} from "@react-navigation/native-stack";
import {useScrollDirection} from "../hooks/useScrollDirection";

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
            } else if (permissionResponse?.status === 'denied') {
                // Permission denied, show empty state
                setAlbums([]);
                setAppIsReady(true);
            } else if (permissionResponse?.status === 'undetermined') {
                // Permission not yet requested, request it
                const albums = await getAlbums();
                setAlbums(albums);
                setAppIsReady(true);
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
            <FlatList
                data={albums}
                numColumns={2}
                renderItem={({item}) => (
                    <AlbumItem album={item}/>
                )}
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
            />
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    flatListContent: {}
});

AlbumsScreen.displayName = 'AlbumsScreen';

export default AlbumsScreen;