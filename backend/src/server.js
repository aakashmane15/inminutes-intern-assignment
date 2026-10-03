import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const app = express();

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "inminutes-assignment",
  });
});

const server = createServer(app);

const webSockerServer = new WebSocketServer({
  server,
  path: "/ws",
});

webSockerServer.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "connected",
    }),
  );
});

const port = Number(process.env.PORT ?? 3000);

server.listen(port, "0.0.0.0", () => {
  console.log(`${port}`);
});
