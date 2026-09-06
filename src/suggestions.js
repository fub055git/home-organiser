// Common item names offered as autocomplete on the item Name field, grouped
// by the category they belong to.
//
// The grouping is the data: the flat suggestion list is derived from it, so a
// name can never drift out of sync with its category. Picking a suggested
// name proposes its category, which is what stops categories from being a
// field nobody ever fills in.
//
// Suggestions only: the field accepts anything, and nothing here is created
// unless you pick it.
//
// Scoped to a single-storey house, so there is nothing here for an attic,
// loft, under-stair cupboard or upstairs linen press.

export const SUGGESTION_GROUPS = {
  Tools: [
    'Angle grinder', 'Cable ties', 'Circular saw', 'Cordless drill', 'Drill bits',
    'Duct tape', 'Extension lead', 'Hammer', 'Hand saw', 'Ladder', 'Nails',
    'Padlock', 'Picture hooks', 'Pliers', 'Rope', 'Sandpaper', 'Screwdriver set',
    'Screws', 'Spanner set', 'Spirit level', 'Step ladder', 'Stud finder',
    'Super glue', 'Tape measure', 'Tarp', 'Toolbox', 'Wall plugs', 'WD-40',
    'Work light',
  ],
  Paint: [
    'Drop sheet', 'Metho', 'Paint brushes', 'Paint rollers', 'Paint tins',
    'Sealant', 'Silicone', 'Turps', 'Wood stain',
  ],
  Garden: [
    'Fertiliser', 'Garden fork', 'Garden gloves', 'Garden hose', 'Hedge trimmer',
    'Hose reel', 'Lawn mower', 'Leaf blower', 'Mulch', 'Plant pots', 'Potting mix',
    'Pressure washer', 'Rake', 'Secateurs', 'Seed packets', 'Shovel', 'Spade',
    'Sprinkler', 'Trowel', 'Watering can', 'Wheelbarrow', 'Whipper snipper',
  ],
  Camping: [
    'Air mattress', 'Bike helmets', 'Bike pump', 'Bikes', 'Camping chairs',
    'Camping stove', 'Camping table', 'Cricket set', 'Esky', 'Fishing rods',
    'Football', 'Gas bottle', 'Hand weights', 'Head torch', 'Picnic rug',
    'Sleeping bags', 'Surfboard', 'Tent', 'Yoga mat',
  ],
  Car: [
    'Car jack', 'Car wash kit', 'Chamois', 'Engine oil', 'Jerry can',
    'Jumper leads', 'Roof racks', 'Spare tyre', 'Tyre pump', 'Windscreen washer fluid',
  ],
  Cleaning: [
    'Bin liners', 'Bleach', 'Broom', 'Bucket', 'Cleaning sprays', 'Clothes airer',
    'Clothes pegs', 'Dishwasher tablets', 'Dustpan', 'Fly spray', 'Ironing board',
    'Laundry powder', 'Mop', 'Rags', 'Rubber gloves', 'Sponges', 'Vacuum cleaner',
  ],
  Kitchen: [
    'Air fryer', 'Baking trays', 'Blender', 'Cake tins', 'Casserole dish',
    'Chopping boards', 'Food processor', 'Kettle', 'Lunch boxes', 'Mixing bowls',
    'Servingware', 'Slow cooker', 'Spare crockery', 'Stand mixer', 'Tea towels',
    'Thermos', 'Toaster', 'Tupperware', 'Water bottles', 'Wine glasses',
  ],
  Linen: [
    'Beach towels', 'Blankets', 'Doona covers', 'Mattress protector',
    'Picnic blanket', 'Pillowcases', 'Pillows', 'Sheet sets', 'Spare doonas',
    'Towels',
  ],
  Wardrobe: [
    'Coat hangers', 'Shoe rack', 'Suitcases', 'Travel bags',
  ],
  Bathroom: [
    'First aid kit', 'Hair dryer', 'Insect repellent', 'Medicine box',
    'Spare toothbrushes', 'Sunscreen', 'Tissues', 'Toilet paper', 'Toiletries',
  ],
  Electrical: [
    'Batteries', 'HDMI cables', 'Headphones', 'Light bulbs', 'Phone chargers',
    'Power boards', 'Printer ink', 'Printer paper', 'Router', 'Spare remotes',
    'Torch', 'USB cables',
  ],
  Seasonal: [
    'Christmas decorations', 'Christmas lights', 'Christmas tree', 'Documents box',
    'Fans', 'Gift bags', 'Photo albums', 'Portable heater', 'Raincoats',
    'Spare keys', 'Umbrellas', 'Wrapping paper',
  ],
};

/** Flat list for the datalist, derived so it cannot drift from the groups. */
export const ITEM_SUGGESTIONS = Object.values(SUGGESTION_GROUPS).flat();

// Built once. Keyed on the trimmed, case-folded name so "cordless DRILL "
// still resolves.
const CATEGORY_BY_NAME = new Map(
  Object.entries(SUGGESTION_GROUPS).flatMap(([category, names]) =>
    names.map((name) => [name.trim().toLowerCase(), category])),
);

/** The category a suggested item belongs to, or null if the name is not one. */
export const categoryForItem = (name) =>
  CATEGORY_BY_NAME.get(String(name ?? '').trim().toLowerCase()) ?? null;
