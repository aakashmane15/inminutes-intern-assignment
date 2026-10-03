import { useCallback, useEffect, useState } from "react";
import { getOrders, updateOrderStatus } from "./api.js";

const stages = [
  { status: "NEW", title: "New" },
  { status: "COOKING", title: "Cooking" },
  { status: "READY", title: "Ready" },
  { status: "PICKED_UP", title: "Picked up" },
];

const nextStatusByCurrentStatus = {
  NEW: "COOKING",
  COOKING: "READY",
  READY: "PICKED_UP",
  PICKED_UP: null,
};

const actionLabelByNextStatus = {
  COOKING: "Start cooking",
  READY: "Mark ready",
  PICKED_UP: "Mark picked up",
};

// These are stage-age limits in seconds. Adjust them if you want
// to demonstrate the late badge without waiting several minutes.
const lateAfterSeconds = {
  NEW: 180,
  COOKING: 600,
  READY: 600,
};

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});

function formatPrice(pricePaise) {
  return currencyFormatter.format(pricePaise / 100);
}

function formatAge(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getAgeInSeconds(dateValue, now) {
  const timestamp = new Date(dateValue).getTime();

  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((now - timestamp) / 1000));
}

function mergeOrders(currentOrders, incomingOrders) {
  const ordersById = new Map(currentOrders.map((order) => [order.id, order]));

  for (const incomingOrder of incomingOrders) {
    const currentOrder = ordersById.get(incomingOrder.id);

    // Keep a newer version if an older REST result or buffered event arrives.
    if (!currentOrder || incomingOrder.version >= currentOrder.version) {
      ordersById.set(incomingOrder.id, incomingOrder);
    }
  }

  return [...ordersById.values()].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );
}

export default function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("Connecting");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(0);

  const applyOrders = useCallback((incomingOrders) => {
    if (!Array.isArray(incomingOrders)) {
      return;
    }

    setOrders((currentOrders) => mergeOrders(currentOrders, incomingOrders));
  }, []);

  const applyOrder = useCallback((incomingOrder) => {
    if (!incomingOrder?.id) {
      return;
    }

    setOrders((currentOrders) => mergeOrders(currentOrders, [incomingOrder]));
  }, []);

  const handleServerMessage = useCallback(
    (serverMessage) => {
      if (serverMessage.type === "snapshot") {
        applyOrders(serverMessage.data?.orders ?? []);
        return;
      }

      if (serverMessage.type === "order.placed") {
        applyOrder(serverMessage.order);
        return;
      }

      if (serverMessage.type === "order.status.changed") {
        applyOrder(serverMessage.order);
        return;
      }

      if (serverMessage.type === "error") {
        setMessage(serverMessage.message ?? "A live update error occurred.");
      }
    },
    [applyOrders, applyOrder],
  );

  useEffect(() => {
    let stopped = false;
    let socket = null;
    let reconnectTimer = null;

    getOrders()
      .then(applyOrders)
      .catch((error) => {
        setMessage(`Could not load orders: ${error.message}`);
      });

    function connect() {
      if (stopped) {
        return;
      }

      setConnectionStatus("Connecting");

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

      socket.addEventListener("open", () => {
        if (!stopped) {
          setConnectionStatus("Live");
        }
      });

      socket.addEventListener("message", (event) => {
        try {
          handleServerMessage(JSON.parse(event.data));
        } catch (error) {
          console.error("Could not read WebSocket message:", error);
        }
      });

      socket.addEventListener("close", () => {
        if (!stopped) {
          setConnectionStatus("Reconnecting");
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      });

      socket.addEventListener("error", () => {
        socket?.close();
      });
    }

    connect();

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [applyOrders, handleServerMessage]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  async function advanceOrder(order) {
    const nextStatus = nextStatusByCurrentStatus[order.status];

    if (!nextStatus) {
      return;
    }

    setMessage("");

    try {
      const updatedOrder = await updateOrderStatus(
        order.id,
        nextStatus,
        order.version,
      );

      applyOrder(updatedOrder);
    } catch (error) {
      setMessage(error.message);

      if (error.status === 409) {
        // The order may have changed on another kitchen screen.
        try {
          const latestOrders = await getOrders();
          applyOrders(latestOrders);
        } catch (refreshError) {
          console.error("Could not refresh the order board:", refreshError);
        }
      }
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Live Kitchen</p>
          <h1>Kitchen board</h1>
        </div>

        <div className="connection">
          <span
            className={`connection-dot ${
              connectionStatus === "Live" ? "connected" : ""
            }`}
          />
          Live updates: {connectionStatus}
        </div>
      </header>

      {message && (
        <div className="message" role="status">
          {message}
        </div>
      )}

      <div className="board-grid">
        {stages.map((stage) => {
          const stageOrders = orders.filter(
            (order) => order.status === stage.status,
          );

          return (
            <section className="stage-column" key={stage.status}>
              <div className="stage-heading">
                <h2>{stage.title}</h2>
                <span>{stageOrders.length}</span>
              </div>

              {stageOrders.length === 0 ? (
                <p className="muted">No orders</p>
              ) : (
                <div className="order-card-list">
                  {stageOrders.map((order) => {
                    const totalAge = getAgeInSeconds(order.createdAt, now);
                    const stageAge = getAgeInSeconds(order.updatedAt, now);
                    const threshold = lateAfterSeconds[order.status];
                    const isLate =
                      threshold !== undefined && stageAge >= threshold;
                    const nextStatus = nextStatusByCurrentStatus[order.status];

                    const orderTotal = order.items.reduce(
                      (sum, item) => sum + item.pricePaise * item.quantity,
                      0,
                    );

                    return (
                      <article
                        className={`order-card ${isLate ? "late" : ""}`}
                        key={order.id}
                      >
                        <div className="order-card-heading">
                          <strong>Order {order.id.slice(0, 8)}</strong>
                          <span className="order-version">
                            v{order.version}
                          </span>
                        </div>

                        <p className="order-age">
                          Total age: {formatAge(totalAge)}
                        </p>
                        <p className="order-age">
                          In this stage: {formatAge(stageAge)}
                        </p>

                        {isLate && (
                          <p className="late-badge">Taking longer than usual</p>
                        )}

                        <ul className="order-lines">
                          {order.items.map((item) => (
                            <li key={item.menuItemId}>
                              {item.quantity} × {item.nameAtOrder}
                            </li>
                          ))}
                        </ul>

                        <p className="order-total">
                          Total: {formatPrice(orderTotal)}
                        </p>

                        {nextStatus && (
                          <button
                            type="button"
                            onClick={() => advanceOrder(order)}
                          >
                            {actionLabelByNextStatus[nextStatus]}
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
