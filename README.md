# CastLab

An app that allows to cast gallery media through DLNA protocol

[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0)
[![Liberapay patrons](https://img.shields.io/liberapay/patrons/tom79?label=Liberapay&style=for-the-badge)](https://liberapay.com/tom79/donate)

## Features

- Cast media (Pictures, Videos, Audios) into device through DLNA
- Filer media
- Create Playlists
- Settings to automatically play next media (duration can be changed)
- Embedded player to control cast
- Notification player when the app is in the background
- Remote cast of videos from Peertube and Youtube (Youtube URLs are converted to Invidious URLs, Youtube is never
  involved)

## Screenshots

<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/1.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/2.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/3.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/4.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/5.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/6.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/7.png" width="250"/>

<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/8.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/9.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/10.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/11.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/12.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/13.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/14.png" width="250"/>

<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/15.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/16.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/17.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/18.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/19.png" width="250"/>
&nbsp;&nbsp;
<img src="fastlane/metadata/android/en-US/images/phoneScreenshots/20.png" width="250"/>

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

