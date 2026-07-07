const PRODUCTS = {
  notebook: {
    sku: "notebook",
    label: "Notebook",
    priceCents: 1200,
  },
  pen: {
    sku: "pen",
    label: "Pen",
    priceCents: 250,
  },
  planner: {
    sku: "planner",
    label: "Planner",
    priceCents: 2800,
  },
};

const SERVICES = {
  "gift-wrap": {
    sku: "svc-gift-wrap",
    label: "Gift wrap",
    priceCents: 499,
  },
};

export function getProduct(sku) {
  const product = PRODUCTS[sku];
  if (product === undefined) {
    throw new Error(`Unknown product sku: ${sku}`);
  }
  return product;
}

export function getService(serviceId) {
  return SERVICES[serviceId] ?? null;
}

export function listCatalogSkus() {
  return Object.keys(PRODUCTS).sort();
}
