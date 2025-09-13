import React from "react";
import {GestureResponderEvent, Pressable, StyleSheet} from "react-native";
import {Icon, Text} from "react-native-paper";
import {Device} from "../../DLNACast/types/Device";

export type AssetItemProps = {
    device: Device,
    onPressed: (gestureResponderEvent: GestureResponderEvent, device: Device) => void,
};

const DeviceItem: React.FC<AssetItemProps> = ({device, onPressed}) => {

    return (
        <Pressable onPress={(event) => {
            onPressed(event, device);
        }}
                   style={({pressed}) => [pressed && styles.pressed, styles.container]}>
            <Icon size={24}
                  source={"television"}/><Text
            style={styles.text}>{device.name}</Text>
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