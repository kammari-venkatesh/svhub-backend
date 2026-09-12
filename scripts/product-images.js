/**
 * product-images.js
 * One unique, product-relevant professional hero image per catalog slug.
 * Gallery is always [hero] only — no irrelevant secondary shots.
 */

const u = (id, w = 1200) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`
const p = (id, w = 1200) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`

/** @type {Record<string, string>} */
export const productImages = {
  // ── Pickles & Thokku / pastes ───────────────────────────────────────────────
  'vadu-maangai-pickle': p('7263017'), // jarred Indian pickle
  'vadu-maanga-thokku': u('photo-1591073113125-e46713c829ed'), // mangoes
  'tomato-thokku': u('photo-1546094096-0df4bcaaa337'), // tomatoes
  'ginger-thokku': u('photo-1576045057995-568f588f82fb'), // ginger
  'mango-thokku': u('photo-1553279768-865429fa0078'), // mango fruit
  'mango-ginger-thokku': u('photo-1605027990121-cbae9e0642df'), // mango cut
  'garlic-sweet-hot-pickle': u('photo-1543362906-acfc16c67564'), // garlic
  'ginger-garlic-paste': p('4198017'), // ginger/garlic spice prep
  'curry-leaves-thokku': p('4198023'), // green spice herbs
  'karuveppilai-thokku': p('1172675'), // leafy herbs
  'naatu-malli-thokku': u('photo-1506368249639-73a05d6f6488'), // herb market
  'nutmeg-jaathikai-thokku': p('1435904'), // whole spices
  'pirandai-thokku':
    'https://upload.wikimedia.org/wikipedia/commons/a/a3/Amla_Pickles.jpg',
  'pulikaichal': u('photo-1585937421612-70a008356fbe'), // South Indian gravy
  'small-onion-thokku': u('photo-1518977676601-b53f82aba655'), // onions
  'sprouted-venthayam-thokku': u('photo-1515543904379-3d757afe72e4'), // sprouts
  'vaazhaipoo-thokku': u('photo-1571771894821-ce9b6c11b08e'), // tropical produce
  'vallarai-thokku': p('1656663'), // fresh greens
  'vatha-kuzhambu-paste': u('photo-1565557623262-b51c2513a641'), // curry bowl
  'venthaya-thokku': p('2802527'), // spice powders

  // ── Spice powders & masalas ────────────────────────────────────────────────
  'briyani-masala': u('photo-1563379091339-03b21ab4a4f8'), // biryani
  'chat-masala': p('4198019'),
  'chilli-powder': u('photo-1583454110551-21f2fa2afe61'), // red chillies
  'coriander-powder': p('4198015'),
  'cumin-powder': p('6287295'),
  'garam-masala': p('6287298'),
  'kulambu-chilli-powder': p('6287524'),
  'paneer-butter-masala': u('photo-1631452180519-c014fe946bc7'), // paneer curry
  'peri-peri-snack-seasoning': p('4198021'),
  'rasam-powder': u('photo-1546833999-b9f581a1996d'), // dal/rasam bowl
  'sambar-powder': u('photo-1601050690597-df0568f70950'), // sambar spices
  'turmeric-powder': u('photo-1615485290382-441e4d049cb5'), // turmeric roots

  // ── Seasonings ─────────────────────────────────────────────────────────────
  'cream-onion-powder': u('photo-1508747703725-719777637510'),
  'noodles-masala': u('photo-1569718212165-3a8278d5f624'),
  'pasta-seasoning': u('photo-1621996346565-e3dbc646d9a9'),
  'peri-peri-seasoning': u('photo-1604908176997-125f25cc6f3d'),

  // ── Idli podi ──────────────────────────────────────────────────────────────
  'ellu-idli-podi': p('4110251'), // sesame / seed powder
  'idli-podi-regular': p('4110256'), // dry spice blend
  'karuveppilai-idli-podi': u('photo-1596040033229-a9821ebd058d'), // spice bowls
  'murungai-idli-podi': p('2255935'), // leafy greens / drumstick vibe
  'paruppu-podi': u('photo-1586201375761-83865001e31c'), // lentils

  // ── Health & wellness ──────────────────────────────────────────────────────
  'beetroot-nutrimix': p('244393'), // beetroot
  'healthmix': u('photo-1498837167922-ddd27525d352'), // healthy greens bowl
  'multimillet-muesli': p('1092730'), // granola / muesli bowl

  // ── Native rice ────────────────────────────────────────────────────────────
  'karuppu-kavuni-rice': u('photo-1536304993881-ff6e9eefa2a6'), // rice bowl
  'kullakar-rice':
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A_colorful_Paddy_field.JPG/1280px-A_colorful_Paddy_field.JPG',
  'mappillai-samba-rice': p('723198'), // rice grains
  'security-test-product-prod': u('photo-1516684669134-de6f7c473a2a'), // cooked rice

  // ── Handmade soaps ─────────────────────────────────────────────────────────
  'hibiscus-soap': p('33155255'),
  'kasthuri-manjal-soap': p('1340116'),
  'kuppaimeni-soap': p('6621463'),
  'multanimitti-soap': p('6621464'),
  'sweet-basil-soap': p('4750274'),
  'vettiver-soap': p('4041392'),

  // ── Sweets, savouries, meals ────────────────────────────────────────────────
  'athirasam': p('16062642'),
  'mysore-pak': u('photo-1571115177098-24ec42ed204d'),
  'murukku': p('12865863'),
  'thattai': u('photo-1599490659213-e2b9527bd087'),
  'idiyappam-meal': p('5560763'),
}
