import {createSlice} from "@reduxjs/toolkit";
import {Asset} from "expo-media-library";

type Cast = {
    currentAsset: Asset | null,
    assets: Asset[],
};

const initialState: Cast = {
    currentAsset: null,
    assets: [],
};

export const castSlice = createSlice({
    name: "cast",
    initialState,
    reducers: {
        setCurrentAsset(state, action) {
            state.currentAsset = action.payload;
        },
        setAssets(state, action) {
            state.assets = action.payload;
        },
        addToAssets(state, action) {
            if ((action.payload as Asset).id) {
                const present = action.payload.find((asset: Asset) => asset.id === (action.payload as Asset).id) !== undefined;
                if (!present) {
                    state.assets = [...state.assets, action.payload];
                }
            } else if ([action.payload as Asset[]].length > 0) {
                state.assets = [...state.assets, ...action.payload];
            }
        },
        removeFromAsset(state, action) {
            if ((action.payload as Asset).id) {
                state.assets = state.assets.filter((asset: Asset) => asset.id !== (action.payload as Asset).id);
            } else if ([action.payload as Asset[]].length > 0) {
                state.assets = state.assets.filter(asset => !action.payload.some((_asset: Asset) => asset.id == _asset.id));
            }
        }
    }
});

export const {
    setCurrentAsset,
    setAssets,
    addToAssets,
    removeFromAsset,
} = castSlice.actions;

export default castSlice.reducer;