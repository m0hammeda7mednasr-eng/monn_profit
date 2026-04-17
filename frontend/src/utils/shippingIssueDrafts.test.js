import {
  buildShippingIssueDraftRecord,
  readShippingIssueDrafts,
  resolveShippingIssueDraft,
  writeShippingIssueDrafts,
} from "./shippingIssueDrafts";

describe("shippingIssueDrafts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("user", JSON.stringify({ id: "user-1" }));
    window.localStorage.setItem("currentStoreId", "store-1");
  });

  test("builds a draft record with the current server note snapshot", () => {
    const order = {
      shipping_issue: {
        shipping_company_note: "Courier asked for a second attempt.",
        customer_service_note: "Customer confirmed afternoon availability.",
      },
    };

    const draft = buildShippingIssueDraftRecord(order, {
      shipping_company_note: "Courier will retry tomorrow morning.",
      customer_service_note: "Customer asked to be called before delivery.",
    });

    expect(draft).toEqual(
      expect.objectContaining({
        shipping_company_note: "Courier will retry tomorrow morning.",
        customer_service_note: "Customer asked to be called before delivery.",
        base_shipping_company_note: "Courier asked for a second attempt.",
        base_customer_service_note:
          "Customer confirmed afternoon availability.",
      }),
    );
  });

  test("hydrates a draft when the server notes still match the original base", () => {
    const order = {
      shipping_issue: {
        shipping_company_note: "Courier asked for a second attempt.",
        customer_service_note: "Customer confirmed afternoon availability.",
      },
    };
    const draft = {
      shipping_company_note: "Courier will retry tomorrow morning.",
      customer_service_note: "Customer asked to be called before delivery.",
      base_shipping_company_note: "Courier asked for a second attempt.",
      base_customer_service_note: "Customer confirmed afternoon availability.",
    };

    expect(resolveShippingIssueDraft(order, draft)).toEqual({
      status: "hydrate",
      draft: {
        shipping_company_note: "Courier will retry tomorrow morning.",
        customer_service_note: "Customer asked to be called before delivery.",
      },
    });
  });

  test("marks a draft as synced when the server already contains the same notes", () => {
    const order = {
      shipping_issue: {
        shipping_company_note: "Courier will retry tomorrow morning.",
        customer_service_note: "Customer asked to be called before delivery.",
      },
    };
    const draft = {
      shipping_company_note: "Courier will retry tomorrow morning.",
      customer_service_note: "Customer asked to be called before delivery.",
      base_shipping_company_note: "Old note",
      base_customer_service_note: "Old note",
    };

    expect(resolveShippingIssueDraft(order, draft)).toEqual({
      status: "synced",
      draft: {
        shipping_company_note: "Courier will retry tomorrow morning.",
        customer_service_note: "Customer asked to be called before delivery.",
      },
    });
  });

  test("marks a draft as stale when the server diverged from the stored base", () => {
    const order = {
      shipping_issue: {
        shipping_company_note: "Courier already completed the retry.",
        customer_service_note: "Customer received the package.",
      },
    };
    const draft = {
      shipping_company_note: "Courier will retry tomorrow morning.",
      customer_service_note: "Customer asked to be called before delivery.",
      base_shipping_company_note: "Courier asked for a second attempt.",
      base_customer_service_note: "Customer confirmed afternoon availability.",
    };

    expect(resolveShippingIssueDraft(order, draft)).toEqual({
      status: "stale",
      draft: {
        shipping_company_note: "Courier will retry tomorrow morning.",
        customer_service_note: "Customer asked to be called before delivery.",
      },
    });
  });

  test("writes and reads persisted drafts for the active user and store scope", () => {
    writeShippingIssueDrafts({
      "order-42": {
        shipping_company_note: "Courier will retry tomorrow morning.",
        customer_service_note: "Customer asked to be called before delivery.",
        base_shipping_company_note: "Courier asked for a second attempt.",
        base_customer_service_note: "Customer confirmed afternoon availability.",
      },
    });

    expect(readShippingIssueDrafts()).toEqual({
      "order-42": expect.objectContaining({
        shipping_company_note: "Courier will retry tomorrow morning.",
        customer_service_note: "Customer asked to be called before delivery.",
        base_shipping_company_note: "Courier asked for a second attempt.",
        base_customer_service_note:
          "Customer confirmed afternoon availability.",
      }),
    });
  });
});
