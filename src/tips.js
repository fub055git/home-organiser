// Static organising tips, keyed by roomType. Bundled with the app: not in
// IndexedDB, not user-editable, not exported in a backup.

// Ensuite and bathroom get the same advice, so the array is defined once and
// both keys point at it rather than duplicating the text.
const WASHROOM = [
  'Daily-use items only on open shelves and the vanity top; everything else in the cabinet or a lidded basket.',
  'One basket per category under the sink — haircare, first aid, cleaning.',
  'Decant bulk bottles into daily-use containers if shelf space is tight.',
];

export const TIPS = {
  bedroom: [
    'Cap bedside tables and dresser tops at about three items each.',
    'Under-bed storage is for out-of-season items only, never a "sort later" zone.',
    'One tray for pocket contents, jewellery and watch.',
  ],
  wardrobe: [
    'Zone by garment type, not by person.',
    'Hang by type, then by colour.',
    'At each season change, anything unworn the full prior season goes to a "decide" box, not back on the rail.',
    'Keep the floor clear except for a shoe rack.',
  ],
  ensuite: WASHROOM,
  bathroom: WASHROOM,
  toilet: [
    'Minimal by design: spare toilet paper in a small basket, nothing else stored here.',
  ],
  kitchen: [
    'Zone by task — prep, cooking, servingware — not by item type.',
    'One "everything drawer" is fine. Do not let it become two.',
    'Pantry: front-fill new stock behind old, so the oldest gets used first.',
  ],
  dining: [
    'The table is a reset-to-zero daily surface.',
  ],
  living: [
    'One catch-all tray or basket per recurring category — remotes, chargers — instead of spread across surfaces.',
  ],
  linen_cupboard: [
    'Store each sheet set inside one of its own pillowcases.',
    'Shelve by use frequency: least-used items like spare doonas go top or bottom, not at reach height.',
  ],
  garage: [
    'Zone each shelf by category — tools, sports and camping, chemicals and paint, seasonal — one clear purpose per shelf.',
    'Chemicals and paint go on the shelf furthest from any heat source.',
    'Signal for adding another shelf: regularly double-stacking to fit things, not simply having the space.',
  ],
  utility_cupboard: [
    'Vertical and hanging storage only.',
    'Over-door hooks or a wall bracket for broom, mop and ironing board, to keep the floor clear.',
  ],
};

/**
 * Tips for a room type, or an empty array.
 *
 * hasOwn rather than a bare TIPS[roomType]: every object inherits properties
 * like "constructor" and "toString", so a plain lookup can return something
 * that was never a tip. roomType is validated on the way in, so this cannot
 * currently happen -- it is one line to make sure it never can.
 */
export const tipsFor = (roomType) =>
  roomType && Object.hasOwn(TIPS, roomType) ? TIPS[roomType] : [];
