'use strict';

const { Clutter, Gio, GLib, Meta, St } = imports.gi;
const { main: Main } = imports.ui;
const ByteArray = imports.byteArray;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { Direction, Orientation, Settings } = Me.imports.src.common;

const GNOME_VERSION = parseFloat(imports.misc.config.PACKAGE_VERSION);

/**
 * Library of commonly used functions for the extension.js' files
 * (and *not* the prefs files)
 */

var Util = class Utility {
    /**
     * Performs an approximate equality check. There will be times when
     * there will be inaccuracies. For example, the user may enable window
     * gaps and resize 2 tiled windows and try to line them up manually.
     * But since the gaps are implemented with this extension, there will
     * be no window snapping. So the windows won't be aligned pixel
     * perfectly... in that case we first check approximately and correct
     * the inaccuracies afterwards.
     *
     * @param {number} value
     * @param {number} value2
     * @param {number} [margin=4]
     * @returns {boolean} wether the values are approximately equal.
     */
    static equal(value, value2, margin = 4) {
        return Math.abs(value - value2) <= margin;
    }

    /**
     * @param {{x, y}} pointA
     * @param {{x, y}} pointB
     * @returns {number} the distance between `pointA` and `pointB`,
     */
    static getDistance(pointA, pointB) {
        const diffX = pointA.x - pointB.x;
        const diffY = pointA.y - pointB.y;
        return Math.sqrt(diffX * diffX + diffY * diffY);
    }

    /**
     * @param {number} keyVal
     * @param {Direction} direction
     * @returns {boolean} wether the `keyVal` is considered to be in the
     *      direction of `direction`.
     */
    static isDirection(keyVal, direction) {
        switch (direction) {
            case Direction.N:
                return keyVal === Clutter.KEY_Up ||
                        keyVal === Clutter.KEY_w || keyVal === Clutter.KEY_W ||
                        keyVal === Clutter.KEY_k || keyVal === Clutter.KEY_K;

            case Direction.S:
                return keyVal === Clutter.KEY_Down ||
                        keyVal === Clutter.KEY_s || keyVal === Clutter.KEY_S ||
                        keyVal === Clutter.KEY_j || keyVal === Clutter.KEY_J;

            case Direction.W:
                return keyVal === Clutter.KEY_Left ||
                        keyVal === Clutter.KEY_a || keyVal === Clutter.KEY_A ||
                        keyVal === Clutter.KEY_h || keyVal === Clutter.KEY_H;

            case Direction.E:
                return keyVal === Clutter.KEY_Right ||
                        keyVal === Clutter.KEY_d || keyVal === Clutter.KEY_D ||
                        keyVal === Clutter.KEY_l || keyVal === Clutter.KEY_L;
        }

        return false;
    }

    /**
     * @param {number} keyVal
     * @returns {Direction}
     */
    static getDirection(keyVal) {
        if (this.isDirection(keyVal, Direction.N))
            return Direction.N;
        else if (this.isDirection(keyVal, Direction.S))
            return Direction.S;
        else if (this.isDirection(keyVal, Direction.W))
            return Direction.W;
        else if (this.isDirection(keyVal, Direction.E))
            return Direction.E;
        else
            return null;
    }

    /**
     * @param {number} modMask a Clutter.ModifierType.
     * @returns wether the current event the modifier at `modMask`.
     */
    static isModPressed(modMask) {
        return global.get_pointer()[2] & modMask;
    }

    /**
     * @returns {Layout[]} the layouts
     */
    static getLayouts() {
        const userDir = GLib.get_user_config_dir();
        const pathArr = [userDir, '/tiling-assistant/layouts.json'];
        const path = GLib.build_filenamev(pathArr);
        const file = Gio.File.new_for_path(path);
        if (!file.query_exists(null))
            return [];

        const [success, contents] = file.load_contents(null);
        if (!success || !contents.length)
            return [];

        return JSON.parse(ByteArray.toString(contents));
    }

    /**
     * @param {number|null} monitorNr determines which monitor the layout scales
     *      to. Sometimes we want the monitor of the pointer (when using dnd) and
     *      sometimes not (when using layouts with the keyboard shortcuts).
     * @returns {Rect[]}
     */
    static getFavoriteLayout(monitorNr = null) {
        // I don't know when the layout may have changed on the disk(?),
        // so always get it anew.
        const monitor = monitorNr ?? global.display.get_current_monitor();
        const favoriteLayout = [];
        const layouts = this.getLayouts();
        const layout = layouts?.[Settings.getStrv(Settings.FAVORITE_LAYOUTS)[monitor]];

        if (!layout)
            return [];

        const activeWs = global.workspace_manager.get_active_workspace();
        const workArea = new Rect(activeWs.get_work_area_for_monitor(monitor));

        // Scale the rect's ratios to the workArea. Try to align the rects to
        // each other and the workArea to workaround possible rounding errors
        // due to the scaling.
        layout._items.forEach(({ rect: rectRatios }, idx) => {
            const rect = new Rect(
                workArea.x + Math.floor(rectRatios.x * workArea.width),
                workArea.y + Math.floor(rectRatios.y * workArea.height),
                Math.ceil(rectRatios.width * workArea.width),
                Math.ceil(rectRatios.height * workArea.height)
            );
            favoriteLayout.push(rect);

            for (let i = 0; i < idx; i++)
                rect.tryAlignWith(favoriteLayout[i]);
        });

        favoriteLayout.forEach(rect => rect.tryAlignWith(workArea));
        return favoriteLayout;
    }

    /**
     * Shows the tiled rects of the top tile group.
     *
     * @returns {St.Widget[]} an array of St.Widgets to indicate the tiled rects.
     */
    static ___debugShowTiledRects() {
        const twm = Me.imports.src.extension.tilingWindowManager.TilingWindowManager;
        const topTileGroup = twm.getTopTileGroup();
        if (!topTileGroup.length) {
            Main.notify('Tiling Assistant', 'No tiled windows / tiled rects.');
            return null;
        }

        const indicators = [];
        topTileGroup.forEach(w => {
            const indicator = new St.Widget({
                style_class: 'tile-preview',
                opacity: 160,
                x: w.tiledRect.x,
                y: w.tiledRect.y,
                width: w.tiledRect.width,
                height: w.tiledRect.height
            });
            Main.uiGroup.add_child(indicator);
            indicators.push(indicator);
        });

        return indicators;
    }

    /**
     * Shows the free screen rects based on the top tile group.
     *
     * @returns {St.Widget[]} an array of St.Widgets to indicate the free
     *      screen rects.
     */
    static ___debugShowFreeScreenRects() {
        const activeWs = global.workspace_manager.get_active_workspace();
        const monitor = global.display.get_current_monitor();
        const workArea = new Rect(activeWs.get_work_area_for_monitor(monitor));
        const twm = Me.imports.src.extension.tilingWindowManager.TilingWindowManager;
        const topTileGroup = twm.getTopTileGroup();
        const tRects = topTileGroup.map(w => w.tiledRect);
        const freeScreenSpace = twm.getFreeScreen(tRects);
        const rects = freeScreenSpace ? [freeScreenSpace] : workArea.minus(tRects);
        if (!rects.length) {
            Main.notify('Tiling Assistant', 'No free screen rects to show.');
            return null;
        }

        const indicators = [];
        rects.forEach(rect => {
            const indicator = new St.Widget({
                style_class: 'tile-preview',
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            });
            Main.uiGroup.add_child(indicator);
            indicators.push(indicator);
        });

        return indicators.length ? indicators : null;
    }

    /**
     * Print the tile groups to the logs.
     */
    static __debugPrintTileGroups() {
        log('--- Tiling Assistant: Start ---');
        const twm = Me.imports.src.extension.tilingWindowManager.TilingWindowManager;
        const openWindows = twm.getWindows();
        openWindows.forEach(w => {
            if (!w.isTiled)
                return;

            log(`Tile group for: ${w.get_wm_class()}`);
            const tileGroup = twm.getTileGroupFor(w);
            tileGroup.forEach(tw => log(tw.get_wm_class()));
            log('---');
        });
        log('--- Tiling Assistant: End ---');
    }
};

/**
 * Wrapper for Meta.Rectangle to add some more functions.
 */
var Rect = class Rect {
    /**
     * @param  {...any} params No parameters, 1 Meta.Rectangle or the x, y,
     * width and height values should be passed to the constructor.
     */
    constructor(...params) {
        this._rect = new Meta.Rectangle();

        switch (params.length) {
            case 0:
                break;

            case 1:
                this._rect.x = params[0].x;
                this._rect.y = params[0].y;
                this._rect.width = params[0].width;
                this._rect.height = params[0].height;
                break;

            case 4:
                this._rect.x = params[0];
                this._rect.y = params[1];
                this._rect.width = params[2];
                this._rect.height = params[3];
                break;

            default:
                log('Tiling Assistant: Invalid param count for Rect constructor!');
        }
    }

    /**
     * Gets a new rectangle where the screen and window gaps were
     * added/subbed to/from `this`
     *
     * @param {Rect} rect a tiled Rect
     * @returns {Rect} the rectangle after the gaps were taken into account
     */
    addGaps(workArea) {
        const screenTopGap = Settings.getInt(Settings.SCREEN_TOP_GAP);
        const screenLeftGap = Settings.getInt(Settings.SCREEN_LEFT_GAP);
        const screenRightGap = Settings.getInt(Settings.SCREEN_RIGHT_GAP);
        const screenBottomGap = Settings.getInt(Settings.SCREEN_BOTTOM_GAP);
        const windowGap = Settings.getInt(Settings.WINDOW_GAP);
        const r = this.copy();
        
        [['x', 'width', screenLeftGap, screenRightGap],
         ['y', 'height', screenTopGap, screenBottomGap]].forEach(([pos, dim, posGap, dimGap]) => {
            if (this[pos] === workArea[pos]) {
                r[pos] = this[pos] + posGap;
                r[dim] -= posGap;
            } else {
                r[pos] = this[pos] + windowGap / 2;
                r[dim] -= windowGap / 2;
            }

            if (this[pos] + this[dim] === workArea[pos] + workArea[dim])
                r[dim] -= dimGap;
            else
                r[dim] -= windowGap / 2;
        });

        return r;
    }

    /**
     * @param {{x: number, y: number}} point
     * @returns {boolean}
     */
    containsPoint(point) {
        return point.x >= this.x && point.x <= this.x2 &&
                point.y >= this.y && point.y <= this.y2;
    }

    /**
     * @param {Rect} rect
     * @returns {boolean}
     */
    containsRect(rect) {
        rect = rect instanceof Meta.Rectangle ? rect : rect.meta;
        return this._rect.contains_rect(rect);
    }

    /**
     * @returns {Rect}
     */
    copy() {
        return new Rect(this._rect);
    }

    /**
     * @param {Rect} rect
     * @returns {boolean}
     */
    couldFitRect(rect) {
        rect = rect instanceof Meta.Rectangle ? rect : rect.meta;
        return this._rect.could_fit_rect(rect);
    }

    /**
     * @param {Rect} rect
     * @returns {boolean}
     */
    equal(rect) {
        rect = rect instanceof Meta.Rectangle ? rect : rect.meta;
        return this._rect.equal(rect);
    }

    /**
     * Gets the neighbor in the direction `dir` within the list of Rects
     * `rects`.
     *
     * @param {Direction} dir the direction that is looked into.
     * @param {Rect[]} rects an array of the available Rects. It may contain
     *      `this` itself. The rects shouldn't overlap each other.
     * @param {boolean} [wrap=true] wether wrap is enabled,
     *      if there is no Rect in the direction of `dir`.
     * @returns {Rect|null} the nearest Rect.
     */
    getNeighbor(dir, rects, wrap = true) {
        // Since we can only move into 1 direction at a time, we just need
        // to check 1 axis / property of the rects per movement (...almost).
        // An example probably makes this clearer. If we want to get the
        // neighbor in the N direction, we just look at the y's of the rects.
        // More specifically, we look for the y2's ('cmprProp') of the other
        // rects which are bigger than the y1 ('startProp') of `this`. The
        // nearest neighbor has y2 == this.y1. i. e. the neighbor and `this`
        // share a border. There may be multiple windows with the same distance.
        // In our example it might happen, if 2 windows are tiled side by side
        // bordering `this`. In that case we choose the window, which is the
        // nearest on the non-compared axis ('nonCmprProp'). The x property
        // in the this example.
        let startProp, cmprProp, nonCmprProp;
        if (dir === Direction.N)
            [startProp, cmprProp, nonCmprProp] = ['y', 'y2', 'x'];
        else if (dir === Direction.S)
            [startProp, cmprProp, nonCmprProp] = ['y2', 'y', 'x'];
        else if (dir === Direction.W)
            [startProp, cmprProp, nonCmprProp] = ['x', 'x2', 'y'];
        else if (dir === Direction.E)
            [startProp, cmprProp, nonCmprProp] = ['x2', 'x', 'y'];

        // Put rects into a Map with their relevenat pos'es as the keys and
        // filter out `this`.
        const posMap = rects.reduce((map, rect) => {
            if (rect.equal(this))
                return map;

            const pos = rect[cmprProp];
            if (!map.has(pos))
                map.set(pos, []);

            map.get(pos).push(rect);
            return map;
        }, new Map());

        // Sort the pos'es in an ascending / descending order.
        const goForward = [Direction.S, Direction.E].includes(dir);
        const sortedPoses = [...posMap.keys()].sort((a, b) =>
            goForward ? a - b : b - a);

        const neighborPos = goForward
            ? sortedPoses.find(pos => pos >= this[startProp])
            : sortedPoses.find(pos => pos <= this[startProp]);

        if (!neighborPos && !wrap)
            return null;

        // Since the sortedPoses array is in descending order when 'going
        // backwards', we always wrap by getting the 0-th item, if there
        // is no actual neighbor.
        const neighbors = posMap.get(neighborPos ?? sortedPoses[0]);
        return neighbors.reduce((currNearest, rect) => {
            return Math.abs(currNearest[nonCmprProp] - this[nonCmprProp]) <=
                    Math.abs(rect[nonCmprProp] - this[nonCmprProp])
                ? currNearest
                : rect;
        });
    }

    /**
     * Gets the rectangle at `index`, if `this` is split into equally
     * sized rects. This function is meant to prevent rounding errors.
     * Rounding errors may lead to rects not aligning properly and thus
     * messing up other calculations etc... This solution may lead to the
     * last rect's size being off by a few pixels compared to the other
     * rects, if we split `this` multiple times.
     *
     * @param {number} index the position of the rectangle we want after
     *      splitting this rectangle.
     * @param {number} unitSize the size of 1 partial unit of the rectangle.
     * @param {Orientation} orientation determines the split orientation
     *      (horizonally or vertically).
     * @returns {Rect} the rectangle at `index` after the split.
     */
    getUnitAt(index, unitSize, orientation) {
        unitSize = Math.floor(unitSize);
        const isVertical = orientation === Orientation.V;
        const firstUnitRect = new Rect(
            this.x,
            this.y,
            isVertical ? unitSize : this.width,
            isVertical ? this.height : unitSize
        );

        if (index <= 0) {
            return firstUnitRect;
        } else {
            const remaining = this.minus(firstUnitRect)[0];
            return remaining.getUnitAt(index - 1, unitSize, orientation);
        }
    }

    /**
     * @param {Rect} rect
     * @returns {boolean}
     */
    horizOverlap(rect) {
        rect = rect instanceof Meta.Rectangle ? rect : rect.meta;
        return this._rect.horiz_overlap(rect);
    }

    /**
     * @param {Rect} rect
     * @returns {[boolean, Rect]}
     */
    intersect(rect) {
        rect = rect instanceof Meta.Rectangle ? rect : rect.meta;
        const [ok, intersection] = this._rect.intersect(rect);
        return [ok, new Rect(intersection)];
    }

    /**
     * Get the Rects that remain from `this`, if `r` is cut off from it.
     *
     * @param {Rect|Rect[]} r either a single Rect or an array of Rects.
     * @returns {Rect[]} an array of Rects.
     */
    minus(r) {
        return Array.isArray(r) ? this._minusRectArray(r) : this._minusRect(r);
    }

    /**
     * Gets the Rects, which remain from `this` after `rect` was cut off
     * / substracted from it.
     *
     * Original idea from: \
     * https://en.wikibooks.org/wiki/Algorithm_Implementation/Geometry/Rectangle_difference \
     * No license is given except the general CC-BY-AS (for text) mentioned
     * in the footer. Since the algorithm seems fairly generic (just a few
     * additions / substractions), I think I should be good regardless...
     * I've modified the algorithm to make the left / right result rects bigger
     * instead of the top / bottom rects since screens usually have horizontal
     * orientations; so having the vertical rects take priority makes more sense.
     *
     * @param {Rect} rect the Rect to cut off from `this`.
     * @returns {Rect[]} an array of Rects. It contains 0 - 4 rects.
     */
    _minusRect(rect) {
        rect = rect instanceof Meta.Rectangle ? new Rect(rect) : rect;
        if (rect.containsRect(this))
            return [];

        const [intersect] = this.intersect(rect);
        if (!intersect)
            return [this.copy()];

        const resultRects = [];

        // Left rect
        const leftRectWidth = rect.x - this.x;
        if (leftRectWidth > 0 && this.height > 0)
            resultRects.push(new Rect(this.x, this.y, leftRectWidth, this.height));

        // Right rect
        const rightRectWidth = this.x2 - rect.x2;
        if (rightRectWidth > 0 && this.height > 0)
            resultRects.push(new Rect(rect.x2, this.y, rightRectWidth, this.height));

        const vertRectsX1 = rect.x > this.x ? rect.x : this.x;
        const vertRectsX2 = rect.x2 < this.x2 ? rect.x2 : this.x2;
        const vertRectsWidth = vertRectsX2 - vertRectsX1;

        // Top rect
        const topRectHeight = rect.y - this.y;
        if (topRectHeight > 0 && vertRectsWidth > 0)
            resultRects.push(new Rect(vertRectsX1, this.y, vertRectsWidth, topRectHeight));

        // Bottom rect
        const bottomRectHeight = this.y2 - rect.y2;
        if (bottomRectHeight > 0 && vertRectsWidth > 0)
            resultRects.push(new Rect(vertRectsX1, rect.y2, vertRectsWidth, bottomRectHeight));

        return resultRects;
    }

    /**
     * Gets the Rects that remain from `this`, if a list of rects is cut
     * off from it.
     *
     * @param {Rect[]} rects the list of Rects to cut off from `this`.
     * @returns {Rect[]} an array of the remaining Rects.
     */
    _minusRectArray(rects) {
        if (!rects.length)
            return [this.copy()];

        // First cut off all rects individually from `this`. The result is an
        // array of leftover rects (which are arrays themselves) from `this`.
        const individualLeftOvers = rects.map(r => this.minus(r));

        // Get the final result by intersecting all leftover rects.
        return individualLeftOvers.reduce((result, currLeftOvers) => {
            const intersections = [];

            for (const leftOver of currLeftOvers) {
                for (const currFreeRect of result) {
                    const [ok, inters] = currFreeRect.intersect(leftOver);
                    ok && intersections.push(new Rect(inters));
                }
            }

            return intersections;
        });
    }

    /**
     * @param {Rect} rect
     * @returns {boolean}
     */
    overlap(rect) {
        rect = rect instanceof Meta.Rectangle ? rect : rect.meta;
        return this._rect.overlap(rect);
    }

    /**
     * Makes `this` stick to `rect`, if they are close to each other. Use it
     * as a last resort to prevent rounding errors, if you can't use minus()
     * or getUnitAt().
     *
     * @param {Rect} rect the rectangle to align `this` with.
     * @param {number} margin only align, if `this` and the `rect` are at most
     *      this far away.
     * @returns {Rect} a reference to this.
     */
    tryAlignWith(rect, margin = 4) {
        rect = rect instanceof Meta.Rectangle ? new Rect(rect) : rect;
        const equalApprox = (value1, value2) => Math.abs(value1 - value2) <= margin;

        if (equalApprox(rect.x, this.x))
            this.x = rect.x;
        else if (equalApprox(rect.x2, this.x))
            this.x = rect.x2;

        if (equalApprox(rect.y, this.y))
            this.y = rect.y;
        else if (equalApprox(rect.y2, this.y))
            this.y = rect.y2;

        if (equalApprox(rect.x, this.x2))
            this.width = rect.x - this.x;
        else if (equalApprox(rect.x2, this.x2))
            this.width = rect.x2 - this.x;

        if (equalApprox(rect.y, this.y2))
            this.height = rect.y - this.y;
        else if (equalApprox(rect.y2, this.y2))
            this.height = rect.y2 - this.y;

        return this;
    }

    /**
     * @param {Rect} rect
     * @returns {Rect}
     */
    union(rect) {
        rect = rect instanceof Meta.Rectangle ? rect : rect.meta;
        return new Rect(this._rect.union(rect));
    }

    /**
     * @param {Rect} rect
     * @returns {boolean}
     */
    vertOverlap(rect) {
        rect = rect instanceof Meta.Rectangle ? rect : rect.meta;
        return this._rect.vert_overlap(rect);
    }

    /**
     * Getters
     */

    get meta() {
        return this._rect.copy();
    }

    get area() {
        return this._rect.area();
    }

    get x() {
        return this._rect.x;
    }

    get x2() {
        return this._rect.x + this._rect.width;
    }

    get y() {
        return this._rect.y;
    }

    get y2() {
        return this._rect.y + this._rect.height;
    }

    get center() {
        return {
            x: this.x + Math.floor(this.width / 2),
            y: this.y + Math.floor(this.height / 2)
        };
    }

    get width() {
        return this._rect.width;
    }

    get height() {
        return this._rect.height;
    }

    /**
     * Setters
     */

    set x(value) {
        this._rect.x = Math.floor(value);
    }

    set x2(value) {
        this._rect.width = Math.floor(value) - this.x;
    }

    set y(value) {
        this._rect.y = Math.floor(value);
    }

    set y2(value) {
        this._rect.height = Math.floor(value) - this.y;
    }

    set width(value) {
        this._rect.width = Math.floor(value);
    }

    set height(value) {
        this._rect.height = Math.floor(value);
    }
};
