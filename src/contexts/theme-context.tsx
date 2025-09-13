import React, {createContext, useState} from 'react'
import {adaptNavigationTheme, MD3DarkTheme, MD3LightTheme} from "react-native-paper";
import {DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme} from "@react-navigation/native";
import merge from "deepmerge";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {SETTINGS_THEME} from "../constants/AsyncStorage";
import {Appearance} from "react-native";
import lightColors from "../theme/light.json";
import darkColors from "../theme/dark.json";

const {LightTheme, DarkTheme} = adaptNavigationTheme({
    reactNavigationLight: NavigationDefaultTheme,
    reactNavigationDark: NavigationDarkTheme,
});

const CombinedDefaultTheme = merge({...MD3LightTheme, colors: lightColors.colors}, {
    ...LightTheme, colors: {
        ...lightColors.colors,
        card: lightColors.colors.surfaceVariant,
        text: lightColors.colors.onBackground,
        notification: lightColors.colors.primary,
        border: lightColors.colors.secondary,
    }

});

const CombinedDarkTheme = merge({...MD3DarkTheme, colors: darkColors.colors}, {
    ...DarkTheme, colors: {
        ...darkColors.colors,
        card: darkColors.colors.surfaceVariant,
        text: darkColors.colors.onBackground,
        notification: darkColors.colors.primary,
        border: darkColors.colors.secondary,
    }
});


export const ThemeContext = createContext({
    theme: CombinedDefaultTheme,
    statusBarTheme: NavigationDefaultTheme,
    type: "auto",
    setTheme: (themeType: string) => {
    }
});


function ThemeContextProvider({children}: any) {
    const [theme, themeApply] = useState(CombinedDefaultTheme);
    const [statusBarTheme, setStatusBarTheme] = useState(NavigationDefaultTheme);
    const [type, setType] = useState("auto");
    const colorScheme = Appearance.getColorScheme();

    async function setTheme(themeType: string) {
        setType(themeType);
        if (themeType === "light") {
            themeApply(CombinedDefaultTheme);
            setStatusBarTheme(NavigationDefaultTheme);
        } else if (themeType === "dark") {
            themeApply(CombinedDarkTheme);
            setStatusBarTheme(NavigationDarkTheme);
        } else { //Auto
            if (colorScheme === "light") {
                themeApply(CombinedDefaultTheme);
                setStatusBarTheme(NavigationDefaultTheme);
            } else {
                themeApply(CombinedDarkTheme);
                setStatusBarTheme(NavigationDarkTheme);
            }
        }
        await AsyncStorage.setItem(SETTINGS_THEME, themeType);
    }

    return (
        <ThemeContext.Provider value={{theme, statusBarTheme, type, setTheme}}>{children}</ThemeContext.Provider>
    )
}

export default ThemeContextProvider;