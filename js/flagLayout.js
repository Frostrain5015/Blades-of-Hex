export const FLAG_ASPECT_RATIO = 3 / 2;

// Keep the pole inside the outer edge of the unit's circular HP ring while
// leaving as much horizontal room as possible for the cloth.
export const UNIT_FLAG_LAYOUT = Object.freeze({
    poleX: -15,
    poleTop: -30,
    poleBottom: 2,
    clothOffsetX: 1,
    clothOffsetY: 2,
    width: 15,
    height: 10
});

// City ownership should read at a glance, so its flag is one third larger on
// both axes than a unit flag while preserving the same 3:2 national-flag ratio.
export const CITY_FLAG_LAYOUT = Object.freeze({
    poleTopOffset: -18,
    poleBottomOffset: 10,
    clothOffsetX: 1.5,
    clothOffsetY: 1,
    baseWidth: 7,
    baseHeight: 4,
    width: 24,
    height: 16
});
