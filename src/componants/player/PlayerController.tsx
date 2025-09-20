import * as React from 'react';
import {useContext, useEffect} from 'react';
import {Card, IconButton, Portal, Text} from 'react-native-paper';
import {initTranslate} from "../../localization/translate";
import {Image, StyleSheet, View} from "react-native";
import {ThemeContext} from "../../contexts/theme-context";
import {useSelector} from "react-redux";
import {IRootState} from "../../screens/Main";
import {Asset} from "expo-media-library";
import Slider from "@react-native-community/slider";
import {useCastManager} from "../../contexts/castManager-context";
import {Device} from "../../DLNACast/types/Device";


interface PlayerControllerProps {
    visible: boolean,
    connectedDevice: Device | null
}


const PlayerController: React.FC<PlayerControllerProps> = ({visible, connectedDevice}) => {
    const {theme} = useContext(ThemeContext);
    const i18n = initTranslate();
    const cast = useSelector((state: IRootState) => state.cast);
    const [asset, setAsset] = React.useState<Asset | null>(null);
    const styles = useStyles(theme);
    const {castManager, progress, playbackState, setProgress} = useCastManager();
    const [playIcon, setPlayIcon] = React.useState("play");

    useEffect(() => {
        setAsset(cast.currentAsset);
    }, [cast.currentAsset]);

    const handleSeekTo = (value: number) => {
        castManager.seek(value);
        setProgress(value);
    };

    useEffect(() => {
        if (playbackState?.isPlaying) {
            setPlayIcon("pause");
        } else {
            setPlayIcon("play");
        }
    }, [playbackState]);

    const handleSeekAdd = (value: number) => {
        if (playbackState) {
            let newPosition = playbackState.position + value;
            if (newPosition < 0) {
                newPosition = 0;
            }
            if (newPosition > playbackState.duration) {
                newPosition = playbackState.duration;
            }
            castManager.seek(newPosition);
            setProgress(newPosition);
        }
    };

    const handlePlayPause = () => {
        if (playbackState?.isPlaying) {
            castManager.pause();
        } else {
            castManager.play();
        }
    };
    return (

        <Portal>
            {visible &&
                <View style={styles.container}>
                    <Card style={styles.card}>
                        {connectedDevice &&
                            <View style={styles.titleContainer}>
                                <View style={styles.title}>
                                    <Text style={styles.titleTop}>{connectedDevice.name}</Text>
                                    {asset?.filename && <Text style={styles.titleBottom}>{asset?.filename}</Text>}
                                </View>
                                <Image source={{uri: asset?.uri}} width={80}/>
                            </View>
                        }
                        {asset &&
                            <View style={{flexDirection: "column"}}>
                                <Slider
                                    thumbTintColor={theme.colors.primary}
                                    maximumTrackTintColor={theme.colors.primary}
                                    minimumTrackTintColor={theme.colors.primary}
                                    style={styles.progress}
                                    value={progress}
                                    onValueChange={(newValue) => handleSeekTo.bind(this, newValue)}
                                    maximumValue={playbackState?.duration}
                                    step={1}
                                />
                                <View style={styles.controller}>
                                    <IconButton
                                        icon="skip-backward"
                                        size={24}
                                        onPress={() => handleSeekTo(0)}
                                    />
                                    <IconButton
                                        icon="skip-previous"
                                        size={24}
                                        onPress={() => handleSeekAdd(-5)}

                                    />
                                    <IconButton
                                        icon={playIcon}
                                        size={48}
                                        onPress={handlePlayPause}
                                    />
                                    <IconButton
                                        icon="skip-next"
                                        size={24}
                                        onPress={() => handleSeekAdd(5)}
                                    />
                                    <IconButton
                                        icon="skip-forward"
                                        size={24}
                                        onPress={() => {
                                        }}
                                    />
                                </View>
                            </View>
                        }
                        {!asset &&
                            <Text style={styles.description}>{i18n.t('select_media')}</Text>
                        }
                    </Card>
                </View>
            }
        </Portal>
    );
};
const useStyles = (theme: any) => (StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'column',
        position: 'absolute',
        width: '100%',
        bottom: 50,
        backgroundColor: "transparent",
    },
    card: {
        flexDirection: 'column',
        marginHorizontal: 10
    },
    titleContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginHorizontal: 10,
        marginTop: 10
    },
    description: {
        flexDirection: 'row',
        fontSize: 16,
        margin: 10,
        justifyContent: 'center',
        alignItems: 'center'
    },
    title: {
        flexDirection: 'column',
    },
    titleTop: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    titleBottom: {
        marginTop: 5
    },
    image: {
        width: "100%",
    },
    progress: {
        marginTop: 10
    },
    controller: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",

    },
    slider: {
        width: "100%",
        height: 50,

    }
}));
export default PlayerController;