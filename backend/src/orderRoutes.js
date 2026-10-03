import { Router } from "express";
import { prisma } from "./db.js";

const router = Router();

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const orderSelect = {
  id: true,
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
