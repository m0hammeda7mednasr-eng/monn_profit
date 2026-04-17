import { describe, expect, it } from "@jest/globals";
import { extractCustomerPhone, normalizeCustomerContact } from "./customerContact.js";

describe("helpers/customerContact", () => {
  it("falls back to default address phone when direct phone is missing", () => {
    const customer = {
      phone: "",
      default_address: {
        phone: "+201234567890",
      },
    };

    expect(extractCustomerPhone(customer)).toBe("+201234567890");
  });

  it("reads phone from serialized data payload for legacy stored customers", () => {
    const customer = {
      phone: "",
      data: JSON.stringify({
        default_address: {
          phone: "+201111111111",
        },
        addresses: [{ phone: "+202222222222" }],
      }),
    };

    expect(extractCustomerPhone(customer)).toBe("+201111111111");
  });

  it("normalizes customer rows with the resolved phone", () => {
    const customer = {
      id: "customer-1",
      phone: "",
      data: {
        addresses: [{ phone: "+203333333333" }],
      },
    };

    expect(normalizeCustomerContact(customer).phone).toBe("+203333333333");
  });
});
