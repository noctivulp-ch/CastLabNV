import {configureStore} from '@reduxjs/toolkit'
import mediaReducer from './slice/mediaSlice'
import castReducer from './slice/castSlice'

export const store = configureStore({

    reducer: {
        media: mediaReducer,
        cast: castReducer,
    },
    middleware: getDefaultMiddleware =>
        getDefaultMiddleware({
            serializableCheck: false,
        }),

})