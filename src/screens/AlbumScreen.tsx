import {initTranslate} from "../localization/translate";
import {ActivityIndicator, Button, Menu, ProgressBar,} from 'react-native-paper';
import React, {useCallback, useContext, useEffect, useState} from "react";
import {ThemeContext} from "../contexts/theme-context";
import {useDispatch} from "react-redux";
import {FlatList, StyleSheet, View} from "react-native";
import * as MediaLibrary from "expo-media-library";
import {Asset, AssetsOptions, PagedInfo, SortBy, SortByValue} from "expo-media-library";
import {RootStackParamList} from "./Main";
import {NativeStackScreenProps} from "@react-navigation/native-stack";
import AssetItem from "../componants/items/AssetItem";
import {addToAssets, setCurrentAsset} from "../store/slice/castSlice";

export type AlbumProps = NativeStackScreenProps<RootStackParamList, "Album">;

const MainScreen: React.FC<AlbumProps> = ({route}) => {

    const i18n = initTranslate();
    const album = route.params?.album;
    const videoOnly = route.params?.videoOnly;
    const [albumReady, setAlbumReady] = useState(false);
    const [loadMoreData, setLoadMoreData] = useState(false);
    const dispatch = useDispatch()
    const {theme} = useContext(ThemeContext);
    const [type, setType] = useState<MediaLibrary.MediaTypeValue | MediaLibrary.MediaTypeValue[] | undefined>(videoOnly ? "video" : undefined);
    const [sortModificationTimeAsc, setSortModificationTimeAsc] = useState<SortByValue>([SortBy.modificationTime, false]);
    const [sortCreationTimeAsc, setSortCreationTimeAsc] = useState<SortByValue | undefined>(undefined);
    const [sortDuration, setSortDuration] = useState<SortByValue | undefined>(undefined);
    const [sortWidth, setSortWidth] = useState<SortByValue | undefined>(undefined);
    const [sortHeight, setSortHeight] = useState<SortByValue | undefined>(undefined);
    const [sortBy, setSortBy] = useState<SortByValue[]>([sortModificationTimeAsc]);

    const [asset, setAsset] = useState<Asset[]>([]);
    const [endCursor, setEndCursor] = useState<string>();
    const [typeIcon, setTypeIcon] = useState<string>("select-all");
    const [typeText, setTypeText] = useState<string>(i18n.t('all_media'));
    const [typeMenuVisible, setTypeMenuVisible] = useState<boolean>(false);
    const [sortByMenuVisible, setSortByMenuVisible] = useState<boolean>(false);

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

    useEffect(() => {
        (async () => {
            const assetsPhotoOptions: AssetsOptions = {
                album: album,
                mediaType: type,
                sortBy: sortBy
            };
            const assetsPhoto: PagedInfo<Asset> = await MediaLibrary.getAssetsAsync(assetsPhotoOptions);

            setAsset(assetsPhoto.assets);
            setEndCursor(assetsPhoto.endCursor);
            setAlbumReady(true);
        })();
    }, [type, sortBy]);

    const fetchMoreMedia = useCallback(async () => {
        if (loadMoreData) {
            return;
        }
        setLoadMoreData(true);
        const assetsPhotoOptions: AssetsOptions = {
            album: album,
            mediaType: type,
            after: endCursor,
            sortBy: sortBy
        };
        const assetsPhoto: PagedInfo<Asset> = await MediaLibrary.getAssetsAsync(assetsPhotoOptions);
        const newAsset = [...asset, ...assetsPhoto.assets];
        setAsset(newAsset);
        setEndCursor(assetsPhoto.endCursor);
        setLoadMoreData(false);
    }, [loadMoreData, album, type, endCursor, asset, sortBy]);

    const assetPressed = useCallback(async (asset: Asset) => {
        dispatch(setCurrentAsset(asset));
        dispatch(addToAssets(asset));
    }, [dispatch]);


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
            </View>
        )
    }

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

    return (
        <View style={styles.container}>

            <View style={styles.topButtons}>
                <Menu
                    visible={typeMenuVisible}
                    anchorPosition={"bottom"}
                    mode={"elevated"}
                    onDismiss={() => setTypeMenuVisible(false)}
                    anchor={<Button icon={typeIcon} mode="contained-tonal" onPress={() => setTypeMenuVisible(true)}>
                        {typeText}
                    </Button>}>
                    <Menu.Item onPress={() => {
                        setTypeMenuVisible(false);
                        setTypeIcon("select-all");
                        setTypeText(i18n.t('all_media'));
                        setType(videoOnly ? "video" : undefined);
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


                <Menu
                    visible={sortByMenuVisible}
                    anchorPosition={"bottom"}
                    mode={"elevated"}
                    onDismiss={() => setSortByMenuVisible(false)}
                    anchor={<Button icon={"sort"} mode="contained-tonal" onPress={() => setSortByMenuVisible(true)}>
                        {i18n.t('sort')}
                    </Button>}>
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
            </View>
            <FlatList data={asset}
                      renderItem={({item}) => (
                          <AssetItem asset={item} onPressed={assetPressed.bind(this, item)}/>
                      )}
                      style={styles.flastList}
                      onEndReachedThreshold={0.1}
                      onEndReached={fetchMoreMedia}
                      keyExtractor={(item) => item.id}/>
            <ProgressBar indeterminate={true} color={theme.colors.primary} visible={loadMoreData}/>
        </View>
    );

}
const styles = StyleSheet.create({
    container: {
        flex: 1,

    },
    topButtons: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 10,
    },
    flastList: {
        marginTop: 20,
    }
});
export default MainScreen;