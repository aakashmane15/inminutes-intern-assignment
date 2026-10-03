import { randomUUID } from "node:crypto";

const baseUrl = (process.env.API_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

const itemId = process.env.RACE_ITEM_ID ?? "last-unit-special";
const requestCount = Number(process.env.RACE_REQUESTS ?? 10);

if (!Number.isInteger(requestCount) || requestCount < 2 || requestCount > 50) {
  console.error("RACE_REQUESTS must be an integer between 2 and 50.");
  process.exit(1);
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Request to ${url} failed with HTTP ${response.status}`);
  }

  return body;
}

async function runRace() {
  const menuBefore = await getJson(`${baseUrl}/api/menu`);
  const itemBefore = menuBefore.find((item) => item.id === itemId);

  if (!itemBefore) {
    throw new Error(`Could not find menu item "${itemId}".`);
  }

  if (itemBefore.stock !== 1) {
    throw new Error(
      `Expected "${itemId}" to have stock 1, but found ${itemBefore.stock}. ` +
        "Run npm run db:seed, then try again.",
    );
  }

  const ordersBefore = await getJson(`${baseUrl}/api/orders`);

  console.log(
    `Sending ${requestCount} concurrent requests for the one unit of "${itemId}".`,
  );

  const results = await Promise.all(
    Array.from({ length: requestCount }, async () => {
      const response = await fetch(`${baseUrl}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          items: [
            {
              menuItemId: itemId,
              quantity: 1,
            },
          ],
        }),
      });

      let body = null;

      try {
        body = await response.json();
      } catch {
        // Keep the result so an unexpected non-JSON response is reported below.
      }

      return {
        status: response.status,
        code: body?.code ?? "",
        orderId: body?.order?.id ?? "",
      };
    }),
  );

  const successfulOrders = results.filter((result) => result.status === 201);
  const stockConflicts = results.filter(
    (result) => result.status === 409 && result.code === "INSUFFICIENT_STOCK",
  );
  const unexpectedResults = results.filter(
    (result) =>
      result.status !== 201 &&
      !(result.status === 409 && result.code === "INSUFFICIENT_STOCK"),
  );

  const menuAfter = await getJson(`${baseUrl}/api/menu`);
  const itemAfter = menuAfter.find((item) => item.id === itemId);
  const ordersAfter = await getJson(`${baseUrl}/api/orders`);

  const ordersCreated = ordersAfter.length - ordersBefore.length;

  console.table(results);

  console.log(`Successful orders: ${successfulOrders.length}`);
  console.log(`Insufficient-stock responses: ${stockConflicts.length}`);
  console.log(`Unexpected responses: ${unexpectedResults.length}`);
  console.log(`Stock after race: ${itemAfter?.stock}`);
  console.log(`New orders created: ${ordersCreated}`);

  const passed =
    successfulOrders.length === 1 &&
    stockConflicts.length === requestCount - 1 &&
    unexpectedResults.length === 0 &&
    itemAfter?.stock === 0 &&
    ordersCreated === 1;

  if (!passed) {
    console.error("FAIL: the results did not match the expected invariant.");
    process.exitCode = 1;
    return;
  }

  console.log("PASS: one order succeeded; stock did not go below zero.");
}

runRace().catch((error) => {
  console.error("Race check could not complete:", error.message);
  process.exitCode = 1;
});
