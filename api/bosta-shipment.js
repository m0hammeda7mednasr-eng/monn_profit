// Vercel Serverless Function to proxy Bosta API requests
// This allows frontend to fetch shipment data without exposing API key

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { trackingNumber } = req.query;

  if (!trackingNumber) {
    return res.status(400).json({ error: "Tracking number is required" });
  }

  // Handle demo tracking numbers
  const demoTrackingNumbers = ["2695867962", "2685887962"];
  if (
    trackingNumber.toUpperCase().startsWith("DEMO") ||
    demoTrackingNumbers.includes(trackingNumber)
  ) {
    const demoShipment = {
      tracking_number: trackingNumber,
      delivery_id: demoTrackingNumbers.includes(trackingNumber)
        ? "real_delivery_001"
        : "demo_delivery_001",
      order_id: null,
      bosta_order_type: 10,
      delivery_state: 40,
      delivery_state_label: "Delivered",
      expected_shipping_cost: 50,
      cod_amount: demoTrackingNumbers.includes(trackingNumber) ? 699.55 : 500,
      is_delivered: true,
      created_at: new Date().toISOString(),
    };
    return res.status(200).json(demoShipment);
  }

  // Get Bosta API key from environment
  const bostaApiKey = process.env.BOSTA_API_KEY;

  if (!bostaApiKey) {
    return res.status(500).json({
      error: "Bosta API key not configured",
      message: "Please configure BOSTA_API_KEY in Vercel environment variables",
    });
  }

  try {
    // Call Bosta API
    const bostaResponse = await fetch(
      `https://app.bosta.co/api/v2/deliveries/${trackingNumber}`,
      {
        headers: {
          Authorization: bostaApiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!bostaResponse.ok) {
      if (bostaResponse.status === 404) {
        return res.status(404).json({
          error: "Tracking number not found",
          tracking_number: trackingNumber,
        });
      }

      const errorText = await bostaResponse.text();
      console.error("Bosta API error:", errorText);

      return res.status(bostaResponse.status).json({
        error: "Failed to fetch from Bosta API",
        status: bostaResponse.status,
      });
    }

    const bostaData = await bostaResponse.json();

    // Format response to match our schema
    const shipment = {
      tracking_number: bostaData.trackingNumber || trackingNumber,
      delivery_id: bostaData._id,
      order_id: null, // We don't have order mapping yet
      bosta_order_type: bostaData.type,
      delivery_state: bostaData.state?.value || 0,
      delivery_state_label: bostaData.state?.label || "Unknown",
      expected_shipping_cost: bostaData.pricing?.total || 0,
      cod_amount: bostaData.cod || 0,
      is_delivered: bostaData.state?.value === 40,
      created_at: bostaData.createdAt,
      updated_at: bostaData.updatedAt,
      // Additional fields
      receiver: bostaData.receiver,
      dropOffAddress: bostaData.dropOffAddress,
      notes: bostaData.notes,
    };

    return res.status(200).json(shipment);
  } catch (error) {
    console.error("Error fetching from Bosta:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
