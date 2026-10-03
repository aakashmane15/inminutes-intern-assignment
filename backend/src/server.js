import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { prisma } from "./db.js";

const app = express();

app.use(express.json());

app.get("/api/health", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    response.json({
      ok: true,
      service: "live-kitchen-api",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    response.status(503).json({
      ok: false,
      service: "live-kitchen-api",
      database: "disconnected",
    });
  }
});

const server = createServer(app);

const webSocketServer = new WebSocketServer({
  server,
  path: "/ws",
});

webSocketServer.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "connected",
    }),
  );
});

const port = Number(process.env.PORT ?? 3000);

server.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
