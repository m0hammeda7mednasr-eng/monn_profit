// Script to copy all current SKUs to Extra line 1 for all products
// Run this once before changing SKUs

const copyAllSKUsToExtraLine = () => {
  // Get all existing custom footer lines
  let customFooterLines = {};
  try {
    const stored = localStorage.getItem("barcode-label-custom-footer-lines");
    customFooterLines = stored ? JSON.parse(stored) : {};
  } catch {
    customFooterLines = {};
  }

  // This will be populated when you run this in the browser console
  // You need to provide the products data
  const products = []; // This should be filled with your products data

  let updatedCount = 0;

  products.forEach((product) => {
    if (product.sku && product.key) {
      // Only update if there's no existing custom line 1
      if (!customFooterLines[product.key]?.line1) {
        customFooterLines[product.key] = {
          ...customFooterLines[product.key],
          line1: product.sku,
        };
        updatedCount++;
      }
    }
  });

  // Save back to localStorage
  try {
    localStorage.setItem(
      "barcode-label-custom-footer-lines",
      JSON.stringify(customFooterLines),
    );
    console.log(`✅ Successfully copied ${updatedCount} SKUs to Extra line 1`);
    console.log("Now you can change SKUs and Extra line 1 won't be affected");
  } catch (error) {
    console.error("❌ Failed to save:", error);
  }
};

// Instructions:
console.log("📋 Instructions:");
console.log("1. Open your products page");
console.log("2. Open browser console (F12)");
console.log("3. Copy this entire script and paste it");
console.log("4. Modify the 'products' array with your actual products data");
console.log("5. Run: copyAllSKUsToExtraLine()");

// Export for use
if (typeof window !== "undefined") {
  window.copyAllSKUsToExtraLine = copyAllSKUsToExtraLine;
}
