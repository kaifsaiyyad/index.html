
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const Razorpay = require("razorpay");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

const KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");

function razorpayClient() {
  return new Razorpay({
    key_id: KEY_ID.value(),
    key_secret: KEY_SECRET.value()
  });
}

function validSignature(received, expected) {
  if (typeof received !== "string" || !/^[a-f0-9]{64}$/i.test(received)) {
    return false;
  }
  const a = Buffer.from(received, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.createPaymentOrder = onCall(
  { secrets: [KEY_ID, KEY_SECRET] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required.");
    }

    const amount = request.data?.amount;
    if (!Number.isInteger(amount) || amount < 1 || amount > 5000) {
      throw new HttpsError("invalid-argument", "Amount must be ₹1–₹5000.");
    }

    const order = await razorpayClient().orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: crypto.randomUUID()
    });

    await db.collection("paymentRequests").doc(order.id).create({
      uid: request.auth.uid,
      amount,
      status: "created",
      razorpayOrderId: order.id,
      createdAt: FieldValue.serverTimestamp()
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: KEY_ID.value()
    };
  }
);

async function creditCapturedPayment(orderId, paymentId) {
  const orderRef = db.collection("paymentRequests").doc(orderId);
  const orderSnap = await orderRef.get();

  if (!orderSnap.exists) {
    throw new Error("Order record not found.");
  }

  const orderData = orderSnap.data();
  const payment = await razorpayClient().payments.fetch(paymentId);

  if (
    payment.order_id !== orderId ||
    payment.status !== "captured" ||
    payment.currency !== "INR" ||
    payment.amount !== orderData.amount * 100
  ) {
    throw new Error("Payment is not captured or details do not match.");
  }

  await db.runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderRef);
    if (!freshOrder.exists) throw new Error("Order record missing.");

    if (freshOrder.data().status === "credited") {
      if (freshOrder.data().razorpayPaymentId === paymentId) return;
      throw new Error("Order already credited with another payment.");
    }

    const uid = freshOrder.data().uid;
    const walletRef = db.collection("wallets").doc(uid);
    const ledgerRef = db.collection("transactions").doc(paymentId);

    const walletSnap = await tx.get(walletRef);
    const ledgerSnap = await tx.get(ledgerRef);

    if (ledgerSnap.exists) {
      throw new Error("Payment already recorded.");
    }

    const balance = walletSnap.exists
      ? Number(walletSnap.data().balance || 0)
      : 0;

    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new Error("Wallet balance is invalid.");
    }

    tx.set(walletRef, {
      balance: balance + freshOrder.data().amount,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    tx.create(ledgerRef, {
      uid,
      amount: freshOrder.data().amount,
      type: "wallet_credit",
      status: "completed",
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      createdAt: FieldValue.serverTimestamp()
    });

    tx.update(orderRef, {
      status: "credited",
      razorpayPaymentId: paymentId,
      creditedAt: FieldValue.serverTimestamp()
    });
  });
}

exports.verifyPayment = onCall(
  { secrets: [KEY_ID, KEY_SECRET] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required.");
    }

    const { orderId, paymentId, signature } = request.data || {};

    if (
      typeof orderId !== "string" ||
      typeof paymentId !== "string" ||
      typeof signature !== "string"
    ) {
      throw new HttpsError("invalid-argument", "Invalid payment details.");
    }

    const orderRef = db.collection("paymentRequests").doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists || orderSnap.data().uid !== request.auth.uid) {
      throw new HttpsError("permission-denied", "Order not found.");
    }

    const expected = crypto.createHmac("sha256", KEY_SECRET.value())
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (!validSignature(signature, expected)) {
      throw new HttpsError("permission-denied", "Invalid payment signature.");
    }

    try {
      await creditCapturedPayment(orderId, paymentId);
      return { success: true, message: "Payment verified." };
    } catch (error) {
      throw new HttpsError("failed-precondition", error.message);
    }
  }
);

exports.processPaymentWebhook = onRequest(
  { secrets: [KEY_ID, KEY_SECRET, WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const signature = req.get("x-razorpay-signature");
    if (!signature || !req.rawBody) {
      res.status(400).send("Missing webhook signature/body");
      return;
    }

    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET.value())
      .update(req.rawBody)
      .digest("hex");

    if (!validSignature(signature, expected)) {
      res.status(401).send("Invalid webhook signature");
      return;
    }

    let event;
    try {
      event = JSON.parse(req.rawBody.toString("utf8"));
    } catch {
      res.status(400).send("Invalid JSON");
      return;
    }

    if (event.event !== "payment.captured") {
      res.status(200).send("Event ignored");
      return;
    }

    const payment = event.payload?.payment?.entity;
    const orderId = payment?.order_id;
    const paymentId = payment?.id;

    if (!orderId || !paymentId) {
      res.status(400).send("Missing payment identifiers");
      return;
    }

    try {
      await creditCapturedPayment(orderId, paymentId);
      res.status(200).send("Payment processed");
    } catch (error) {
      console.error("Webhook processing failed:", error.message);
      res.status(500).send("Payment processing failed; retry webhook");
    }
  }
);
