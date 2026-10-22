
const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
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

    if (
      !orderSnap.exists ||
      orderSnap.data().uid !== request.auth.uid
    ) {
      throw new HttpsError("permission-denied", "Order not found.");
    }

    const expected = crypto.createHmac("sha256", KEY_SECRET.value())
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const received = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      received.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(received, expectedBuffer)
    ) {
      throw new HttpsError("permission-denied", "Invalid signature.");
    }

    const payment = await razorpayClient().payments.fetch(paymentId);
    const amount = orderSnap.data().amount;

    if (
      payment.order_id !== orderId ||
      payment.status !== "captured" ||
      payment.currency !== "INR" ||
      payment.amount !== amount * 100
    ) {
      throw new HttpsError("failed-precondition", "Payment not confirmed.");
    }

    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(orderRef);

      if (fresh.data()?.status === "credited") return;
      if (fresh.data()?.uid !== request.auth.uid) {
        throw new HttpsError("permission-denied", "Order owner mismatch.");
      }

      const creditRef = db.collection("transactions").doc(paymentId);
      const creditSnap = await tx.get(creditRef);
      if (creditSnap.exists) {
        throw new HttpsError("already-exists", "Payment already processed.");
      }

      const walletRef = db.collection("wallets").doc(request.auth.uid);
      const walletSnap = await tx.get(walletRef);
      const oldBalance = walletSnap.exists
        ? Number(walletSnap.data().balance || 0)
        : 0;

      if (!Number.isFinite(oldBalance) || oldBalance < 0) {
        throw new HttpsError("internal", "Invalid wallet balance.");
      }

      tx.set(walletRef, {
        balance: oldBalance + amount,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      tx.create(creditRef, {
        uid: request.auth.uid,
        amount,
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

    return { success: true, message: "Payment verified." };
  }
);

exports.processPaymentWebhook = onRequest(
  { secrets: [WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const signature = req.get("x-razorpay-signature");
    if (!signature || !req.rawBody) {
      res.status(400).send("Missing signature/body");
      return;
    }

    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET.value())
      .update(req.rawBody)
      .digest("hex");

    const received = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      received.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(received, expectedBuffer)
    ) {
      res.status(401).send("Invalid webhook signature");
      return;
    }

    // Webhook authentication only. Do not credit from an unprocessed event.
    res.status(200).send("Webhook signature verified");
  }
);
