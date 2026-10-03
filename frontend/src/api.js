async function readJson(response) {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error ?? `Request failed: ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

export async function getMenu() {
  const response = await fetch("/api/menu");
  return readJson(response);
}

export async function getOrder(orderId) {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
  return readJson(response);
}

export async function submitOrder(idempotencyKey, items) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ items }),
  });

  return readJson(response);
}

export async function getOrders() {
  const response = await fetch("/api/orders");
  return readJson(response);
}

export async function updateOrderStatus(orderId, nextStatus, expectedVersion) {
  const response = await fetch(
    `/api/orders/${encodeURIComponent(orderId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nextStatus,
        expectedVersion,
      }),
    },
  );

  return readJson(response);
}
