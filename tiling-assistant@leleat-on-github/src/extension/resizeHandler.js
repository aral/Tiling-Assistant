'use strict';

const Meta = imports.gi.Meta;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Settings = Me.imports.src.common.Settings;
const { Rect, Util } = Me.imports.src.extension.utility;
const Twm = Me.imports.src.extension.tilingWindowManager.TilingWindowManager;

const Side = {
    NONE: 0,
    SAME_H: 1,
    OPPOSING_H: 2,
    SAME_V: 4,
    OPPOSING_V: 8
};

/**
 * This class gets to handle the resize events of windows (wether they are
 * tiled or not). If a window isn't tiled, nothing happens. If the resized
 * window is tiled, auto-resize the complementing tiled windows. Intercardinal
 * resizing is split into its [H]orizontal and [V]ertical components.
 */

var Handler = class TilingResizeHandler {
    constructor() {
        const isResizing = grabOp => {
            switch (grabOp) {
                case Meta.GrabOp.RESIZING_N:
                case Meta.GrabOp.RESIZING_NW:
                case Meta.GrabOp.RESIZING_NE:
                case Meta.GrabOp.RESIZING_S:
                case Meta.GrabOp.RESIZING_SW:
                case Meta.GrabOp.RESIZING_SE:
                case Meta.GrabOp.RESIZING_E:
                case Meta.GrabOp.RESIZING_W:
                    return true;

                default:
                    return false;
            }
        };

        const g1 = global.display.connect('grab-op-begin', (d, window, grabOp) => {
            if (window && isResizing(grabOp))
                this._onResizeStarted(window, grabOp);
        });
        const g2 = global.display.connect('grab-op-end', (d, window, grabOp) => {
            if (window && isResizing(grabOp))
                this._onResizeFinished(window, grabOp);
        });
        this._displaySignals = [];
        this._displaySignals.push(g1);
        this._displaySignals.push(g2);

        this._sizeChangedId = 0;
        this._preGrabRects = new Map();
        // Save the windows, which are to be resized (passively) along the
        // actively grabbed one, and a resizeOp. A resizeOp saves the side
        // of the window, which will be passively resized, relative to the
        // actively resized window.
        this._resizeOps = new Map();
    }

    destroy() {
        this._displaySignals.forEach(sId => global.display.disconnect(sId));
    }

    _onResizeStarted(window, grabOp) {
        if (!window.isTiled)
            return;

        // Use the same margin for the alignment and equality check below.
        const margin = 5;
        const topTileGroup = Twm.getTopTileGroup();
        topTileGroup.forEach(w => {
            this._preGrabRects.set(w, new Rect(w.get_frame_rect()));

            if (w !== window)
                // There is no snapping for tiled windows, if the user set a window
                // gap. So the windows may not align properly, if the user tried
                // to manually resize them to be edge to edge. In that case, assume
                // that windows that are within a certain margin distance to each
                // other are meant to align and resize them together.
                w.tiledRect.tryAlignWith(window.tiledRect, margin);
        });

        // Windows can be part of multiple tile groups. We however only resize
        // the top most visible tile group. That means a tile group in a lower
        // stack position may share windows with the top tile group and after
        // the resize op those windows will no longer match with the lower tile
        // group's tiles. So remove the shared windows from the lower tile group.
        const allWindows = Twm.getWindows();
        allWindows.forEach(w => {
            if (!w.isTiled)
                return;

            if (topTileGroup.includes(w))
                return;

            // Gets a tile group of windows without the ones
            // which are about to be resized
            const group = Twm.getTileGroupFor(w);
            const newGroup = group.reduce((gr, win) => {
                !topTileGroup.includes(win) && gr.push(win);
                return gr;
            }, []);

            // Tile groups are the same
            if (group.length === newGroup.length)
                return;

            // Remove old tile group and create new one
            Twm.clearTilingProps(w.get_id());
            Twm.updateTileGroup(newGroup);
        });

        // Remove the actively resizing window to get the windows, which will
        // be passively resized.
        topTileGroup.splice(topTileGroup.indexOf(window), 1);
        const grabbedRect = window.tiledRect;

        switch (grabOp) {
        // Resizing cardinal directions
            case Meta.GrabOp.RESIZING_N:
                for (const otherWindow of topTileGroup) {
                    const otherRect = otherWindow.tiledRect;
                    const resizeOp = ResizeOp.createResizeOp(
                        Util.equal(grabbedRect.y, otherRect.y, margin),
                        Util.equal(grabbedRect.y, otherRect.y2, margin),
                        false,
                        false
                    );
                    resizeOp && this._resizeOps.set(otherWindow, resizeOp);
                }

                this._sizeChangedId = window.connect('size-changed',
                    this._onResizing.bind(this, window, grabOp, null));
                break;

            case Meta.GrabOp.RESIZING_S:
                for (const otherWindow of topTileGroup) {
                    const otherRect = otherWindow.tiledRect;
                    const resizeOp = ResizeOp.createResizeOp(
                        Util.equal(grabbedRect.y2, otherRect.y2, margin),
                        Util.equal(grabbedRect.y2, otherRect.y, margin),
                        false,
                        false
                    );
                    resizeOp && this._resizeOps.set(otherWindow, resizeOp);
                }

                this._sizeChangedId = window.connect('size-changed',
                    this._onResizing.bind(this, window, grabOp, null));
                break;

            case Meta.GrabOp.RESIZING_E:
                for (const otherWindow of topTileGroup) {
                    const otherRect = otherWindow.tiledRect;
                    const resizeOp = ResizeOp.createResizeOp(
                        false,
                        false,
                        Util.equal(grabbedRect.x2, otherRect.x2, margin),
                        Util.equal(grabbedRect.x2, otherRect.x, margin)
                    );
                    resizeOp && this._resizeOps.set(otherWindow, resizeOp);
                }

                this._sizeChangedId = window.connect('size-changed',
                    this._onResizing.bind(this, window, null, grabOp));
                break;

            case Meta.GrabOp.RESIZING_W:
                for (const otherWindow of topTileGroup) {
                    const otherRect = otherWindow.tiledRect;
                    const resizeOp = ResizeOp.createResizeOp(
                        false,
                        false,
                        Util.equal(grabbedRect.x, otherRect.x, margin),
                        Util.equal(grabbedRect.x, otherRect.x2, margin)
                    );
                    resizeOp && this._resizeOps.set(otherWindow, resizeOp);
                }

                this._sizeChangedId = window.connect('size-changed',
                    this._onResizing.bind(this, window, null, grabOp));
                break;

                // Resizing intercardinal directions:
            case Meta.GrabOp.RESIZING_NW:
                for (const otherWindow of topTileGroup) {
                    const otherRect = otherWindow.tiledRect;
                    const resizeOp = ResizeOp.createResizeOp(
                        Util.equal(grabbedRect.y, otherRect.y, margin),
                        Util.equal(grabbedRect.y, otherRect.y2, margin),
                        Util.equal(grabbedRect.x, otherRect.x, margin),
                        Util.equal(grabbedRect.x, otherRect.x2, margin)
                    );
                    resizeOp && this._resizeOps.set(otherWindow, resizeOp);
                }

                this._sizeChangedId = window.connect('size-changed',
                    this._onResizing.bind(this, window, Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_W));
                break;

            case Meta.GrabOp.RESIZING_NE:
                for (const otherWindow of topTileGroup) {
                    const otherRect = otherWindow.tiledRect;
                    const resizeOp = ResizeOp.createResizeOp(
                        Util.equal(grabbedRect.y, otherRect.y, margin),
                        Util.equal(grabbedRect.y, otherRect.y2, margin),
                        Util.equal(grabbedRect.x2, otherRect.x2, margin),
                        Util.equal(grabbedRect.x2, otherRect.x, margin)
                    );
                    resizeOp && this._resizeOps.set(otherWindow, resizeOp);
                }

                this._sizeChangedId = window.connect('size-changed',
                    this._onResizing.bind(this, window, Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_E));
                break;

            case Meta.GrabOp.RESIZING_SW:
                for (const otherWindow of topTileGroup) {
                    const otherRect = otherWindow.tiledRect;
                    const resizeOp = ResizeOp.createResizeOp(
                        Util.equal(grabbedRect.y2, otherRect.y2, margin),
                        Util.equal(grabbedRect.y2, otherRect.y, margin),
                        Util.equal(grabbedRect.x, otherRect.x, margin),
                        Util.equal(grabbedRect.x, otherRect.x2, margin)
                    );
                    resizeOp && this._resizeOps.set(otherWindow, resizeOp);
                }

                this._sizeChangedId = window.connect('size-changed',
                    this._onResizing.bind(this, window, Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_W));
                break;

            case Meta.GrabOp.RESIZING_SE:
                for (const otherWindow of topTileGroup) {
                    const otherRect = otherWindow.tiledRect;
                    const resizeOp = ResizeOp.createResizeOp(
                        Util.equal(grabbedRect.y2, otherRect.y2, margin),
                        Util.equal(grabbedRect.y2, otherRect.y, margin),
                        Util.equal(grabbedRect.x2, otherRect.x2, margin),
                        Util.equal(grabbedRect.x2, otherRect.x, margin)
                    );
                    resizeOp && this._resizeOps.set(otherWindow, resizeOp);
                }

                this._sizeChangedId = window.connect('size-changed',
                    this._onResizing.bind(this, window, Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_E));
        }
    }

    // Update the windows' tiledRects
    _onResizeFinished(window, grabOp) {
        if (this._sizeChangedId) {
            window.disconnect(this._sizeChangedId);
            this._sizeChangedId = 0;
        }

        if (!window.isTiled)
            return;

        const screenTopGap = Settings.getInt(Settings.SCREEN_TOP_GAP);
        const screenLeftGap = Settings.getInt(Settings.SCREEN_LEFT_GAP);
        const screenRightGap = Settings.getInt(Settings.SCREEN_RIGHT_GAP);
        const screenBottomGap = Settings.getInt(Settings.SCREEN_BOTTOM_GAP);
        const windowGap = Settings.getInt(Settings.WINDOW_GAP);
        const workArea = window.get_work_area_for_monitor(window.get_monitor());

        // First calculate the new tiledRect for window:
        // The new x / y coord for the window's tiledRect can be calculated by
        // a simple difference because resizing on the E / S side wont change
        // x / y and resizing on the N or W side will translate into a 1:1 shift
        const grabbedsNewRect = new Rect(window.get_frame_rect());
        const grabbedsOldRect = this._preGrabRects.get(window);

        const isResizingW = (grabOp & Meta.GrabOp.RESIZING_W) > 1;
        // Shift the tiledRect by the resize amount
        let newGrabbedTiledRectX = window.tiledRect.x + (grabbedsNewRect.x - grabbedsOldRect.x);
        // Switch the screenGap for a windowGap
        if (isResizingW && window.tiledRect.x === workArea.x)
            newGrabbedTiledRectX = newGrabbedTiledRectX + screenLeftGap - windowGap / 2;

        // Same as W but different orientation
        const isResizingN = (grabOp & Meta.GrabOp.RESIZING_N) > 1;
        let newGrabbedTiledRectY = window.tiledRect.y + (grabbedsNewRect.y - grabbedsOldRect.y);
        if (isResizingN && window.tiledRect.y === workArea.y)
            newGrabbedTiledRectY = newGrabbedTiledRectY + screenTopGap - windowGap / 2;

        // If resizing on the E side, you can simply rely on get_frame_rect's
        // new width else x2 should stick to where it was (manual calc due
        // special cases like gnome-terminal)
        const isResizingE = (grabOp & Meta.GrabOp.RESIZING_E) > 1;
        const newGrabbedTiledRectWidth = isResizingE
            ? grabbedsNewRect.width + windowGap / 2 + (workArea.x === newGrabbedTiledRectX ? screenLeftGap : windowGap / 2)
            : window.tiledRect.x2 - newGrabbedTiledRectX;

        // Same principal applies to the height and resizing on the S side
        const isResizingS = (grabOp & Meta.GrabOp.RESIZING_S) > 1;
        const newGrabbedTiledRectHeight = isResizingS
            ? grabbedsNewRect.height + windowGap / 2 + (workArea.y === newGrabbedTiledRectY ? screenTopGap : windowGap / 2)
            : window.tiledRect.y2 - newGrabbedTiledRectY;

        const grabbedsOldTiledRect = window.tiledRect;
        window.tiledRect = new Rect(
            newGrabbedTiledRectX,
            newGrabbedTiledRectY,
            newGrabbedTiledRectWidth,
            newGrabbedTiledRectHeight
        );

        // Now calculate the new tiledRects for the windows, which were resized
        // along the window based on the diff of the window's tiledRect pre
        // and after the grab.
        const tiledRectDiffX = window.tiledRect.x - grabbedsOldTiledRect.x;
        const tiledRectDiffY = window.tiledRect.y - grabbedsOldTiledRect.y;
        const tiledRectDiffWidth = window.tiledRect.width - grabbedsOldTiledRect.width;
        const tiledRectDiffHeight = window.tiledRect.height - grabbedsOldTiledRect.height;

        this._resizeOps.forEach((resizeOp, win) => {
            if (win === window)
                return;

            if (resizeOp.side & Side.SAME_H) {
                win.tiledRect.x += tiledRectDiffX;
                win.tiledRect.width += tiledRectDiffWidth;
            } else if (resizeOp.side & Side.OPPOSING_H) {
                win.tiledRect.x += isResizingE ? tiledRectDiffWidth : 0;
                win.tiledRect.width -= tiledRectDiffWidth;
            }

            if (resizeOp.side & Side.SAME_V) {
                win.tiledRect.y += tiledRectDiffY;
                win.tiledRect.height += tiledRectDiffHeight;
            } else if (resizeOp.side & Side.OPPOSING_V) {
                win.tiledRect.y += isResizingS ? tiledRectDiffHeight : 0;
                win.tiledRect.height -= tiledRectDiffHeight;
            }
        });

        this._preGrabRects.clear();
        this._resizeOps.clear();
    }

    _onResizing(resizedWindow, grabOpV, grabOpH) {
        this._resizeOps.forEach((resizeOp, window) => {
            const rectV = this._getPassiveResizedRect(grabOpV, resizedWindow, window,
                resizeOp.side & Side.SAME_V, resizeOp.side & Side.OPPOSING_V);

            const rectH = this._getPassiveResizedRect(grabOpH, resizedWindow, window,
                resizeOp.side & Side.SAME_H, resizeOp.side & Side.OPPOSING_H);

            if (rectV && rectH)
                window.move_resize_frame(false, rectH[0], rectV[1], rectH[2], rectV[3]);
            else if (rectV)
                window.move_resize_frame(false, ...rectV);
            else if (rectH)
                window.move_resize_frame(false, ...rectH);
        });
    }

    // Gets the rect for the non-grabbed window adapted to the resized
    // grabbed window *but* only adapted for 1 side (either vertically
    // or horizontally) at a time based on grabOp
    _getPassiveResizedRect(grabOp, resizedWindow, window,
            resizeOnSameSide, resizeOnOpposingSide) {
        if (!grabOp)
            return null;

        if (!resizeOnSameSide && !resizeOnOpposingSide)
            return null;

        const resizedRect = new Rect(resizedWindow.get_frame_rect());
        const wRect = new Rect(window.get_frame_rect());
        const preGrabRect = this._preGrabRects.get(window);
        const windowGap = Settings.getInt(Settings.WINDOW_GAP);

        switch (grabOp) {
            case Meta.GrabOp.RESIZING_N:
                return resizeOnSameSide
                    ? [wRect.x, resizedRect.y, wRect.width, preGrabRect.y2 - resizedRect.y]
                    : [wRect.x, wRect.y, wRect.width, resizedRect.y - wRect.y - windowGap];

            case Meta.GrabOp.RESIZING_S:
                return resizeOnSameSide
                    ? [wRect.x, wRect.y, wRect.width, resizedRect.y2 - preGrabRect.y]
                    : [wRect.x, resizedRect.y2 + windowGap, wRect.width, preGrabRect.y2 - resizedRect.y2 - windowGap];

            case Meta.GrabOp.RESIZING_W:
                return resizeOnSameSide
                    ? [resizedRect.x, wRect.y, preGrabRect.x2 - resizedRect.x, wRect.height]
                    : [wRect.x, wRect.y, resizedRect.x - wRect.x - windowGap, wRect.height];

            case Meta.GrabOp.RESIZING_E:
                return resizeOnSameSide
                    ? [wRect.x, wRect.y, resizedRect.x2 - preGrabRect.x, wRect.height]
                    : [resizedRect.x2 + windowGap, wRect.y, preGrabRect.x2 - resizedRect.x2 - windowGap, wRect.height];
        }
    }
};

/**
 * Saves information on which side a window will resize to complement the
 * grabbed window. A non-grabbed window can resize on the 'same side', on
 * the 'opposing side' or not at all. For ex.: Resizing the top-left quarter
 * on the E side means the bottom-left quarter resizes on the same side (E)
 * and the top / bottom-right quarters resize on the opposing side (W). If
 * the bottom window wasn't quartered but instead had its width equal the
 * workArea.width, then it wouldn't resize at all.
 */
const ResizeOp = class ResizeOp {
    /**
     * @param {number} side
     */
    constructor(side) {
        this.side = side;
    }

    /**
     * @param {boolean} resizeOnSameSideV
     * @param {boolean} resizeOnOpposingSideV
     * @param {boolean} resizeOnSameSideH
     * @param {boolean} resizeOnOpposingSideH
     * @returns {ResizeOp|null}
     */
    static createResizeOp(resizeOnSameSideV, resizeOnOpposingSideV,
            resizeOnSameSideH, resizeOnOpposingSideH) {
        let verticalResizeSide = Side.NONE;
        let horizontalResizeSide = Side.NONE;

        if (resizeOnSameSideV)
            verticalResizeSide = Side.SAME_V;
        else if (resizeOnOpposingSideV)
            verticalResizeSide = Side.OPPOSING_V;

        if (resizeOnSameSideH)
            horizontalResizeSide = Side.SAME_H;
        else if (resizeOnOpposingSideH)
            horizontalResizeSide = Side.OPPOSING_H;

        const resizeSide = verticalResizeSide | horizontalResizeSide;
        return resizeSide ? new ResizeOp(resizeSide) : null;
    }
};
