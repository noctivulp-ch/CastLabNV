import React, {useContext} from "react";
import {GestureResponderEvent, Image, Pressable, StyleSheet, View} from "react-native";
import {Divider, Icon, Text} from "react-native-paper";
import {Asset} from "expo-media-library";
import {ThemeContext} from "../../contexts/theme-context";


export type AssetItemProps = {
    asset: Asset,
    onPressed: (event: GestureResponderEvent) => void,
};

const AssetItem: React.FC<AssetItemProps> = ({asset, onPressed}) => {
    const {theme} = useContext(ThemeContext);
    const isAudio = asset.mediaType === 'audio';

    const getThumbnail = () => {
        if (isAudio) {
            return <View style={[styles.imageContainer, styles.audioPlaceholder, {backgroundColor: theme.colors.surfaceVariant}]}>
                <Icon source="music-note" size={36} color={theme.colors.onSurfaceVariant}/>
            </View>;
        }
        if (asset?.uri) {
            return <View style={styles.imageContainer}><Image source={{uri: asset.uri}}
                                                              style={styles.image}/></View>;
        }
        return <View style={styles.imageContainer}><Icon source="folder-multiple-image" size={48}/></View>;
    }

    const getDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString();
    }

    const getDetails = () => {
        if (isAudio) {
            return asset.duration > 0 ? `${Math.round(asset.duration)}s` : '';
        }
        return `${asset.width} x ${asset.height}${asset.duration > 0 ? ` - ${Math.round(asset.duration)}s` : ''}`;
    }

    return (
        <Pressable onPress={onPressed}
                   style={({pressed}) => [pressed && styles.pressed, styles.container]}>
            <View style={styles.item}>
                {getThumbnail()}
                <View style={styles.textContainer}>
                    <Text style={styles.textFirstLine}>{asset.filename}</Text>
                    <Text style={styles.textSecondLine}>{getDetails()}</Text>
                    <Text style={styles.textSecondLine}>{getDate(asset.modificationTime.valueOf())}</Text>
                </View>
            </View>
            <Divider/>
        </Pressable>
    )

}
const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: "column",
        marginBottom: 5,
    },
    item: {
        flex: 1,
        flexDirection: "row",

    },
    imageContainer: {
        height: 100,
        width: 100,
        alignItems: "center",
        justifyContent: "center",
    },
    textContainer: {
        flexDirection: "column",
        marginStart: 10,
    },
    pressed: {
        opacity: 0.75,
    },
    textFirstLine: {
        fontSize: 16,
        fontWeight: "bold",
    },
    textSecondLine: {
        marginTop: 5,
    },
    image: {
        width: "100%",
        height: "100%",
    },
    audioPlaceholder: {
        borderRadius: 8,
    },
});
export default AssetItem;