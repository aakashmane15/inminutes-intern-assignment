import { Router } from "express";
import { prisma } from "./db.js";
import { OrderError, placeOrder } from "./orderService.js";

const router = Router();

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const orderSelect = {
  id: true,
  idempotencyKey: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      menuItemId: true,
      nameAtOrder: true,
      priceCents: true,
      quantity: true,
    },
  },
};

function normalizeItems(lines) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 20) {
    return {
      error: "Provide between 1 and 20 order lines.",
    };
  }

  const quantitiesByItem = new Map();

  for (const line of lines) {
    if (
      !line ||
      typeof line.menuItemId !== "string" ||
      line.menuItemId.trim().length === 0 ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1
    ) {
      return {
        error: "Each line needs a menuItemId and a positive integer quantity.",
      };
    }

    const menuItemId = line.menuItemId.trim();
    const totalQuantity =
      (quantitiesByItem.get(menuItemId) ?? 0) + line.quantity;

    if (totalQuantity > 20) {
      return {
        error: "A maximum of 20 units per menu item can be ordered.",
      };
    }

    quantitiesByItem.set(menuItemId, totalQuantity);
  }

  // Combine duplicate item lines and sort IDs. Sorting makes transactions
  // lock rows in the same order when carts contain multiple items.
  return {
    items: [...quantitiesByItem.entries()]
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
      .sort((a, b) => a.menuItemId.localeCompare(b.menuItemId)),
  };
}

router.post("/orders", async (request, response) => {
  const idempotencyKey = request.get("Idempotency-Key");

  if (!idempotencyKey || !uuidPattern.test(idempotencyKey)) {
    return response.status(400).json({
      error: "Send a valid UUID in the Idempotency-Key header.",
    });
  }

  const normalized = normalizeItems(request.body?.items);

  if (normalized.error) {
    return response.status(400).json({
      error: normalized.error,
    });
  }

  try {
    const result = await placeOrder({
      idempotencyKey,
      items: normalized.items,
    });

    response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof OrderError) {
      return response.status(error.status).json({
        code: error.code,
        error: error.message,
        ...error.details,
      });
    }

    console.error("Could not place order:", error);

    response.status(500).json({
      error: "Could not place order.",
    });
  }
});

router.get("/orders", async (_request, response) => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: orderSelect,
    });

    response.json(orders);
  } catch (error) {
    console.error("Could not load orders:", error);

    response.status(500).json({
      error: "Could not load orders.",
    });
  }
});

router.get("/orders/:id", async (request, response) => {
  const { id } = request.params;

  if (!uuidPattern.test(id)) {
    return response.status(400).json({
      error: "Order ID must be a valid UUID.",
    });
  }

  try {
    const order = await prisma.order.findUnique({
      where: {
        id,
      },
      select: orderSelect,
    });

    if (!order) {
      return response.status(404).json({
        error: "Order not found.",
      });
    }

    response.json(order);
  } catch (error) {
    console.error("Could not load order:", error);

    response.status(500).json({
      error: "Could not load order.",
    });
  }
});

export default router;
