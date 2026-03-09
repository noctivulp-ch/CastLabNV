import React, {useContext, useEffect} from "react";
import {Pressable, StyleSheet, View} from "react-native";
import {Card, Icon} from "react-native-paper";
import * as MediaLibrary from "expo-media-library";
import {Album, Asset, SortBy} from "expo-media-library";
import {initTranslate} from "../../localization/translate";
import {NavigationProp, useNavigation} from "@react-navigation/native";
import {RootStackParamList} from "../../screens/Main";
import {ThemeContext} from "../../contexts/theme-context";


export type AlbumItemProps = {
    album: Album,
    initialMediaType?: string,
};

const AlbumItem: React.FC<AlbumItemProps> = ({album, initialMediaType}) => {
    const [firstAsset, setFirstAsset] = React.useState<Asset | null>(null);
    const [isAudioOnly, setIsAudioOnly] = React.useState(false);
    const i18n = initTranslate();
    const navigation: NavigationProp<RootStackParamList> = useNavigation();
    const [videoOnly, setVideoOnly] = React.useState(false);
    const {theme} = useContext(ThemeContext);

    useEffect(() => {
        const init = async () => {
            // Use the media type filter when fetching the cover asset
            const mediaType = initialMediaType as MediaLibrary.MediaTypeValue | undefined;

            const pagedInfo = await MediaLibrary.getAssetsAsync({
                album: album.id,
                first: 1,
                mediaType: mediaType || undefined,
                sortBy: [[SortBy.modificationTime, false]]
            });

            if (pagedInfo?.assets.length > 0) {
                const asset: Asset = pagedInfo.assets[0];
                setFirstAsset(asset);
                setIsAudioOnly(asset.mediaType === 'audio');
            } else {
                // Video albums return empty when mediaType is not set to "video"
                const pagedInfo = await MediaLibrary.getAssetsAsync({
                    album: album.id,
                    first: 1,
                    mediaType: mediaType || "video",
                    sortBy: [[SortBy.modificationTime, false]]
                });
                if (pagedInfo?.assets.length > 0) {
                    const asset: Asset = pagedInfo.assets[0];
                    setFirstAsset(asset);
                    setIsAudioOnly(asset.mediaType === 'audio');
                    if (!mediaType) setVideoOnly(true);
                }
            }
        };

        init();
    }, [initialMediaType]);

    return (
        <Pressable onPress={() => {
            navigation.navigate('Album', {
                album: album,
                videoOnly: videoOnly,
                initialMediaType: initialMediaType,
            });
        }}
                   style={({pressed}) => [pressed && styles.pressed, styles.container]}>
            <Card style={styles.card} mode={"elevated"}>
                <Card.Title title={album.title} subtitle={i18n.t('assets_count', {number: album.assetCount})}/>
                {isAudioOnly ? (
                    <View style={[styles.audioPlaceholder, {backgroundColor: theme.colors.surfaceVariant}]}>
                        <Icon size={48} source={"music-note"} color={theme.colors.onSurfaceVariant}/>
                    </View>
                ) : (
                    <Card.Cover style={styles.cover} source={{uri: firstAsset?.uri}}/>
                )}
            </Card>
        </Pressable>
    )

}
const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: "column",
        margin: 5
    },
    card: {
        flex: 1,
        width: "100%",
    },
    title: {
        fontSize: 18,
        alignItems: "center",
    },
    cover: {
        margin: 2,
    },
    audioPlaceholder: {
        margin: 2,
        height: 195,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    imageContainer: {
        height: 200,
        width: 200,
        alignItems: "center",
        justifyContent: "center",
    },
    image: {
        width: "100%",
        height: "100%",
    },
    pressed: {
        opacity: 0.75,
    },
});
export default AlbumItem;