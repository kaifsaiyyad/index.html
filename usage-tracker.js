
/* =====================================================
   CSC SEVA TOOL
   CUSTOMER USAGE ANALYTICS TRACKER
   File: usage-tracker.js
   Version: 1.0.0
   ===================================================== */

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";


/* =====================================================
   1. FIREBASE CONFIGURATION
   ===================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyBTb8imcHpQdP90ntoawVJGXN72Tbmmi-s",
  authDomain: "kisan-seva-tools.firebaseapp.com",
  projectId: "kisan-seva-tools",
  appId: "1:900938868284:web:5a5b278506955fc0f48539"
};


/* =====================================================
   2. FIREBASE INITIALIZATION
   ===================================================== */

const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);


/* =====================================================
   3. VISITOR ID GENERATOR
   ===================================================== */

function createVisitorId() {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return "csc_" + crypto.randomUUID();
    }
  } catch (error) {
    console.warn("Visitor ID generation fallback.");
  }

  return (
    "csc_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

function getVisitorId() {
  const key = "csc_seva_visitor_id";

  try {
    let id = localStorage.getItem(key);

    if (!id) {
      id = createVisitorId();
      localStorage.setItem(key, id);
    }

    return id;

  } catch (error) {
    return createVisitorId();
  }
}

const visitorId = getVisitorId();


/* =====================================================
   4. TOOL INFORMATION
   ===================================================== */

function getToolInfo() {
  const path = decodeURIComponent(
    window.location.pathname
  );

  const fileName =
    path.split("/").pop() || "Unknown";

  const toolId = fileName
    .replace(/\.(html|htm)$/i, "")
    .slice(0, 80);

  const heading =
    document.querySelector("h1")?.textContent?.trim();

  const toolName = (
    heading ||
    document.title ||
    toolId ||
    "Unknown Tool"
  ).slice(0, 100);

  return {
    toolId: toolId || "Unknown",
    toolName,
    page: path.slice(0, 180)
  };
}


/* =====================================================
   5. AUTHENTICATION STATE
   ===================================================== */

let currentUser = null;
let authInitialized = false;

let resolveAuth;

const authReady = new Promise((resolve) => {
  resolveAuth = resolve;
});

const unsubscribeAuth = onAuthStateChanged(
  auth,

  (user) => {
    currentUser = user || null;

    if (!authInitialized) {
      authInitialized = true;
      resolveAuth(currentUser);
    }
  },

  (error) => {
    console.error(
      "CSC Seva Tool Auth Error:",
      error
    );

    if (!authInitialized) {
      authInitialized = true;
      resolveAuth(null);
    }
  }
);


/* =====================================================
   6. EVENT SAVE FUNCTION
   ===================================================== */

async function saveUsageEvent(
  eventType,
  actionLabel
) {
  try {
    await authReady;

    // Firestore tracking is for signed-in customers.
    if (!currentUser) {
      return {
        success: false,
        reason: "Customer is not logged in."
      };
    }

    const tool = getToolInfo();

    const eventData = {
      toolId: tool.toolId,

      toolName: tool.toolName,

      eventType: eventType,

      actionLabel: String(actionLabel).slice(0, 80),

      uid: currentUser.uid,

      visitorId: visitorId,

      page: tool.page,

      createdAt: serverTimestamp(),

      source: "website"
    };

    const documentRef = await addDoc(
      collection(db, "toolUsage"),
      eventData
    );

    console.log(
      "CSC Analytics Event Saved:",
      documentRef.id,
      eventType,
      actionLabel
    );

    return {
      success: true,
      eventId: documentRef.id
    };

  } catch (error) {
    console.error(
      "CSC Analytics Save Error:",
      error
    );

    return {
      success: false,
      reason: error.message
    };
  }
}


/* =====================================================
   7. TOOL OPEN TRACKING
   ===================================================== */

let openEventStarted = false;

async function trackOpen() {
  if (openEventStarted) {
    return {
      success: false,
      reason: "Already tracked."
    };
  }

  openEventStarted = true;

  return saveUsageEvent(
    "tool_open",
    "Tool Open"
  );
}


/* =====================================================
   8. TOOL ACTION TRACKING
   ===================================================== */

async function trackAction(actionLabel) {
  if (!actionLabel) {
    console.warn(
      "CSC Analytics: Missing action label."
    );

    return {
      success: false,
      reason: "Missing action label."
    };
  }

  return saveUsageEvent(
    "tool_action",
    actionLabel
  );
}


/* =====================================================
   9. PUBLIC TRACKING API
   ===================================================== */

window.CSCUsage = Object.freeze({

  trackOpen,

  trackAction,

  getUser() {
    return currentUser;
  },

  isLoggedIn() {
    return !!currentUser;
  },

  async ready() {
    return await authReady;
  }

});


/* =====================================================
   10. AUTOMATIC TOOL OPEN EVENT
   ===================================================== */

trackOpen();


/* =====================================================
   11. TRACKER STATUS
   ===================================================== */

console.log(
  "CSC Seva Tool Usage Tracker Loaded Successfully."
);
