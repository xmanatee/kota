const PRODUCTS = {
  "notebook-pro": {
    label: "Notebook Pro",
    baseMinor: 4500,
    giftWrapMinor: 1000,
  },
  "pocket-pen": {
    label: "Pocket Pen",
    baseMinor: 1200,
    giftWrapMinor: 400,
  },
};

function getProduct(sku) {
  const product = PRODUCTS[sku];
  if (!product) {
    throw new Error(`unknown sku: ${sku}`);
  }
  return product;
}

module.exports = { getProduct };
