import React from "react";
import {GestureResponderEvent, Image, Pressable, StyleSheet} from "react-native";
import {Icon, Text} from "react-native-paper";
import {Device} from "../../DLNACast/types/Device";

export type AssetItemProps = {
    device: Device,
    onPressed: (gestureResponderEvent: GestureResponderEvent, device: Device) => void,
};

const DeviceItem: React.FC<AssetItemProps> = ({device, onPressed}) => {
    const [iconError, setIconError] = React.useState(false);
    const showImage = device.iconUrl && !iconError;

    return (
        <Pressable onPress={(event) => {
            onPressed(event, device);
        }}
                   style={({pressed}) => [pressed && styles.pressed, styles.container]}>
            {showImage &&
                <Image width={24} height={24} source={{uri: device.iconUrl}} onError={() => setIconError(true)}/>
            }
            {!showImage &&
                <Icon size={24}
                      source={device.protocol === 'fcast' ? 'cast-variant'
                          : device.protocol === 'external-display' ? 'monitor'
                          : 'television'}/>
            }
            <Text style={styles.text}>{device.name}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: "row",
        width: "100%",
        alignItems: "center",
        marginBottom: 30,
    },
    text: {
        marginStart: 10,
        fontSize: 20
    },
    pressed: {
        opacity: 0.75,
    },
});

export default DeviceItem;