# Tiling Assistant for GNOME

An extension which adds a Windows-like snap assist to GNOME. It also changes GNOME's 2 column tiling design to a 2x2 grid (i.e. 4 quadrants) and *more*...

## Table of Contents
- [Supported GNOME Versions](#Supported-GNOME-Versions)
- [Usage and Features](#Usage-and-Features)
- [Preview](#Preview)
- [Installation](#Installation)
- [Translations](#Translations)
- [License](#License)

## Supported GNOME Versions

See the [metadata file](https://github.com/Leleat/Tiling-Assistant/blob/main/tiling-assistant%40leleat-on-github/metadata.json#L4) for a list of supported GNOME Shell version. Generally, only the most recent GNOME Shell is supported. You can however install older version of this extension from https://extensions.gnome.org, which may support older GNOME releases. But that extension version may not include all features and won't get any bugfixes.

## Usage and Features

- **Tiling Popup** offers to automatically tile a window to fill the available screen space.

- **Tile Groups**  are focused and resized together.

- **Layouts**

- ...

Please see the ![User Guide](GUIDE.md) for a list and an explanation of every feature.

## Preview

![Preview](media/ReadMe_Preview.gif)

## Installation

You can [install it](https://extensions.gnome.org/extension/3733/tiling-assistant/) via https://extensions.gnome.org. Alternatively (or if you want an up-to-date version), download / clone the repository and run the `scripts/build.sh` script with the `-i` flag. Make sure to have `gettext` installed. If you've manually installed the extension, don't forget to reload GNOME Shell afterwards (by logging out). It's also on the AUR but that one isn't maintained me.

## Translations

Translations (even just partial ones) are very welcome!
If you are already familiar with how it works, feel free to directly open a pull request with a `YOUR_LANG.po` file at `translations/`.
Don't worry, in case you don't know how to create a `.po` file. Just open an issue and I'll set everything up. You'll only need a text editor and your language skills :)

## License

This extension is distributed under the terms of the GNU General Public License, version 2 or later. See the license file for details.
