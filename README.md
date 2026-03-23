# CastLab

CastLab: Cast your gallery media to DLNA/UPnP devices with playlist support and video extraction

[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0)
[![Weblate project translated](https://img.shields.io/weblate/progress/castlab?server=https%3A%2F%2Ftranslate.codeberg.org&style=for-the-badge)](https://translate.codeberg.org/projects/castlab/)
[![Liberapay patrons](https://img.shields.io/liberapay/patrons/tom79?label=Liberapay&style=for-the-badge)](https://liberapay.com/tom79/donate)

[<img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png"
     alt="Get it on F-Droid"
     height="80">](https://f-droid.org/packages/app.fedilab.castlab/)

Or download the latest [APK](https://codeberg.org/tom79/CastLab/releases/latest).

## Description

CastLab is a comprehensive media casting application that enables you to stream your local media and online videos to
DLNA/UPnP compatible devices.

Key Features:

- Media Casting
    - Cast photos, videos, and audio from your device gallery
    - Support for DLNA/UPnP protocol with automatic device discovery
    - Built-in HTTP server for seamless media streaming

- Media Management
    - Browse media by albums with filtering options (date range, media type)
    - Create and manage custom playlists
    - Organize media with intuitive selection and editing tools

- Playback Control
    - Integrated player controller with play, pause, stop, seek, and volume controls
    - Autoplay support with automatic advancement to next media
    - Compact mode for unobtrusive playback monitoring
    - Background playback with notification controls
    - Keep device awake during casting sessions

- Video Extraction
    - Extract videos from web pages (HTML parsing)
    - Remote casting from PeerTube and YouTube
    - YouTube URLs automatically converted to Invidious instances (privacy-friendly, no direct YouTube involvement)
    - Configurable Invidious instance settings
    - Extraction history tracking

- Customization
    - Multiple theme modes: Light, Dark, Auto (Day/Night), and Custom
    - Advanced theme customizer with preset themes
    - Customize individual color elements (primary, secondary, background, surface, etc.)
    - Material Design 3 (Material You) support

- User Experience
    - Intuitive navigation with contextual menus
    - Toast notifications for operation feedback
    - Persistent theme and playlist settings
    - SQLite database for reliable data storage

## Screenshots

<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/1.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/4.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/5.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/8.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/11.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/15.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/17.png" width="250"/>

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

