'use strict';

const { Gdk, Gio, GLib, Gtk } = imports.gi;
const ByteArray = imports.byteArray;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const LayoutPrefs = Me.imports.src.prefs.layoutsPrefs.Prefs;
const { Changelog } = Me.imports.src.prefs.changelog;
const { ShortcutListener } = Me.imports.src.prefs.shortcutListener;
const { Settings, Shortcuts } = Me.imports.src.common;

function init() {
    ExtensionUtils.initTranslations(Me.metadata.uuid);
}

function fillPreferencesWindow(window) {
    window.set_can_navigate_back(true);

    const settings = ExtensionUtils.getSettings(Me.metadata['settings-schema']);
    const builder = new Gtk.Builder();
    builder.set_translation_domain(Me.metadata.uuid);
    builder.add_from_file(`${Me.path}/src/ui/prefs.ui`);

    // Add general perference page
    window.add(builder.get_object('general'));

    // Add keybindings perference page
    window.add(builder.get_object('keybindings'));

    // Add layouts preference page on condition of advanced setting
    const layoutsPage = builder.get_object('layouts');
    settings.connect(`changed::${Settings.ENABLE_ADV_EXP_SETTINGS}`, () => {
        settings.get_boolean(Settings.ENABLE_ADV_EXP_SETTINGS)
            ? window.add(layoutsPage)
            : window.remove(layoutsPage);
    });

    if (settings.get_boolean(Settings.ENABLE_ADV_EXP_SETTINGS))
        window.add(layoutsPage);

    // Bind settings to GUI
    _bindSwitches(settings, builder);
    _bindSpinbuttons(settings, builder);
    _bindComboRows(settings, builder);
    _bindRadioButtons(settings, builder);
    _bindKeybindings(settings, builder);

    // LayoutPrefs manages everything related to layouts on the
    // prefs side (including the keyboard shortcuts)
    new LayoutPrefs(settings, builder);

    // Set visibility for deprecated settings
    _setDeprecatedSettings(settings, builder);

    // Add a button into the headerbar with info
    _addHeaderBarInfoButton(window, settings, builder);

    // Open Changelog after an update
    const lastVersion = settings.get_int(Settings.CHANGELOG_VERSION);
    const firstInstall = lastVersion === -1;
    const noUpdate = lastVersion >= Me.metadata.version;

    settings.set_int(Settings.CHANGELOG_VERSION, Me.metadata.version);

    if (firstInstall || noUpdate)
        return;

    if (!settings.get_boolean(Settings.SHOW_CHANGE_ON_UPDATE))
        return;

    _openChangelog(window, settings);
}

/*
 * Bind GUI switches to settings.
 */
function _bindSwitches(settings, builder) {
    const switches = [
        Settings.ENABLE_TILING_POPUP,
        Settings.POPUP_ALL_WORKSPACES,
        Settings.RAISE_TILE_GROUPS,
        Settings.TILEGROUPS_IN_APP_SWITCHER,
        Settings.MAXIMIZE_WITH_GAPS,
        Settings.SHOW_LAYOUT_INDICATOR,
        Settings.ENABLE_ADV_EXP_SETTINGS,
        Settings.SHOW_CHANGE_ON_UPDATE,
        Settings.ADAPT_EDGE_TILING_TO_FAVORITE_LAYOUT,
        Settings.ENABLE_TILE_ANIMATIONS,
        Settings.ENABLE_UNTILE_ANIMATIONS,
        Settings.ENABLE_HOLD_INVERSE_LANDSCAPE,
        Settings.ENABLE_HOLD_INVERSE_PORTRAIT
    ];

    switches.forEach(key => {
        const widget = builder.get_object(key.replaceAll('-', '_'));
        settings.bind(key, widget, 'active', Gio.SettingsBindFlags.DEFAULT);
    });
}

/*
 * Bind GUI spinbuttons to settings.
 */
function _bindSpinbuttons(settings, builder) {
    const spinButtons = [
        Settings.WINDOW_GAP,
        Settings.SCREEN_TOP_GAP,
        Settings.SCREEN_LEFT_GAP,
        Settings.SCREEN_RIGHT_GAP,
        Settings.SCREEN_BOTTOM_GAP,
        Settings.INVERSE_TOP_MAXIMIZE_TIMER,
        Settings.VERTICAL_PREVIEW_AREA,
        Settings.HORIZONTAL_PREVIEW_AREA
    ];

    spinButtons.forEach(key => {
        const widget = builder.get_object(key.replaceAll('-', '_'));
        settings.bind(key, widget, 'value', Gio.SettingsBindFlags.DEFAULT);
    });
}

/*
 * Bind GUI AdwComboRows to settings.
 */
function _bindComboRows(settings, builder) {
    const comboRows = [
        Settings.ADAPTIVE_TILING_MOD,
        Settings.FAVORITE_LAYOUT_MOD,
        Settings.RESTORE_SIZE_ON
    ];

    comboRows.forEach(key => {
        const widget = builder.get_object(key.replaceAll('-', '_'));
        settings.bind(key, widget, 'selected', Gio.SettingsBindFlags.DEFAULT);
        widget.set_selected(settings.get_int(key));
    });
}

/*
 * Bind radioButtons to settings.
 */
function _bindRadioButtons(settings, builder) {
    // These 'radioButtons' are basically just used as a 'fake ComboBox' with
    // explanations for the different options. So there is just *one* gsetting
    // (an int) which saves the current 'selection'.
    const radioButtons = [
        {
            key: Settings.DYNAMIC_KEYBINDINGS,
            rowNames: [
                'dynamic_keybinding_disabled_row',
                'dynamic_keybinding_window_focus_row',
                'dynamic_keybinding_tiling_state_row',
                'dynamic_keybinding_tiling_state_windows_row',
                'dynamic_keybinding_favorite_layout_row'
            ]
        },
        {
            key: Settings.DEFAULT_MOVE_MODE,
            rowNames: [
                'edge_tiling_row',
                'adaptive_tiling_row',
                'favorite_layout_row'
            ]
        }
    ];

    radioButtons.forEach(({ key, rowNames }) => {
        const currActive = settings.get_int(key);

        rowNames.forEach((name, idx) => {
            const row = builder.get_object(name.replaceAll('-', '_'));
            const checkButton = row.activatable_widget;
            checkButton.connect('toggled', () => settings.set_int(key, idx));

            // Set initial state
            if (idx === currActive)
                checkButton.activate();
        });
    });
}

/*
 * Bind keybinding widgets to settings.
 */
function _bindKeybindings(settings, builder) {
    const shortcuts = Shortcuts.getAllKeys();
    shortcuts.forEach(key => {
        const shortcut = builder.get_object(key.replaceAll('-', '_'));
        shortcut.initialize(key, settings);
    });
}

/**
 * Sets the visibility of deprecated settings. Those setting aren't visible
 * in the GUI unless they have a user set value. That means they aren't
 * discoverable through the GUI and need to first be set with the gsetting.
 * The normal rows should have the id of: GSETTING_WITH_UNDERSCORES_row.
 * ShortcutListeners have the format of GSETTING_WITH_UNDERSCORES.
 */
function _setDeprecatedSettings(settings, builder) {
    // Keybindings
    ['toggle-tiling-popup', 'auto-tile'].forEach(s => {
        const isNonDefault = settings.get_strv(s)[0] !== settings.get_default_value(s).get_strv()[0];
        builder.get_object(s.replaceAll('-', '_')).set_visible(isNonDefault);
    });

    // Switches
    ['tilegroups-in-app-switcher'].forEach(s => {
        const isNonDefault = settings.get_boolean(s) !== settings.get_default_value(s).get_boolean();
        builder.get_object(`${s.replaceAll('-', '_')}_row`).set_visible(isNonDefault);
    });
}

function _addHeaderBarInfoButton(window, settings, builder) {
    // Add headerBar button for menu
    // TODO: is this a 'reliable' method to access the headerbar?
    const page = builder.get_object('general');
    const pages_stack = page.get_parent(); // AdwViewStack
    const content_stack = pages_stack.get_parent().get_parent(); // GtkStack
    const preferences = content_stack.get_parent(); // GtkBox
    const headerbar = preferences.get_first_child(); // AdwHeaderBar
    headerbar.pack_start(builder.get_object('info_menu'));

    // Setup menu actions
    const actionGroup = new Gio.SimpleActionGroup();
    window.insert_action_group('prefs', actionGroup);

    const bugReportAction = new Gio.SimpleAction({ name: 'open-bug-report' });
    bugReportAction.connect('activate', this._openBugReport.bind(this, window));
    actionGroup.add_action(bugReportAction);

    const userGuideAction = new Gio.SimpleAction({ name: 'open-user-guide' });
    userGuideAction.connect('activate', this._openUserGuide.bind(this, window, settings));
    actionGroup.add_action(userGuideAction);

    const changelogAction = new Gio.SimpleAction({ name: 'open-changelog' });
    changelogAction.connect('activate', this._openChangelog.bind(this, window, settings));
    actionGroup.add_action(changelogAction);

    const licenseAction = new Gio.SimpleAction({ name: 'open-license' });
    licenseAction.connect('activate', this._openLicense.bind(this, window));
    actionGroup.add_action(licenseAction);

    const hiddenSettingsAction = new Gio.SimpleAction({ name: 'open-hidden-settings' });
    hiddenSettingsAction.connect('activate', this._openHiddenSettings.bind(this, window, builder));
    actionGroup.add_action(hiddenSettingsAction);

    // Button to return to main settings page
    const returnButton = builder.get_object('hidden_settings_return_button');
    returnButton.connect('clicked', () => window.close_subpage());
}

function _openBugReport(window) {
    Gtk.show_uri(window, 'https://github.com/Leleat/Tiling-Assistant/issues', Gdk.CURRENT_TIME);
}

function _openUserGuide(window) {
    Gtk.show_uri(window, 'https://github.com/Leleat/Tiling-Assistant/blob/main/GUIDE.md', Gdk.CURRENT_TIME);
}

function _openChangelog(window, settings) {
    const path = GLib.build_filenamev([Me.path, 'src/changelog.json']);
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null))
        return;

    const [success, contents] = file.load_contents(null);
    if (!success || !contents.length)
        return;

    const changes = JSON.parse(ByteArray.toString(contents));
    const allowAdvExpSettings = settings.get_boolean(Settings.ENABLE_ADV_EXP_SETTINGS);
    const changelogDialog = new Changelog(changes, allowAdvExpSettings);
    changelogDialog._changelogReturnButton.connect('clicked', () => window.close_subpage());
    window.present_subpage(changelogDialog);
}

function _openLicense(window) {
    Gtk.show_uri(window, 'https://github.com/Leleat/Tiling-Assistant/blob/main/LICENSE', Gdk.CURRENT_TIME);
}

function _openHiddenSettings(window, builder) {
    const hiddenSettingsPage = builder.get_object('hidden_settings');
    window.present_subpage(hiddenSettingsPage);
}
