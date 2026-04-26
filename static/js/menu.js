/* ===== CANONICAL MENU DATA (D22)
   File: static/js/menu.js
   Single source of truth for Blu's Barbeque menu items, prices, and categories.
   Loaded before the main script block in index.html.
   Also referenced by: static/js/quote-revise.js (window.MENU lookup)
   Server-side copy: api/_lib/menu.js — keep prices in sync when editing here.
   ===== */
window.MENU = {
  meats: [
    { id:'brisket-sliced',      name:'Brisket (sliced)',             unit:'lbs',        price:31.99 },
    { id:'brisket-chopped',     name:'Brisket (chopped)',            unit:'lbs',        price:31.99 },
    { id:'pulled-pork',         name:'Pulled Pork',                  unit:'lbs',        price:22.99 },
    { id:'sausage-pb',          name:'Sausage (pork & beef)',        unit:'lbs',        price:22.99 },
    { id:'sausage-bj',          name:'Sausage (beef & jalapeño)',    unit:'lbs',        price:22.99 },
    { id:'chicken-quarter',     name:'Chicken - Quarter',            unit:'ea',         price:5.5   },
    { id:'chicken-half',        name:'Chicken - Half',               unit:'ea',         price:11    },
    { id:'chicken-whole',       name:'Chicken - Whole',              unit:'ea',         price:18    },
    { id:'chicken-quarter',     name:'Chicken - Quarter',            unit:'ea',         price:5.5,  requiresMeats:3 },
    { id:'burnt-ends-brisket',  name:'Burnt Ends (brisket)',         unit:'lbs',        price:31.99 },
    { id:'burnt-ends-pork',     name:'Burnt Ends (pork belly)',      unit:'lbs',        price:31.99 },
    { id:'rib-tips',            name:'Rib Tips',                     unit:'lbs',        price:24    },
    { id:'beef-rib',            name:'Beef Rib (dino)',              unit:'piece',      price:39    },
    { id:'turkey',              name:'Turkey (sliced)',               unit:'lbs',        price:28    },
    { id:'jalapeno-poppers',    name:'Jalapeño Poppers (brisket)',   unit:'piece',      price:5.5   },
  ],
  packages: [
    { id:'pkg-2meat', name:'2 Meat & 2 Sides (buffet)', unit:'per person', price:19.99 },
    { id:'pkg-3meat', name:'3 Meat & 2 Sides (buffet)', unit:'per person', price:23.99 },
    { id:'pkg-4meat', name:'4 Meat & 2 Sides (buffet)', unit:'per person', price:29.99 },
  ],
  sides: [
    { id:'mac-5cheese',     name:'5 Cheese Mac & Cheese',         unit:'half pan', price:55   },
    { id:'mac-bacon',       name:'Bacon & Jalapeño Mac',          unit:'half pan', price:65   },
    { id:'beans',           name:'Smoked Baked Beans',            unit:'half pan', price:45   },
    { id:'beans-loaded',    name:'Smoked Baked Beans Loaded',     unit:'half pan', price:55   },
    { id:'coleslaw',        name:'Cole Slaw',                     unit:'half pan', price:45   },
    { id:'potato-salad',    name:'Potato Salad',                  unit:'half pan', price:45   },
    { id:'collard-greens',  name:'Collard Greens',                unit:'half pan', price:45   },
    { id:'stuffed-potato',  name:'Stuffed Baked Potato',          unit:'piece',    price:12.5 },
  ],
  desserts: [
    { id:'banana-pudding',  name:'Banana Pudding',                    unit:'half pan', price:45 },
    { id:'bread-pudding',   name:'Tipsy Campfire Bread Pudding',      unit:'half pan', price:55 },
    { id:'sweet-potato',    name:'Sweet Potato Casserole',            unit:'half pan', price:55 },
    { id:'peach-cobbler',   name:'Peach Cobbler',                     unit:'half pan', price:45 },
    { id:'caramel-apple',   name:'Caramel Apple Cobbler',             unit:'half pan', price:45 },
    { id:'bourbon-cherry',  name:'Bourbon Cherry Cobbler',            unit:'half pan', price:45 },
  ],
  drinks: [
    { id:'sweet-tea',  name:'Sweet Tea',     unit:'gallon', price:9 },
    { id:'reg-tea',    name:'Regular Tea',   unit:'gallon', price:9 },
    { id:'lemonade',   name:'Lemonade',      unit:'gallon', price:9 },
    { id:'water',      name:'Water',         unit:'gallon', price:5 },
  ],
  extras: [
    { id:'plates-cutlery',  name:'Plates & Cutlery Kit',  unit:'per person', price:3.5  },
    { id:'cutlery',         name:'Cutlery Kit',            unit:'per person', price:1.75 },
    { id:'plates',          name:'Plates',                 unit:'per person', price:1.75 },
    { id:'bbq-sauce-hp',    name:'BBQ Sauce (half pan)',   unit:'half pan',   price:45   },
    { id:'buns',            name:'Buns',                   unit:'each',       price:0.65 },
    { id:'bread-loaf',      name:'White Bread Loaf',       unit:'each',       price:8    },
  ],
};
