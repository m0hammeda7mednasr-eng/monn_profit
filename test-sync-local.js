// ====================================
// Test Sync Endpoint Locally
// ====================================

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5000/api";
const LOGIN_EMAIL =
  process.env.TEST_SYNC_EMAIL || "midoooahmed28@gmail.com";
const LOGIN_PASSWORD =
  process.env.TEST_SYNC_PASSWORD || "01066184859";

const postJson = async (url, body, headers = {}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

const testSyncEndpoint = async () => {
  console.log("Testing local sync endpoint...");
  console.log(`API base URL: ${API_BASE_URL}`);

  try {
    console.log("\nStep 1: Login to get auth token...");
    const loginResponse = await postJson(`${API_BASE_URL}/auth/login`, {
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
    });

    const authToken = loginResponse?.token;
    if (!authToken) {
      throw new Error("Login succeeded but no token was returned");
    }

    console.log("Login successful, got auth token");
    console.log("\nStep 2: Testing sync endpoint...");

    const syncResponse = await postJson(
      `${API_BASE_URL}/shopify/sync`,
      {},
      {
        Authorization: `Bearer ${authToken}`,
      },
    );

    console.log("Sync endpoint response:");
    console.log(JSON.stringify(syncResponse, null, 2));
  } catch (error) {
    console.log("Error occurred:");
    console.log(`Status: ${error.status || "unknown"}`);
    console.log(JSON.stringify(error.data ?? error.message, null, 2));

    if (error.status === 401) {
      console.log(
        "\nTip: Set TEST_SYNC_EMAIL / TEST_SYNC_PASSWORD or update the defaults in this script.",
      );
    }
  }
};

testSyncEndpoint().catch(console.error);
