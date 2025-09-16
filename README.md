# CastLab

An app that allows to cast gallery media through DLNA protocol

## Build the app

### System requirements:

- [Node.js (LTS)](https://nodejs.org/en/).
- macOS, Windows (Powershell and [WSL 2](https://github.com/expo/fyi/blob/main/wsl.md)), and Linux are supported.

### Clone this repo:

`git clone https://codeberg.org/tom79/CastLab.git CastLab`

### Running the project:

- `cd CastLab`
- `npm install`
- `npx expo prebuild --clean`

#### Via expo

- `npx expo run:android` => Android or `npx expo run:ios` => iOS

#### Android (only)

- `cd android/app`
- `gradle assembleRelease`

## TODO

1. Remove the direct dependency to "react-native" 0.79.4 when this issue is
   solved (https://github.com/callstack/react-native-paper/issues/4763)
2. Allow to create playlists
3. Filter media with date ranges
4. More settings like automatic loading next media
5. Player controller in a notification when the app is in background
6. Remove mode debug
7. Prepare the FDroid version (prod)