export const FLAG_ASPECT_RATIO = 3 / 2;

// Keep the pole inside the outer edge of the unit's circular HP ring while
// leaving as much horizontal room as possible for the cloth.
export const UNIT_FLAG_LAYOUT = Object.freeze({
    poleX: -15,
    poleTop: -32,
    poleBottom: 2,
    clothOffsetX: 1,
    clothOffsetY: 2,
    width: 18,
    height: 12
});

// City flags are one third larger than unit flags on both axes.
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

// Village flags sit between unit and city size — large enough for the cloth
// flag renderer, small enough to not compete with the nearest city standard.
export const VILLAGE_FLAG_LAYOUT = Object.freeze({
    poleTopOffset: -18,
    poleBottomOffset: 10,
    clothOffsetX: 1.5,
    clothOffsetY: 1,
    baseWidth: 5.5,
    baseHeight: 3,
    width: 20,
    height: 13
});
