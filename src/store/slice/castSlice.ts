import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import {Asset} from 'expo-media-library';
import PlayList from '../../entities/PlayList';

type Cast = {
    currentAsset: Asset | null;
    assets: Asset[];
    currentIndex: number;
    autoplay: {
        enabled: boolean;
        delaySeconds: number; // Delay for images (default: 5 seconds)
        onMediaEnd: boolean;  // Auto-advance when video/audio ends
    };
    // Playlist support
    currentPlaylist: PlayList | null;
    isPlaylistMode: boolean;
};

const initialState: Cast = {
    currentAsset: null,
    assets: [],
    currentIndex: -1,
    autoplay: {
        enabled: false,
        delaySeconds: 5,
        onMediaEnd: true,
    },
    currentPlaylist: null,
    isPlaylistMode: false,
};

export const castSlice = createSlice({
    name: "cast",
    initialState,
    reducers: {
        /**
         * Set the current playing asset and update the current index
         */
        setCurrentAsset(state, action: PayloadAction<Asset | null>) {
            state.currentAsset = action.payload;

            if (action.payload === null) {
                // Clear current asset
                state.currentIndex = -1;
                return;
            }

            // Find the index of this asset in the assets array
            const assetIndex = state.assets.findIndex(asset => asset.id === action.payload?.id);
            if (assetIndex !== -1) {
                state.currentIndex = assetIndex;
            } else {
                // If asset is not in the playlist, add it and set as current
                state.assets.push(action.payload);
                state.currentIndex = state.assets.length - 1;
            }
        },

        /**
         * Replace the entire assets array
         */
        setAssets(state, action: PayloadAction<Asset[]>) {
            state.assets = action.payload;

            // Update current index if current asset is in the new array
            if (state.currentAsset) {
                const currentIndex = action.payload.findIndex(
                    asset => asset.id === state.currentAsset!.id
                );
                state.currentIndex = currentIndex !== -1 ? currentIndex : -1;
            } else {
                state.currentIndex = -1;
            }
        },

        /**
         * Add assets to the playlist
         */
        addToAssets(state, action: PayloadAction<Asset | Asset[]>) {
            const payload = action.payload;

            if (Array.isArray(payload)) {
                // Handle array of assets
                if (payload.length > 0) {
                    const newAssets = payload.filter(newAsset =>
                        !state.assets.some(existingAsset => existingAsset.id === newAsset.id)
                    );
                    state.assets = [...state.assets, ...newAssets];
                }
            } else {
                // Handle single asset
                if (payload.id) {
                    const present = state.assets.some(asset => asset.id === payload.id);
                    if (!present) {
                        state.assets = [...state.assets, payload];
                    }
                }
            }
        },

        /**
         * Remove assets from the playlist
         */
        removeFromAsset(state, action: PayloadAction<Asset | Asset[]>) {
            const payload = action.payload;

            if (Array.isArray(payload)) {
                // Handle array of assets
                if (payload.length > 0) {
                    state.assets = state.assets.filter(asset =>
                        !payload.some(removeAsset => asset.id === removeAsset.id)
                    );
                }
            } else {
                // Handle single asset
                if (payload.id) {
                    state.assets = state.assets.filter(asset => asset.id !== payload.id);
                }
            }

            // Update current index after removal
            if (state.currentAsset) {
                const newIndex = state.assets.findIndex(asset => asset.id === state.currentAsset!.id);
                state.currentIndex = newIndex;
                if (newIndex === -1) {
                    state.currentAsset = null;
                }
            }
        },

        /**
         * Move to the next asset in the playlist
         */
        nextAsset: (state) => {
            if (state.assets.length === 0) return;

            const nextIndex = (state.currentIndex + 1) % state.assets.length;
            state.currentIndex = nextIndex;
            state.currentAsset = state.assets[nextIndex];
        },

        /**
         * Move to the previous asset in the playlist
         */
        previousAsset: (state) => {
            if (state.assets.length === 0) return;

            const prevIndex = state.currentIndex <= 0
                ? state.assets.length - 1
                : state.currentIndex - 1;
            state.currentIndex = prevIndex;
            state.currentAsset = state.assets[prevIndex];
        },

        /**
         * Go to a specific asset by index
         */
        goToAssetIndex: (state, action: PayloadAction<number>) => {
            const index = action.payload;
            if (index >= 0 && index < state.assets.length) {
                state.currentIndex = index;
                state.currentAsset = state.assets[index];
            }
        },

        /**
         * Enable or disable autoplay
         */
        setAutoplayEnabled: (state, action: PayloadAction<boolean>) => {
            state.autoplay.enabled = action.payload;
        },

        /**
         * Set autoplay delay for images in seconds
         */
        setAutoplayDelay: (state, action: PayloadAction<number>) => {
            state.autoplay.delaySeconds = Math.max(1, Math.min(60, action.payload));
        },

        /**
         * Set whether to auto-advance when media ends
         */
        setAutoplayOnMediaEnd: (state, action: PayloadAction<boolean>) => {
            state.autoplay.onMediaEnd = action.payload;
        },

        /**
         * Update autoplay settings
         */
        updateAutoplaySettings: (state, action: PayloadAction<Partial<Cast['autoplay']>>) => {
            state.autoplay = {...state.autoplay, ...action.payload};
        },

        /**
         * Clear all cast state
         */
        clearCast: (state) => {
            state.currentAsset = null;
            state.assets = [];
            state.currentIndex = -1;
            // Clear playlist data
            state.currentPlaylist = null;
            state.isPlaylistMode = false;
        },

        // New playlist reducers
        setPlaylist: (state, action: PayloadAction<{
            playlist: PlayList;
            assets: Asset[];
            currentIndex?: number;
        }>) => {
            state.currentPlaylist = action.payload.playlist;
            state.assets = action.payload.assets;
            state.currentIndex = action.payload.currentIndex || 0;
            state.currentAsset = action.payload.assets[action.payload.currentIndex || 0] || null;
            state.isPlaylistMode = true;
        },

        clearPlaylist: (state) => {
            state.currentPlaylist = null;
            state.isPlaylistMode = false;
        },

        updatePlaylistAssets: (state, action: PayloadAction<Asset[]>) => {
            if (state.currentPlaylist && state.currentPlaylist.assets) {
                state.currentPlaylist.assets = action.payload;
                state.assets = action.payload;

                if (state.currentIndex >= action.payload.length) {
                    state.currentIndex = Math.max(0, action.payload.length - 1);
                }

                state.currentAsset = state.assets[state.currentIndex] || null;
            }
        },
    },
});

export const {
    setCurrentAsset,
    setAssets,
    addToAssets,
    removeFromAsset,
    nextAsset,
    previousAsset,
    goToAssetIndex,
    setAutoplayEnabled,
    setAutoplayDelay,
    setAutoplayOnMediaEnd,
    updateAutoplaySettings,
    clearCast,
    setPlaylist,
    clearPlaylist,
    updatePlaylistAssets,
} = castSlice.actions;

export default castSlice.reducer;