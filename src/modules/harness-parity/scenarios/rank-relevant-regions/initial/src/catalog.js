const PRODUCTS = {
  "pilot-bag": {
    baseMinor: 4200,
    giftWrapMinor: 800,
  },
};

function getProduct(sku) {
  const product = PRODUCTS[sku];
  if (product === undefined) {
    throw new Error(`Unknown sku ${sku}`);
  }
  return product;
}

module.exports = { getProduct };
