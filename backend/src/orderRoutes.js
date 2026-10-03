import { Router } from "express";
import { prisma } from "./db.js";
import { advanceOrder, OrderError, placeOrder } from "./orderService.js";
import { broadcast } from "./realtime.js";

const router = Router();

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validStatuses = new Set(["NEW", "COOKING", "READY", "PICKED_UP"]);

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
      pricePaise: true,
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

  return {
    items: [...quantitiesByItem.entries()]
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
      .sort((a, b) => a.menuItemId.localeCompare(b.menuItemId)),
  };
}

router.post("/orders", async (req, res) => {
  const idempotencyKey = req.get("Idempotency-Key");

  if (!idempotencyKey || !uuidPattern.test(idempotencyKey)) {
    return res.status(400).json({
      error: "Send a valid UUID in the Idempotency-Key header.",
    });
  }

  const normalized = normalizeItems(req.body?.items);

  if (normalized.error) {
    return res.status(400).json({
      error: normalized.error,
    });
  }

  try {
    const result = await placeOrder({
      idempotencyKey,
      items: normalized.items,
    });

    if (!result.replayed) {
      broadcast({
        type: "order.placed",
        order: result.order,
        stock: result.stock,
      });
    }

    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof OrderError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        ...error.details,
      });
    }

    console.error("Could not place order:", error);

    res.status(500).json({
      error: "Could not place order.",
    });
  }
});

router.patch("/orders/:id/status", async (req, res) => {
  const { id } = req.params;

  if (!uuidPattern.test(id)) {
    return res.status(400).json({
      error: "Order ID must be a valid UUID.",
    });
  }

  const { nextStatus, expectedVersion } = req.body ?? {};

  if (!validStatuses.has(nextStatus)) {
    return res.status(400).json({
      error: "nextStatus must be a valid order status.",
    });
  }

  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return res.status(400).json({
      error: "expectedVersion must be a positive integer.",
    });
  }

  try {
    const order = await advanceOrder({
      orderId: id,
      nextStatus,
      expectedVersion,
    });

    broadcast({
      type: "order.status.changed",
      order,
    });

    res.json(order);
  } catch (error) {
    if (error instanceof OrderError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        ...error.details,
      });
    }

    console.error("Could not update order status:", error);

    res.status(500).json({
      error: "Could not update order status.",
    });
  }
});

router.get("/orders", async (_req, res) => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: orderSelect,
    });

    res.json(orders);
  } catch (error) {
    console.error("Could not load orders:", error);

    res.status(500).json({
      error: "Could not load orders.",
    });
  }
});

router.get("/orders/:id", async (req, res) => {
  const { id } = req.params;

  if (!uuidPattern.test(id)) {
    return res.status(400).json({
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
      return res.status(404).json({
        error: "Order not found.",
      });
    }

    res.json(order);
  } catch (error) {
    console.error("Could not load order:", error);

    res.status(500).json({
      error: "Could not load order.",
    });
  }
});

export default router;
