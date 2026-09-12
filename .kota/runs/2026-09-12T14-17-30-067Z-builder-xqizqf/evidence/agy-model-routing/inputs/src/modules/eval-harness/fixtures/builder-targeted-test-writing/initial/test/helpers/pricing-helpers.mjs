export function item(label, unitCents, quantity = 1) {
  return { label, unitCents, quantity };
}

export function order({ tier = "standard", items }) {
  return {
    customer: { tier },
    items,
  };
}
