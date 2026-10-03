import { useCallback, useEffect, useMemo, useState } from "react";
import { getMenu, getOrder, submitOrder } from "./api.js";

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});

const statusLabels = {
  NEW: "New",
  COOKING: "Cooking",
  READY: "Ready",
  PICKED_UP: "Picked up",
};

function formatPrice(pricePaise) {
  // Prices are stored as integer minor units; divide by 100 for display.
  return currencyFormatter.format(pricePaise / 100);
}

function mergeMenuItems(currentItems, incomingItems) {
  const incomingById = new Map(incomingItems.map((item) => [item.id, item]));
  const currentIds = new Set(currentItems.map((item) => item.id));

  const mergedItems = currentItems.map((currentItem) => {
    const incomingItem = incomingById.get(currentItem.id);

    if (!incomingItem) {
      return currentItem;
    }

    // Don't let an older stock version overwrite a newer one.
    if (incomingItem.version < currentItem.version) {
      return currentItem;
    }

    return {
      ...currentItem,
      ...incomingItem,
    };
  });

  for (const incomingItem of incomingItems) {
    if (!currentIds.has(incomingItem.id)) {
      mergedItems.push(incomingItem);
    }
  }

  return mergedItems.sort((a, b) => a.name.localeCompare(b.name));
}

export default function App() {
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState({});
  const [currentOrder, setCurrentOrder] = useState(null);
  const [message, setMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("Connecting");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState(null);

  const applyMenuUpdates = useCallback((items) => {
    if (!Array.isArray(items)) {
      return;
    }

    setMenu((currentItems) => mergeMenuItems(currentItems, items));
  }, []);

  const applyOrderUpdate = useCallback((incomingOrder) => {
    if (!incomingOrder?.id) {
      return;
    }

    setCurrentOrder((currentOrderValue) => {
      if (
        currentOrderValue?.id === incomingOrder.id &&
        currentOrderValue.version > incomingOrder.version
      ) {
        return currentOrderValue;
      }

      return incomingOrder;
    });
  }, []);

  const handleServerMessage = useCallback(
    (serverMessage) => {
      if (serverMessage.type === "snapshot") {
        const data = serverMessage.data ?? {};

        applyMenuUpdates(data.menu ?? []);

        const savedOrderId = localStorage.getItem("lastOrderId");
        const savedOrder = data.orders?.find(
          (order) => order.id === savedOrderId,
        );

        if (savedOrder) {
          applyOrderUpdate(savedOrder);
        }

        return;
      }

      if (serverMessage.type === "order.placed") {
        applyMenuUpdates(serverMessage.stock ?? []);

        const savedOrderId = localStorage.getItem("lastOrderId");

        if (serverMessage.order?.id === savedOrderId) {
          applyOrderUpdate(serverMessage.order);
        }

        return;
      }

      if (serverMessage.type === "order.status.changed") {
        const savedOrderId = localStorage.getItem("lastOrderId");

        if (serverMessage.order?.id === savedOrderId) {
          applyOrderUpdate(serverMessage.order);
        }

        return;
      }

      if (serverMessage.type === "error") {
        setMessage(serverMessage.message ?? "A live update error occurred.");
      }
    },
    [applyMenuUpdates, applyOrderUpdate],
  );

  useEffect(() => {
    let stopped = false;
    let socket = null;
    let reconnectTimer = null;

    // Load through REST as well, so the menu still appears if the WebSocket
    // is temporarily unavailable.
    getMenu()
      .then(applyMenuUpdates)
      .catch((error) => {
        setMessage(`Could not load the menu: ${error.message}`);
      });

    const savedOrderId = localStorage.getItem("lastOrderId");

    if (savedOrderId) {
      getOrder(savedOrderId)
        .then(applyOrderUpdate)
        .catch((error) => {
          if (error.status === 404) {
            localStorage.removeItem("lastOrderId");
          } else {
            console.error("Could not reload saved order:", error);
          }
        });
    }

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
  }, [applyMenuUpdates, applyOrderUpdate, handleServerMessage]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([itemId, quantity]) => {
        const menuItem = menu.find((item) => item.id === itemId);

        if (!menuItem) {
          return null;
        }

        return {
          ...menuItem,
          quantity,
        };
      })
      .filter(Boolean);
  }, [cart, menu]);

  const cartTotal = cartItems.reduce(
    (total, item) => total + item.pricePaise * item.quantity,
    0,
  );

  function changeQuantity(itemId, change) {
    setCart((currentCart) => {
      const nextCart = { ...currentCart };
      const nextQuantity = (nextCart[itemId] ?? 0) + change;

      if (nextQuantity <= 0) {
        delete nextCart[itemId];
      } else {
        nextCart[itemId] = Math.min(nextQuantity, 20);
      }

      return nextCart;
    });
  }

  async function handlePlaceOrder() {
    if (cartItems.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    // Reuse the key after a network failure so a retry cannot create a
    // second order. The server requires this value to be a UUID.
    const idempotencyKey = pendingIdempotencyKey ?? window.crypto.randomUUID();

    setPendingIdempotencyKey(idempotencyKey);

    const items = cartItems.map((item) => ({
      menuItemId: item.id,
      quantity: item.quantity,
    }));

    try {
      const result = await submitOrder(idempotencyKey, items);

      localStorage.setItem("lastOrderId", result.order.id);
      applyMenuUpdates(result.stock);
      setCurrentOrder(result.order);
      setCart({});
      setPendingIdempotencyKey(null);
      setMessage("Order placed. You can watch its status below.");
    } catch (error) {
      setMessage(error.message);

      if (error.status === 409) {
        // The WebSocket normally updates stock too. This REST refresh makes
        // the screen correct even if an event was missed.
        try {
          const latestMenu = await getMenu();
          applyMenuUpdates(latestMenu);
        } catch (refreshError) {
          console.error("Could not refresh menu after conflict:", refreshError);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Live Kitchen</p>
          <h1>Customer order</h1>
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

      <div className="columns">
        <section className="panel">
          <div className="section-heading">
            <h2>Menu</h2>
            <span>Stock updates automatically</span>
          </div>

          {menu.length === 0 ? (
            <p className="muted">Loading menu…</p>
          ) : (
            <div className="menu-list">
              {menu.map((item) => (
                <article className="menu-item" key={item.id}>
                  <div>
                    <h3>{item.name}</h3>
                    <p className="description">{item.description}</p>
                    <p className="item-meta">
                      {formatPrice(item.pricePaise)} ·{" "}
                      {item.stock > 0
                        ? `${item.stock} available`
                        : "Unavailable"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => changeQuantity(item.id, 1)}
                    disabled={item.stock === 0}
                  >
                    Add
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel cart-panel">
          <div className="section-heading">
            <h2>Your cart</h2>
            <span>{cartItems.length} item types</span>
          </div>

          {cartItems.length === 0 ? (
            <p className="muted">Your cart is empty.</p>
          ) : (
            <>
              <div className="cart-list">
                {cartItems.map((item) => (
                  <div className="cart-item" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <p className="item-meta">
                        {formatPrice(item.pricePaise)} each
                        {item.stock < item.quantity && (
                          <span className="warning">
                            {" "}
                            · only {item.stock} currently available
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="quantity-controls">
                      <button
                        type="button"
                        aria-label={`Remove one ${item.name}`}
                        onClick={() => changeQuantity(item.id, -1)}
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        aria-label={`Add one ${item.name}`}
                        onClick={() => changeQuantity(item.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="cart-total">
                <span>Total</span>
                <strong>{formatPrice(cartTotal)}</strong>
              </div>
            </>
          )}

          <button
            className="place-order-button"
            type="button"
            onClick={handlePlaceOrder}
            disabled={cartItems.length === 0 || isSubmitting}
          >
            {isSubmitting ? "Placing order…" : "Place order"}
          </button>
        </section>
      </div>

      {currentOrder && (
        <section className="panel order-status">
          <div>
            <p className="eyebrow">Your latest order</p>
            <h2>Order {currentOrder.id.slice(0, 8)}</h2>
          </div>

          <div>
            <span className="status-pill">
              {statusLabels[currentOrder.status] ?? currentOrder.status}
            </span>
            <p className="muted">Status updates appear here automatically.</p>
          </div>
        </section>
      )}
    </main>
  );
}
