/**
 * seed-products.js
 * Seed MongoDB with all 27 SV Hub products.
 * Run: node scripts/seed-products.js
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { Product } from '../src/models/Product.js'

const MONGO_URI = process.env.MONGO_URI
const MONGO_DB = process.env.MONGO_DB || 'svhub'

// â"€â"€â"€ Image URLs (same as frontend data/images.js) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const pexels = (id, w) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`
const unsplash = (id, w) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`

const img = {
  kullakar: unsplash('photo-1673158191698-f1550a68c422', 1000),
  kavuni: pexels('4110255', 1000),
  samba: pexels('4110256', 1000),
  thokku: 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Amla_Pickles.jpg',
  pickles: 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Amla_Pickles.jpg',
  masalas: pexels('2802527', 1200),
  ingredients: pexels('2802527', 1200),
  kasthuriManjal: pexels('1340116', 1000),
  vettiver: pexels('6621463', 1000),
  hibiscus: pexels('33155255', 800),
  kuppaimeni: pexels('1172675', 1000),
  sweetBasil: pexels('4750274', 1000),
  multanimitti: pexels('6621464', 1000),
  sweets: pexels('16062642', 1200),
  savouries: pexels('12865863', 1200),
  meals: pexels('5560763', 1200),
}

const gallery = {
  rice: [
    img.kullakar,
    unsplash('photo-1673158191698-f1550a68c422', 1200),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A_colorful_Paddy_field.JPG/1280px-A_colorful_Paddy_field.JPG',
    pexels('14132109', 1200),
  ],
  pickle: [
    img.pickles,
    pexels('14132109', 1200),
    pexels('2802527', 1200),
  ],
  masala: [
    img.masalas,
    pexels('2802527', 1200),
    pexels('14132109', 1200),
  ],
  soap: [
    pexels('6621464', 1200),
    pexels('1172675', 900),
    pexels('1340116', 1200),
  ],
  sweets: [img.sweets, pexels('14132109', 1200), pexels('2802527', 1200)],
  savouries: [img.savouries, pexels('14132109', 1200), pexels('2802527', 1200)],
  meals: [img.meals, pexels('14132109', 1200)],
}

// â"€â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function makeVariants(basePrice, baseOriginalPrice, weight, skuBase, extraWeights = []) {
  const variants = []
  const allWeights = [{ label: weight, factor: 1, suffix: '' }, ...extraWeights]

  allWeights.forEach(({ label, factor, suffix }, idx) => {
    const price = Math.round((basePrice * factor) / 10) * 10
    const originalPrice = baseOriginalPrice
      ? Math.round((baseOriginalPrice * factor) / 10) * 10
      : null
    const discount =
      originalPrice && originalPrice > price
        ? Math.round(((originalPrice - price) / originalPrice) * 100)
        : null
    const weightStr = label
    const variantId = label.replace(/\s+/g, '').toLowerCase()

    variants.push({
      variantId,
      label,
      weight: weightStr,
      sku: `${skuBase}${suffix || `-${variantId.toUpperCase()}`}`,
      price,
      originalPrice,
      discount,
      qty: idx === 0 ? 50 : 30,
      isActive: true,
    })
  })

  return variants
}

// â"€â"€â"€ Product Definitions â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const PRODUCTS = [
  // â"€â"€ Native Rice â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  {
    name: 'Kullakar Rice',
    slug: 'kullakar-rice',
    type: 'Native Rice',
    storefront: 'nutri-hub',
    category: 'native-rice',
    description:
      'Kullakar is a traditional native rice grown in Tamil Nadu and cooked in homes for everyday meals. The grain is small, with a warm, earthy flavour that sits comfortably beside sambar, kuzhambu and simple vegetable sides.',
    ingredients: ['Kullakar rice'],
    specifications: [
      { label: 'Origin', value: 'Tamil Nadu' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Form', value: 'Unpolished native rice' },
      { label: 'Best for', value: 'Everyday meals' },
      { label: 'Storage', value: 'Keep in a cool, dry place in an airtight tin' },
    ],
    image: img.kullakar,
    gallery: gallery.rice,
    price: 249,
    originalPrice: null,
    discount: null,
    weight: '500 g',
    sku: 'SVH-NH-KUL-500',
    qty: 100,
    isFeatured: true,
    variants: makeVariants(249, null, '500 g', 'SVH-NH-KUL', [
      { label: '1 kg', factor: 1.85, suffix: '-1KG' },
    ]),
  },
  {
    name: 'Karuppu Kavuni Rice',
    slug: 'karuppu-kavuni-rice',
    type: 'Native Rice',
    storefront: 'nutri-hub',
    category: 'native-rice',
    description:
      'Karuppu Kavuni is a dark native rice known in Tamil kitchens for festive and everyday cooking. The grain cooks to a soft, slightly sticky texture and is often served with coconut, jaggery or simple savoury sides.',
    ingredients: ['Karuppu Kavuni rice'],
    specifications: [
      { label: 'Origin', value: 'Tamil Nadu' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Form', value: 'Unpolished native rice' },
      { label: 'Best for', value: 'Festive and everyday cooking' },
      { label: 'Storage', value: 'Keep in a cool, dry place in an airtight tin' },
    ],
    image: img.kavuni,
    gallery: gallery.rice,
    price: 289,
    originalPrice: 329,
    discount: 12,
    weight: '500 g',
    sku: 'SVH-NH-KKV-500',
    qty: 80,
    isFeatured: true,
    variants: makeVariants(289, 329, '500 g', 'SVH-NH-KKV', [
      { label: '1 kg', factor: 1.85, suffix: '-1KG' },
    ]),
  },
  {
    name: 'Mappillai Samba Rice',
    slug: 'mappillai-samba-rice',
    type: 'Native Rice',
    storefront: 'nutri-hub',
    category: 'native-rice',
    description:
      'Mappillai Samba is a robust native rice with a distinctive aroma. It is a staple grain in many Tamil households, cooked as everyday rice or used in traditional preparations.',
    ingredients: ['Mappillai Samba rice'],
    specifications: [
      { label: 'Origin', value: 'Tamil Nadu' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Form', value: 'Unpolished native rice' },
      { label: 'Best for', value: 'Everyday rice and traditional dishes' },
      { label: 'Storage', value: 'Keep in a cool, dry place in an airtight tin' },
    ],
    image: img.samba,
    gallery: gallery.rice,
    price: 269,
    originalPrice: null,
    discount: null,
    weight: '500 g',
    sku: 'SVH-NH-MSB-500',
    qty: 60,
    isFeatured: false,
    variants: makeVariants(269, null, '500 g', 'SVH-NH-MSB', [
      { label: '1 kg', factor: 1.85, suffix: '-1KG' },
    ]),
  },
  // â"€â"€ Pickles & Thokku â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  {
    name: 'Venthaya Thokku',
    slug: 'venthaya-thokku',
    type: 'Pickle / Thokku',
    storefront: 'nutri-hub',
    category: 'pickles',
    description:
      'A traditional fenugreek thokku made in small batches with a familiar home-kitchen taste. Spoon it beside rice, curd rice or dosa â€" the way it is eaten in many Tamil homes.',
    ingredients: ['Fenugreek', 'Tamarind', 'Sesame oil', 'Red chilli', 'Salt', 'Traditional spices'],
    specifications: [
      { label: 'Style', value: 'Small-batch thokku' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Texture', value: 'Thick, spoonable pickle' },
      { label: 'Storage', value: 'Refrigerate after opening. Use a dry spoon.' },
      { label: 'Shelf life', value: 'See date on the jar' },
    ],
    image: img.thokku,
    gallery: gallery.pickle,
    price: 189,
    originalPrice: null,
    discount: null,
    weight: '200 g',
    sku: 'SVH-NH-VTH-200',
    qty: 40,
    isFeatured: true,
    variants: makeVariants(189, null, '200 g', 'SVH-NH-VTH', [
      { label: '400 g', factor: 1.8, suffix: '-400G' },
    ]),
  },
  {
    name: 'Tomato Thokku',
    slug: 'tomato-thokku',
    type: 'Pickle / Thokku',
    storefront: 'nutri-hub',
    category: 'pickles',
    description:
      'Slow-cooked tomato thokku with a tangy, savoury finish. Made in the traditional pickle style for the everyday table â€" rice, dosa, idli or a simple sandwich.',
    ingredients: ['Tomato', 'Tamarind', 'Sesame oil', 'Red chilli', 'Salt', 'Traditional spices'],
    specifications: [
      { label: 'Style', value: 'Small-batch thokku' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Texture', value: 'Thick, spoonable pickle' },
      { label: 'Storage', value: 'Refrigerate after opening. Use a dry spoon.' },
      { label: 'Shelf life', value: 'See date on the jar' },
    ],
    image: img.thokku,
    gallery: gallery.pickle,
    price: 169,
    originalPrice: 199,
    discount: 15,
    weight: '200 g',
    sku: 'SVH-NH-TTH-200',
    qty: 8,
    isFeatured: false,
    variants: makeVariants(169, 199, '200 g', 'SVH-NH-TTH', [
      { label: '400 g', factor: 1.8, suffix: '-400G' },
    ]),
  },
  {
    name: 'Karuveppilai Thokku',
    slug: 'karuveppilai-thokku',
    type: 'Pickle / Thokku',
    storefront: 'nutri-hub',
    category: 'pickles',
    description:
      'A curry-leaf thokku prepared with sesame oil and spices, the way it is made in many Tamil homes. A spoonful brings the flavour of karuveppilai to plain rice or tiffin.',
    ingredients: ['Curry leaves', 'Sesame oil', 'Tamarind', 'Red chilli', 'Salt', 'Traditional spices'],
    specifications: [
      { label: 'Style', value: 'Small-batch thokku' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Texture', value: 'Thick, spoonable pickle' },
      { label: 'Storage', value: 'Refrigerate after opening. Use a dry spoon.' },
      { label: 'Shelf life', value: 'See date on the jar' },
    ],
    image: img.pickles,
    gallery: gallery.pickle,
    price: 179,
    originalPrice: null,
    discount: null,
    weight: '200 g',
    sku: 'SVH-NH-KTH-200',
    qty: 35,
    isFeatured: false,
    variants: makeVariants(179, null, '200 g', 'SVH-NH-KTH', [
      { label: '400 g', factor: 1.8, suffix: '-400G' },
    ]),
  },
  {
    name: 'Vadu Maanga Thokku',
    slug: 'vadu-maanga-thokku',
    type: 'Pickle / Thokku',
    storefront: 'nutri-hub',
    category: 'pickles',
    description:
      'Young mango thokku with a sharp, pickled flavour. Packed in jars for the pantry and meant to be eaten in small spoons with rice or tiffin.',
    ingredients: ['Young mango', 'Sesame oil', 'Red chilli', 'Salt', 'Mustard', 'Traditional spices'],
    specifications: [
      { label: 'Style', value: 'Small-batch thokku' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Texture', value: 'Chunky pickled thokku' },
      { label: 'Storage', value: 'Refrigerate after opening. Use a dry spoon.' },
      { label: 'Shelf life', value: 'See date on the jar' },
    ],
    image: img.thokku,
    gallery: gallery.pickle,
    price: 199,
    originalPrice: 229,
    discount: 13,
    weight: '200 g',
    sku: 'SVH-NH-VMG-200',
    qty: 45,
    isFeatured: false,
    variants: makeVariants(199, 229, '200 g', 'SVH-NH-VMG', [
      { label: '400 g', factor: 1.8, suffix: '-400G' },
    ]),
  },
  // â"€â"€ Masalas & Seasonings â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  {
    name: 'Garam Masala',
    slug: 'garam-masala',
    type: 'Masala',
    storefront: 'nutri-hub',
    category: 'masalas',
    description:
      'A house blend of whole spices, roasted and ground for everyday cooking. Stir it into gravies, dals and vegetable dishes at the end of cooking.',
    ingredients: ['Coriander', 'Cumin', 'Cinnamon', 'Cloves', 'Cardamom', 'Black pepper', 'Bay leaf'],
    specifications: [
      { label: 'Style', value: 'Freshly ground masala' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Use', value: 'Gravies, dals and everyday cooking' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place' },
    ],
    image: img.masalas,
    gallery: gallery.masala,
    price: 129,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-NH-GRM-100',
    qty: 70,
    isFeatured: false,
    variants: makeVariants(129, null, '100 g', 'SVH-NH-GRM', [
      { label: '250 g', factor: 2.3, suffix: '-250G' },
    ]),
  },
  {
    name: 'Chat Masala',
    slug: 'chat-masala',
    type: 'Masala',
    storefront: 'nutri-hub',
    category: 'masalas',
    description:
      'A tangy seasoning for fruit, chaat and salads. Ground in small batches so the flavour stays bright in the tin.',
    ingredients: ['Cumin', 'Black salt', 'Dried mango', 'Coriander', 'Chilli', 'Asafoetida'],
    specifications: [
      { label: 'Style', value: 'Freshly ground masala' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Use', value: 'Fruit, chaat and salads' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place' },
    ],
    image: img.ingredients,
    gallery: gallery.masala,
    price: 119,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-NH-CHT-100',
    qty: 55,
    isFeatured: false,
    variants: makeVariants(119, null, '100 g', 'SVH-NH-CHT', [
      { label: '250 g', factor: 2.3, suffix: '-250G' },
    ]),
  },
  {
    name: 'Noodles Masala',
    slug: 'noodles-masala',
    type: 'Masala',
    storefront: 'nutri-hub',
    category: 'masalas',
    description:
      'A savoury seasoning blend for noodles and stir-fried vegetables. Made for home cooking, not restaurant kits â€" simple spices, clearly listed.',
    ingredients: ['Coriander', 'Cumin', 'Chilli', 'Garlic', 'Onion', 'Salt', 'Traditional spices'],
    specifications: [
      { label: 'Style', value: 'Seasoning blend' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Use', value: 'Noodles and stir-fried vegetables' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place' },
    ],
    image: img.masalas,
    gallery: gallery.masala,
    price: 139,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-NH-NDL-100',
    qty: 0,
    isFeatured: false,
    variants: makeVariants(139, null, '100 g', 'SVH-NH-NDL', [
      { label: '250 g', factor: 2.3, suffix: '-250G' },
    ]).map((v, i) => ({ ...v, qty: i === 0 ? 0 : 0 })),
  },
  {
    name: 'Paneer Butter Masala',
    slug: 'paneer-butter-masala',
    type: 'Masala',
    storefront: 'nutri-hub',
    category: 'masalas',
    description:
      'A rich curry masala blend for the classic paneer butter masala. Balanced with kashmiri chilli and cream spices for a mild, crowd-pleasing finish.',
    ingredients: ['Kashmiri chilli', 'Coriander', 'Cumin', 'Cardamom', 'Fenugreek leaves', 'Salt'],
    specifications: [
      { label: 'Style', value: 'Freshly ground masala' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Use', value: 'Paneer butter masala and rich curries' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place' },
    ],
    image: img.masalas,
    gallery: gallery.masala,
    price: 149,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-NH-PBM-100',
    qty: 50,
    isFeatured: false,
    variants: makeVariants(149, null, '100 g', 'SVH-NH-PBM', [
      { label: '250 g', factor: 2.3, suffix: '-250G' },
    ]),
  },
  {
    name: 'Pasta Seasoning',
    slug: 'pasta-seasoning',
    type: 'Seasoning',
    storefront: 'nutri-hub',
    category: 'masalas',
    description:
      'A herb-forward seasoning blend for pasta and baked dishes. Rosemary, basil and oregano ground with a touch of chilli â€" no artificial colours or flavours.',
    ingredients: ['Oregano', 'Basil', 'Rosemary', 'Thyme', 'Chilli flakes', 'Salt'],
    specifications: [
      { label: 'Style', value: 'Herb blend seasoning' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Use', value: 'Pasta, pizza and baked dishes' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place' },
    ],
    image: img.ingredients,
    gallery: gallery.masala,
    price: 139,
    originalPrice: 159,
    discount: 13,
    weight: '100 g',
    sku: 'SVH-NH-PST-100',
    qty: 60,
    isFeatured: false,
    variants: makeVariants(139, 159, '100 g', 'SVH-NH-PST', [
      { label: '250 g', factor: 2.3, suffix: '-250G' },
    ]),
  },
  {
    name: 'Peri Peri Seasoning',
    slug: 'peri-peri-seasoning',
    type: 'Seasoning',
    storefront: 'nutri-hub',
    category: 'masalas',
    description:
      'A smoky, spiced seasoning for chips, grilled vegetables and snack bowls. The African bird\'s eye chilli base is blended with paprika and spices for a balanced heat.',
    ingredients: ['Bird\'s eye chilli', 'Paprika', 'Garlic', 'Lemon peel', 'Oregano', 'Salt'],
    specifications: [
      { label: 'Style', value: 'Spice seasoning' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Heat level', value: 'Medium-hot' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place' },
    ],
    image: img.masalas,
    gallery: gallery.masala,
    price: 129,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-NH-PPR-100',
    qty: 9,
    isFeatured: false,
    variants: makeVariants(129, null, '100 g', 'SVH-NH-PPR', [
      { label: '250 g', factor: 2.3, suffix: '-250G' },
    ]),
  },
  {
    name: 'Cream & Onion Powder',
    slug: 'cream-onion-powder',
    type: 'Seasoning',
    storefront: 'nutri-hub',
    category: 'masalas',
    description:
      'A classic snack seasoning with dried cream powder, onion and a hint of garlic. Sprinkle over chips or mix into dips for a familiar, crowd-favourite flavour.',
    ingredients: ['Dried cream powder', 'Onion', 'Garlic', 'Salt', 'Natural flavours'],
    specifications: [
      { label: 'Style', value: 'Snack seasoning' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Use', value: 'Chips, popcorn and snack dips' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place' },
    ],
    image: img.ingredients,
    gallery: gallery.masala,
    price: 119,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-NH-CON-100',
    qty: 45,
    isFeatured: false,
    variants: makeVariants(119, null, '100 g', 'SVH-NH-CON', [
      { label: '250 g', factor: 2.3, suffix: '-250G' },
    ]),
  },
  // â"€â"€ Handmade Soaps â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  {
    name: 'Kasthuri Manjal Soap',
    slug: 'kasthuri-manjal-soap',
    type: 'Handmade Soap',
    storefront: 'self-care',
    category: 'handmade-soaps',
    description:
      'A gentle soap made with kasthuri manjal (wild turmeric) â€" a traditional Tamil ingredient known for skin care. Cold-pressed and hand-cut in small batches.',
    ingredients: ['Wild turmeric', 'Coconut oil', 'Palm kernel oil', 'Castor oil', 'Lye', 'Rose water'],
    specifications: [
      { label: 'Method', value: 'Cold-pressed, hand-cut' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Skin type', value: 'All skin types' },
      { label: 'Shelf life', value: '12 months from manufacture' },
    ],
    image: img.kasthuriManjal,
    gallery: gallery.soap,
    price: 149,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-SC-KMJ-100',
    qty: 50,
    isFeatured: true,
    variants: makeVariants(149, null, '100 g', 'SVH-SC-KMJ'),
  },
  {
    name: 'Vettiver Soap',
    slug: 'vettiver-soap',
    type: 'Handmade Soap',
    storefront: 'self-care',
    category: 'handmade-soaps',
    description:
      'A cooling soap made with vettiver (khus) root extract, known for its earthy fragrance and traditional use in Tamil care routines. Handmade in cold-press batches.',
    ingredients: ['Vettiver root extract', 'Coconut oil', 'Castor oil', 'Shea butter', 'Lye'],
    specifications: [
      { label: 'Method', value: 'Cold-pressed, hand-cut' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Skin type', value: 'Normal to oily skin' },
      { label: 'Shelf life', value: '12 months from manufacture' },
    ],
    image: img.vettiver,
    gallery: gallery.soap,
    price: 159,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-SC-VTR-100',
    qty: 45,
    isFeatured: false,
    variants: makeVariants(159, null, '100 g', 'SVH-SC-VTR'),
  },
  {
    name: 'Hibiscus Soap',
    slug: 'hibiscus-soap',
    type: 'Handmade Soap',
    storefront: 'self-care',
    category: 'handmade-soaps',
    description:
      'A lightly floral soap made with hibiscus petal extract, known for its antioxidant properties. The pink colour is entirely natural from the flower.',
    ingredients: ['Hibiscus petal extract', 'Coconut oil', 'Castor oil', 'Almond oil', 'Lye'],
    specifications: [
      { label: 'Method', value: 'Cold-pressed, hand-cut' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Skin type', value: 'Dry to normal skin' },
      { label: 'Shelf life', value: '12 months from manufacture' },
    ],
    image: img.hibiscus,
    gallery: gallery.soap,
    price: 149,
    originalPrice: 179,
    discount: 17,
    weight: '100 g',
    sku: 'SVH-SC-HBS-100',
    qty: 9,
    isFeatured: false,
    variants: makeVariants(149, 179, '100 g', 'SVH-SC-HBS'),
  },
  {
    name: 'Kuppaimeni Soap',
    slug: 'kuppaimeni-soap',
    type: 'Handmade Soap',
    storefront: 'self-care',
    category: 'handmade-soaps',
    description:
      'A medicinal soap made with kuppaimeni leaf extract, a traditional herb used in Tamil Siddha medicine for skin care. Cold-pressed for maximum herbal benefit.',
    ingredients: ['Kuppaimeni leaf extract', 'Coconut oil', 'Neem oil', 'Castor oil', 'Lye'],
    specifications: [
      { label: 'Method', value: 'Cold-pressed, hand-cut' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Skin type', value: 'Acne-prone and oily skin' },
      { label: 'Shelf life', value: '12 months from manufacture' },
    ],
    image: img.kuppaimeni,
    gallery: gallery.soap,
    price: 149,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-SC-KPM-100',
    qty: 50,
    isFeatured: false,
    variants: makeVariants(149, null, '100 g', 'SVH-SC-KPM'),
  },
  {
    name: 'Sweet Basil Soap',
    slug: 'sweet-basil-soap',
    type: 'Handmade Soap',
    storefront: 'self-care',
    category: 'handmade-soaps',
    description:
      'A fresh, herbaceous soap made with sweet basil essential oil. Handmade in cold-press batches and left to cure for a mild, long-lasting bar.',
    ingredients: ['Sweet basil essential oil', 'Coconut oil', 'Shea butter', 'Castor oil', 'Lye'],
    specifications: [
      { label: 'Method', value: 'Cold-pressed, hand-cut' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Skin type', value: 'All skin types' },
      { label: 'Shelf life', value: '12 months from manufacture' },
    ],
    image: img.sweetBasil,
    gallery: gallery.soap,
    price: 159,
    originalPrice: null,
    discount: null,
    weight: '100 g',
    sku: 'SVH-SC-SWB-100',
    qty: 40,
    isFeatured: false,
    variants: makeVariants(159, null, '100 g', 'SVH-SC-SWB'),
  },
  {
    name: 'Multanimitti Soap',
    slug: 'multanimitti-soap',
    type: 'Handmade Soap',
    storefront: 'self-care',
    category: 'handmade-soaps',
    description:
      'A clay-based soap with multanimitti (Fuller\'s earth) that gently draws out impurities from the skin. A traditional ingredient reintroduced for everyday care.',
    ingredients: ['Fuller\'s earth (Multanimitti)', 'Coconut oil', 'Castor oil', 'Rose water', 'Lye'],
    specifications: [
      { label: 'Method', value: 'Cold-pressed, hand-cut' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Skin type', value: 'Oily to combination skin' },
      { label: 'Shelf life', value: '12 months from manufacture' },
    ],
    image: img.multanimitti,
    gallery: gallery.soap,
    price: 169,
    originalPrice: 199,
    discount: 15,
    weight: '100 g',
    sku: 'SVH-SC-MLT-100',
    qty: 9,
    isFeatured: false,
    variants: makeVariants(169, 199, '100 g', 'SVH-SC-MLT'),
  },
  // â"€â"€ Traditional Sweets â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  {
    name: 'Athirasam',
    slug: 'athirasam',
    type: 'Traditional Sweet',
    storefront: 'nutri-hub',
    category: 'sweets',
    description:
      'A traditional Tamil sweet made with rice flour, jaggery and cardamom. Deep-fried to a dark, crispy outside with a chewy centre â€" a festive favourite for generations.',
    ingredients: ['Rice flour', 'Jaggery', 'Cardamom', 'Coconut oil'],
    specifications: [
      { label: 'Type', value: 'Traditional Tamil sweet' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Storage', value: 'Store in an airtight container' },
      { label: 'Shelf life', value: '7â€"10 days' },
    ],
    image: img.sweets,
    gallery: gallery.sweets,
    price: 219,
    originalPrice: null,
    discount: null,
    weight: '250 g',
    sku: 'SVH-NH-ATH-250',
    qty: 30,
    isFeatured: false,
    variants: makeVariants(219, null, '250 g', 'SVH-NH-ATH', [
      { label: '500 g', factor: 1.8, suffix: '-500G' },
    ]),
  },
  {
    name: 'Mysore Pak',
    slug: 'mysore-pak',
    type: 'Traditional Sweet',
    storefront: 'nutri-hub',
    category: 'sweets',
    description:
      'A rich, crumbly sweet made with besan, ghee and sugar â€" the traditional Mysore way. Each piece is made in small batches for the correct texture: firm outside, melt-in-the-mouth inside.',
    ingredients: ['Besan (chickpea flour)', 'Ghee', 'Sugar', 'Cardamom'],
    specifications: [
      { label: 'Type', value: 'Traditional South Indian sweet' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Storage', value: 'Store in an airtight container' },
      { label: 'Shelf life', value: '10â€"14 days' },
    ],
    image: img.sweets,
    gallery: gallery.sweets,
    price: 249,
    originalPrice: 279,
    discount: 11,
    weight: '250 g',
    sku: 'SVH-NH-MYP-250',
    qty: 9,
    isFeatured: false,
    variants: makeVariants(249, 279, '250 g', 'SVH-NH-MYP', [
      { label: '500 g', factor: 1.8, suffix: '-500G' },
    ]),
  },
  // â"€â"€ Savouries â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  {
    name: 'Thattai',
    slug: 'thattai',
    type: 'Savoury',
    storefront: 'nutri-hub',
    category: 'savouries',
    description:
      'A crisp, disc-shaped savoury made with rice flour, urad dal and spices. Thattai is a Tamil tea-time snack made in homes for generations â€" best eaten the same day.',
    ingredients: ['Rice flour', 'Urad dal', 'Sesame seeds', 'Curry leaves', 'Chilli', 'Salt'],
    specifications: [
      { label: 'Type', value: 'Traditional Tamil savoury' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Storage', value: 'Store in an airtight container' },
      { label: 'Shelf life', value: '7â€"10 days' },
    ],
    image: img.savouries,
    gallery: gallery.savouries,
    price: 149,
    originalPrice: null,
    discount: null,
    weight: '200 g',
    sku: 'SVH-NH-THT-200',
    qty: 40,
    isFeatured: false,
    variants: makeVariants(149, null, '200 g', 'SVH-NH-THT', [
      { label: '400 g', factor: 1.8, suffix: '-400G' },
    ]),
  },
  {
    name: 'Murukku',
    slug: 'murukku',
    type: 'Savoury',
    storefront: 'nutri-hub',
    category: 'savouries',
    description:
      'A twisted rice flour snack seasoned with sesame, cumin and chilli. Homemade-style murukku made in small batches - the kind you will find in a Tamil pantry at Deepavali.',
    ingredients: ['Rice flour', 'Urad dal flour', 'Sesame seeds', 'Cumin', 'Butter', 'Salt'],
    specifications: [
      { label: 'Type', value: 'Traditional Tamil savoury' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Storage', value: 'Store in an airtight container' },
      { label: 'Shelf life', value: '10-14 days' },
    ],
    image: img.savouries,
    gallery: gallery.savouries,
    price: 159,
    originalPrice: null,
    discount: null,
    weight: '200 g',
    sku: 'SVH-NH-MRK-200',
    qty: 0,
    isFeatured: false,
    variants: makeVariants(159, null, '200 g', 'SVH-NH-MRK', [
      { label: '400 g', factor: 1.8, suffix: '-400G' },
    ]).map((v) => ({ ...v, qty: 0 })),
  },
  // --- Daily Meals -----------------------------------------------------------
  {
    name: 'Idiyappam Meal',
    slug: 'idiyappam-meal',
    type: 'Daily Meal',
    storefront: 'nutri-hub',
    category: 'daily-meals',
    description:
      'String hoppers served with coconut milk and a vegetable side - a light, traditional South Indian breakfast or dinner. Made fresh, packed for the same day.',
    ingredients: ['Rice flour', 'Water', 'Salt', 'Coconut milk', 'Vegetable side'],
    specifications: [
      { label: 'Type', value: 'Prepared daily meal' },
      { label: 'Packed in', value: 'Coimbatore' },
      { label: 'Serving', value: '1 person' },
      { label: 'Storage', value: 'Consume same day. Keep refrigerated.' },
    ],
    image: img.meals,
    gallery: gallery.meals,
    price: 189,
    originalPrice: null,
    discount: null,
    weight: '1 serve',
    sku: 'SVH-NH-IDY-1SV',
    qty: 20,
    isFeatured: false,
    variants: makeVariants(189, null, '1 serve', 'SVH-NH-IDY'),
  },
]

// â"€â"€â"€ Seed â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
async function seed() {
  console.log('Connecting to MongoDB...')
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB })
  console.log('Connected.')
  const existing = await Product.countDocuments()
  if (existing > 0) {
    console.log('Found ' + existing + ' existing products.')
    const args = process.argv.slice(2)
    if (!args.includes('--force')) {
      console.log('Products already exist. Use --force to reseed.')
      await mongoose.disconnect()
      return
    }
    console.log('--force: clearing products...')
    await Product.deleteMany({})
  }
  console.log('Seeding ' + PRODUCTS.length + ' products...')
  let inserted = 0
  for (const data of PRODUCTS) {
    try {
      await Product.create(data)
      console.log('  OK  ' + data.name)
      inserted++
    } catch (err) {
      console.error('  FAIL  ' + data.name + ': ' + err.message)
    }
  }
  console.log('Seed complete: ' + inserted + '/' + PRODUCTS.length + ' inserted.')
  await mongoose.disconnect()
}
seed().catch((err) => { console.error('Seed failed:', err); process.exit(1) })
