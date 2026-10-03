import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { prisma } from "./db.js";
import menuRoutes from "./menuRoutes.js";
import orderRoutes from "./orderRoutes.js";

const app = express();

app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      ok: true,
      service: "inminutes-assignment",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      ok: false,
      service: "inminutes-assignment",
      database: "disconnected",
    });
  }
});

app.use("/api", menuRoutes);
app.use("/api", orderRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found.",
  });
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
