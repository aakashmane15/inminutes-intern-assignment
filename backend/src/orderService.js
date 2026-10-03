import { prisma } from "./db.js";

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

export class OrderError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function getExistingOrder(idempotencyKey) {
  const order = await prisma.order.findUnique({
    where: {
      idempotencyKey,
    },
    select: orderSelect,
  });

  if (!order) {
    return null;
  }

  const itemIds = order.items.map((item) => item.menuItemId);

  const stock = await prisma.menuItem.findMany({
    where: {
      id: {
        in: itemIds,
      },
    },
    select: {
      id: true,
      stock: true,
      version: true,
    },
  });

  return {
    order,
    stock,
    replayed: true,
  };
}

export async function placeOrder({ idempotencyKey, items }) {
  // A successful previous request with this key should not consume stock again.
  const existingOrder = await getExistingOrder(idempotencyKey);

  if (existingOrder) {
    return existingOrder;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // This order row is created inside the transaction. If a stock update
      // fails, the order row and every previous stock update are rolled back.
      const newOrder = await tx.order.create({
        data: {
          idempotencyKey,
        },
        select: {
          id: true,
        },
      });

      const stockChanges = [];

      for (const item of items) {
        const updatedItems = await tx.$queryRaw`
          UPDATE "menu_items"
          SET
            "stock" = "stock" - ${item.quantity},
            "version" = "version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${item.menuItemId}
            AND "active" = true
            AND "stock" >= ${item.quantity}
          RETURNING
            "id",
            "name",
            "price_paise",
            "stock",
            "version"
        `;

        if (updatedItems.length === 0) {
          const currentItem = await tx.menuItem.findUnique({
            where: {
              id: item.menuItemId,
            },
          });

          if (!currentItem || !currentItem.active) {
            throw new OrderError(
              409,
              "ITEM_UNAVAILABLE",
              "This menu item is not available.",
              {
                itemId: item.menuItemId,
                requested: item.quantity,
                available: 0,
              },
            );
          }

          throw new OrderError(
            409,
            "INSUFFICIENT_STOCK",
            `Not enough stock for ${currentItem.name}.`,
            {
              itemId: currentItem.id,
              itemName: currentItem.name,
              requested: item.quantity,
              available: currentItem.stock,
            },
          );
        }

        const updatedItem = updatedItems[0];

        // Use the name and price from the database, not from the request.
        await tx.orderItem.create({
          data: {
            orderId: newOrder.id,
            menuItemId: updatedItem.id,
            nameAtOrder: updatedItem.name,
            pricePaise: updatedItem.price_paise,
            quantity: item.quantity,
          },
        });

        stockChanges.push({
          id: updatedItem.id,
          stock: updatedItem.stock,
          version: updatedItem.version,
        });
      }

      const order = await tx.order.findUnique({
        where: {
          id: newOrder.id,
        },
        select: orderSelect,
      });

      return {
        order,
        stock: stockChanges,
        replayed: false,
      };
    });
  } catch (error) {
    // Two retries with the same key can arrive at nearly the same time.
    // The unique database constraint lets one create the order; the other
    // retrieves that already-created order here.
    if (error?.code === "P2002") {
      const existingOrder = await getExistingOrder(idempotencyKey);

      if (existingOrder) {
        return existingOrder;
      }
    }

    throw error;
  }
}

const nextStatusByCurrentStatus = {
  NEW: "COOKING",
  COOKING: "READY",
  READY: "PICKED_UP",
  PICKED_UP: null,
};

export async function advanceOrder({ orderId, nextStatus, expectedVersion }) {
  return prisma.$transaction(async (tx) => {
    const currentOrder = await tx.order.findUnique({
      where: {
        id: orderId,
      },
      select: {
        status: true,
        version: true,
      },
    });

    if (!currentOrder) {
      throw new OrderError(404, "ORDER_NOT_FOUND", "Order not found.");
    }

    if (currentOrder.version !== expectedVersion) {
      throw new OrderError(
        409,
        "STALE_ORDER",
        "This order changed on another screen. Refresh it and try again.",
        {
          currentStatus: currentOrder.status,
          currentVersion: currentOrder.version,
        },
      );
    }

    const allowedNextStatus = nextStatusByCurrentStatus[currentOrder.status];

    if (allowedNextStatus !== nextStatus) {
      throw new OrderError(
        409,
        "INVALID_TRANSITION",
        `An order in ${currentOrder.status} cannot move to ${nextStatus}.`,
        {
          currentStatus: currentOrder.status,
          currentVersion: currentOrder.version,
        },
      );
    }

    const updateResult = await tx.order.updateMany({
      where: {
        id: orderId,
        status: currentOrder.status,
        version: expectedVersion,
      },
      data: {
        status: nextStatus,
        version: {
          increment: 1,
        },
        updatedAt: new Date(),
      },
    });

    if (updateResult.count !== 1) {
      const latestOrder = await tx.order.findUnique({
        where: {
          id: orderId,
        },
        select: {
          status: true,
          version: true,
        },
      });

      throw new OrderError(
        409,
        "STALE_ORDER",
        "This order changed on another screen. Refresh it and try again.",
        {
          currentStatus: latestOrder?.status ?? currentOrder.status,
          currentVersion: latestOrder?.version ?? currentOrder.version,
        },
      );
    }

    return tx.order.findUnique({
      where: {
        id: orderId,
      },
      select: orderSelect,
    });
  });
}
