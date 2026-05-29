const { quoteOrder } = require("./src/checkout.js");

const quote = quoteOrder({
  sku: "notebook-pro",
  destination: "GB",
  giftWrap: true,
});

for (const [key, value] of Object.entries(quote)) {
  console.log(`${key}=${value}`);
}
