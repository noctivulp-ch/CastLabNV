import {Provider} from "react-redux";
import {store} from './src/store/store'
import ThemeContextProvider from "./src/contexts/theme-context";
import Main from "./src/screens/Main";
import CastManagerContextProvider from "./src/contexts/castManager-context";


export default function App() {
    return (
        <Provider store={store}>
            <ThemeContextProvider>
                <CastManagerContextProvider>
                    <Main/>
                </CastManagerContextProvider>
            </ThemeContextProvider>
        </Provider>
    );
}