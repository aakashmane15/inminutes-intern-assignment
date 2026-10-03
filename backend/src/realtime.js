import { WebSocketServer } from "ws";
import { prisma } from "./db.js";

const clients = new Set();
const pendingEventsByClient = new Map();

const menuSelect = {
  id: true,
  name: true,
  description: true,
  pricePaise: true,
  stock: true,
  version: true,
};

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

function sendJson(socket, message) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

async function loadSnapshot() {
  const [menu, orders] = await Promise.all([
    prisma.menuItem.findMany({
      where: {
        active: true,
      },
      orderBy: {
        name: "asc",
      },
      select: menuSelect,
    }),

    prisma.order.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: orderSelect,
    }),
  ]);

  return {
    menu,
    orders,
  };
}

export function broadcast(message) {
  for (const socket of clients) {
    const pendingEvents = pendingEventsByClient.get(socket);

    if (pendingEvents) {
      // The client is still receiving its initial snapshot. Send the event
      // after that snapshot instead of letting it arrive first.
      pendingEvents.push(message);
    } else {
      sendJson(socket, message);
    }
  }
}

export function attachWebSocketServer(server) {
  const webSocketServer = new WebSocketServer({
    server,
    path: "/ws",
  });

  webSocketServer.on("connection", (socket) => {
    clients.add(socket);

    // Buffer events until the initial snapshot has been sent.
    pendingEventsByClient.set(socket, []);

    socket.on("close", () => {
      clients.delete(socket);
      pendingEventsByClient.delete(socket);
    });

    socket.on("error", (error) => {
      console.error("WebSocket error:", error.message);
      clients.delete(socket);
      pendingEventsByClient.delete(socket);
    });

    loadSnapshot()
      .then((snapshot) => {
        if (socket.readyState !== 1) {
          return;
        }

        sendJson(socket, {
          type: "snapshot",
          data: snapshot,
        });

        const pendingEvents = pendingEventsByClient.get(socket) ?? [];

        // Do this synchronously after sending the snapshot. New events will
        // be sent directly after we remove this client from the buffer map.
        pendingEventsByClient.delete(socket);

        for (const event of pendingEvents) {
          sendJson(socket, event);
        }
      })
      .catch((error) => {
        console.error("Could not load WebSocket snapshot:", error);

        sendJson(socket, {
          type: "error",
          message: "Could not load the initial data.",
        });

        socket.close(1011, "Could not load initial data");
      });
  });

  return webSocketServer;
}
