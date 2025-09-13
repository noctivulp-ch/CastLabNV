import React, {useEffect} from "react";
import {Pressable, StyleSheet} from "react-native";
import {Card} from "react-native-paper";
import * as MediaLibrary from "expo-media-library";
import {Album, Asset, SortBy} from "expo-media-library";
import {initTranslate} from "../../localization/translate";
import {NavigationProp, useNavigation} from "@react-navigation/native";
import {RootStackParamList} from "../../screens/Main";


export type AlbumItemProps = {
    album: Album,
};

const AlbumItem: React.FC<AlbumItemProps> = ({album}) => {
    const [firstAsset, setFirstAsset] = React.useState<Asset | null>(null);
    const i18n = initTranslate();
    const navigation: NavigationProp<RootStackParamList> = useNavigation();
    const [videoOnly, setVideoOnly] = React.useState(false);
    useEffect(() => {
        const init = async () => {
            const pagedInfo = await MediaLibrary.getAssetsAsync({
                album: album.id,
                first: 1,
                sortBy: [[SortBy.modificationTime, false]]
            });

            if (pagedInfo?.assets.length > 0) {
                const firstAsset: Asset = pagedInfo?.assets[0];
                setFirstAsset(firstAsset);
            } else { //Video albums return empty when mediaType is not set to "video"
                const pagedInfo = await MediaLibrary.getAssetsAsync({
                    album: album.id,
                    first: 1,
                    mediaType: "video",
                    sortBy: [[SortBy.modificationTime, false]]
                });
                if (pagedInfo?.assets.length > 0) {
                    const firstAsset: Asset = pagedInfo?.assets[0];
                    setFirstAsset(firstAsset);
                    setVideoOnly(true);
                }
            }
        };

        init();
    }, []);

    return (
        <Pressable onPress={() => {
            navigation.navigate('Album', {
                album: album,
                videoOnly: videoOnly,
            });
        }}
                   style={({pressed}) => [pressed && styles.pressed, styles.container]}>
            <Card style={styles.card} mode={"elevated"}>
                <Card.Title title={album.title} subtitle={i18n.t('assets_count', {number: album.assetCount})}/>
                <Card.Cover style={styles.cover} source={{uri: firstAsset?.uri}}/>
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