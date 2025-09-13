import {createSlice} from "@reduxjs/toolkit";
import {Album} from "expo-media-library";

type AppAlbums = { all: Album[], photos: Album[], videos: Album[], audios: Album[] };

const initialState: AppAlbums = {all: [], photos: [], videos: [], audios: []};

export const mediaSlice = createSlice({
    name: "media",
    initialState,
    reducers: {
        setAll(state, action) {
            if (!state.all.includes(action.payload)) {
                state.all.push(action.payload);
            }
        },
        setPhotos(state, action) {
            if (!state.photos.includes(action.payload)) {
                state.photos.push(action.payload);
            }
        },
        setVideos(state, action) {
            if (!state.videos.includes(action.payload)) {
                state.videos.push(action.payload);
            }
        },
        setAudios(state, action) {
            if (!state.audios.includes(action.payload)) {
                state.audios.push(action.payload);
            }
        },
    }
});

export const {
    setAll,
    setPhotos,
    setVideos,
    setAudios
} = mediaSlice.actions;

export default mediaSlice.reducer;