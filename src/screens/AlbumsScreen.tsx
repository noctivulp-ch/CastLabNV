import {initTranslate} from "../localization/translate";
import {ActivityIndicator, PaperProvider,} from 'react-native-paper';
import React, {useContext, useEffect, useState} from "react";
import {ThemeContext} from "../contexts/theme-context";
import {useDispatch} from "react-redux";
import {FlatList, StyleSheet, View} from "react-native";
import * as MediaLibrary from "expo-media-library";
import {Album} from "expo-media-library";
import AlbumItem from "../componants/items/AlbumItem";
import {RootStackParamList} from "./Main";
import {NativeStackScreenProps} from "@react-navigation/native-stack";

// Props type including the playerHeight from navigation params
export type AlbumsProps = NativeStackScreenProps<RootStackParamList, "Albums"> & {
    playerHeight: number;
};

const AlbumsScreen: React.FC<AlbumsProps> = ({navigation, playerHeight}) => {
    const i18n = initTranslate();
    const [appIsReady, setAppIsReady] = useState(false);
    const dispatch = useDispatch()
    const {theme} = useContext(ThemeContext);
    const [albums, setAlbums] = useState<Album[] | null>(null);

    // Media library permissions
    const [permissionResponse, requestPermission] = MediaLibrary.usePermissions();

    /**
     * Get albums from device - handles permission request if needed
     */
    const getAlbums: () => Promise<Album[]> = async () => {
        if (permissionResponse?.status !== 'granted') {
            requestPermission().then(permissionResponse => {
                if (permissionResponse.status === 'granted') {
                    return fetchGalleries();
                }
                return [];
            });
        }
        return fetchGalleries();
    }

    /**
     * Fetch galleries/albums from MediaLibrary
     */
    const fetchGalleries = async () => {
        const albums = await MediaLibrary.getAlbumsAsync({
            includeSmartAlbums: true,
        });
        // Sort albums by number of media inside (descending)
        albums.sort((a, b) => a.assetCount > b.assetCount ? -1 : 1);
        return albums;
    }

    // Initialize albums on component mount
    useEffect(() => {
        (async () => {
            const albums = await getAlbums();
            setAlbums(albums);
            setAppIsReady(true);
        })();
    }, []);

    // Show loading indicator while initializing
    if (!appIsReady) {
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
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    flatListContent: {}
});

export default AlbumsScreen;